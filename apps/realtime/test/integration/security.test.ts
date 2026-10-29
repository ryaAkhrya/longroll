import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { cookieNameFor, WS_CLOSE } from "@longroll/shared";
import { setLogSink } from "../../src/log";
import { Client, ORIGIN, sleep, startServer } from "./helpers";
import type { TestServer } from "./helpers";

/**
 * Tes keamanan negatif P09 (TC-SEC-*). Semua berjalan di proses (server HTTP+WS sungguhan, store/storage memori)
 * dan aman dijalankan ulang; tidak menyentuh jaringan eksternal. `npm run test:security -w @longroll/realtime`.
 */
let srv: TestServer;
afterEach(async () => {
  setLogSink(null);
  await srv?.close();
});

/** Upgrade WS mentah (tanpa Client) supaya status penolakan terbaca. */
function rawUpgrade(s: TestServer, code: string, headers: Record<string, string>): Promise<{ status: number } | { open: WebSocket }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${s.wsBase}?code=${code}&v=1`, { headers });
    ws.once("unexpected-response", (_req, res) => {
      resolve({ status: res.statusCode ?? 0 });
      ws.terminate();
    });
    ws.once("open", () => resolve({ open: ws }));
    ws.once("error", () => undefined);
  });
}

describe("TC-SEC-001: enumerasi kode room", () => {
  it("kode salah lewat WS dihitung bersama HTTP: setelah 20 → WS & HTTP sama-sama 429 (tak ada oracle lewat jalur WS)", async () => {
    srv = await startServer();
    const owner = new Client(srv);
    const real = (await owner.create("Nadia")).body!.roomCode as string;
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      const code = `ZZZZ${"ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(i / 2)]}${"23456789"[i % 8]}`;
      const r = await rawUpgrade(srv, code, { Origin: ORIGIN });
      statuses.push("status" in r ? r.status : 101);
    }
    expect(statuses.slice(0, 20).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
    // Penghitung dibagi: kode asli yang valid pun ditolak sementara dari IP yang sama.
    expect((await new Client(srv).request("GET", `/api/rooms/${real}/preview`)).status).toBe(429);
  });

  it("X-Forwarded-For palsu di sisi KIRI tidak mem-bypass rate limit (hanya entri tambahan proxy tepercaya yang dipakai)", async () => {
    srv = await startServer({ TRUST_PROXY: "1" });
    let last = 0;
    for (let i = 0; i < 22; i++) {
      // Penyerang mengganti IP palsu tiap request; proxy tepercaya menambahkan IP asli (198.51.100.9) di kanan.
      const c = new Client(srv, `203.0.113.${i + 1}, 198.51.100.9`);
      last = (await c.request("GET", `/api/rooms/QQQQ${"ABCDEFGHJKLMNPQRSTUVWXYZ"[i]}2/preview`)).status;
    }
    expect(last).toBe(429);
    // Dengan 2 proxy tepercaya, IP klien = entri ke-2 dari kanan.
    const two = await startServer({ TRUST_PROXY: "2" });
    try {
      let status = 0;
      for (let i = 0; i < 22; i++) status = (await new Client(two, `evil${i}, 198.51.100.77, 10.0.0.1`).request("GET", `/api/rooms/QQQQ${"ABCDEFGHJKLMNPQRSTUVWXYZ"[i]}2/preview`)).status;
      expect(status).toBe(429);
    } finally {
      await two.close();
    }
  });

  it("penolakan 404/401/410 memakai waktu minimum yang sama (tidak membocorkan keberadaan kode lewat timing)", async () => {
    srv = await startServer();
    const owner = new Client(srv);
    const real = (await owner.create("Nadia")).body!.roomCode as string;
    const time = async (code: string) => {
      const t = Date.now();
      await rawUpgrade(srv, code, { Origin: ORIGIN });
      return Date.now() - t;
    };
    expect(await time("QQQQQ2")).toBeGreaterThanOrEqual(110); // tidak ada
    expect(await time(real)).toBeGreaterThanOrEqual(110); // ada tapi tanpa cookie → 401
  });
});

describe("TC-SEC-002/003/010/012: otorisasi", () => {
  it("token room A di room B → AUTH_INVALID; tanpa cookie → upgrade 401; preview tanpa token hanya inisial", async () => {
    srv = await startServer();
    const a = new Client(srv);
    const b = new Client(srv);
    const roomA = (await a.create("Nadia")).body as { roomCode: string; roomId: string };
    const roomB = (await b.create("Raka")).body as { roomCode: string; roomId: string };
    const tokenA = a.cookies.get(cookieNameFor(roomA.roomId))!;
    expect(tokenA).toBeTruthy();

    const intruder = new Client(srv);
    intruder.cookies.set(cookieNameFor(roomB.roomId), tokenA); // token A dipakai untuk room B
    expect((await intruder.request("POST", `/api/rooms/${roomB.roomCode}/session`)).body).toMatchObject({ error: "AUTH_INVALID" });
    expect((await intruder.request("GET", `/api/rooms/${roomB.roomCode}/turn-credentials`)).body).toMatchObject({ error: "AUTH_INVALID" });
    await expect(intruder.connect(roomB.roomCode)).rejects.toThrow("HTTP 401");

    const pv = await new Client(srv).request("GET", `/api/rooms/${roomB.roomCode}/preview`);
    expect(Object.keys(pv.body!).sort()).toEqual(["capacity", "colors", "exists", "holding", "initials", "participantCount", "status"]);
    expect(JSON.stringify(pv.body)).not.toMatch(/Raka|Nadia/);
  });

  it("IDOR: URL foto/frame room lain dengan cookie room sendiri → tidak ada akses; id acak → 404", async () => {
    srv = await startServer();
    const a = new Client(srv);
    const b = new Client(srv);
    const roomA = (await a.create("Nadia")).body as { roomCode: string };
    const roomB = (await b.create("Raka")).body as { roomCode: string };
    const attempt = crypto.randomUUID();
    expect((await a.request("GET", `/api/rooms/${roomB.roomCode}/attempts/${attempt}/url`)).body).toMatchObject({ error: "AUTH_INVALID" });
    expect((await a.request("GET", `/api/rooms/${roomA.roomCode}/attempts/${attempt}/url`)).body).toMatchObject({ error: "FRAME_NOT_FOUND" });
    expect((await a.request("GET", `/api/rooms/${roomB.roomCode}/frames/${crypto.randomUUID()}/url`)).body).toMatchObject({ error: "AUTH_INVALID" });
    expect((await a.request("POST", `/api/rooms/${roomB.roomCode}/frames`, { contentType: "image/png", bytes: 10 })).body).toMatchObject({ error: "AUTH_INVALID" });
  });

  it("TC-SEC-012: presence.set menyebut peserta lain ditolak; tidak ada event yang mengubah kamera orang lain", async () => {
    srv = await startServer();
    const a = new Client(srv);
    const code = (await a.create("Nadia")).body!.roomCode as string;
    const b = new Client(srv);
    const joined = (await b.join(code, "Raka")).body as { participantId: string };
    const sa = await a.connect(code);
    const sb = await b.connect(code);
    sa.send("presence.set", { participantId: joined.participantId, camera: "off", ready: true }, "x1");
    const ack = await sa.waitFor("ack", (m) => (m as { replyTo?: string }).replyTo === "x1");
    expect(ack.payload).toMatchObject({ ok: false, error: "FORBIDDEN_NOT_OWNER" });
    for (const t of ["camera.set", "camera.enable", "presence.force", "rtc.camera.on"]) {
      sa.send(t, { participantId: joined.participantId }, `u-${t}`);
      const r = await sa.waitFor("ack", (m) => (m as { replyTo?: string }).replyTo === `u-${t}`);
      expect(r.payload).toMatchObject({ ok: false });
    }
    await sleep(50);
    expect(sb.messages.some((m) => m.type === "presence.update")).toBe(false);
  });
});

describe("TC-SEC-022/023: cookie, Origin, CSRF", () => {
  it("atribut cookie: HttpOnly; SameSite=Strict; Secure; Path; Max-Age — token tidak ada di body/URL", async () => {
    srv = await startServer({ COOKIE_SECURE: "true" });
    const r = await new Client(srv).create("Nadia");
    const cookie = r.res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=\d+/);
    const token = cookie.split(";")[0]!.split("=")[1]!;
    expect(JSON.stringify(r.body)).not.toContain(token);
    expect(String(r.body!.wsUrl)).not.toContain(token);
  });

  it("Origin asing + cookie valid: semua endpoint mengubah-state & upgrade WS ditolak tanpa efek", async () => {
    srv = await startServer();
    const a = new Client(srv);
    const code = (await a.create("Nadia")).body!.roomCode as string;
    const evil = { origin: "https://evil.example" };
    expect((await a.request("POST", "/api/rooms", { displayName: "X" }, evil)).status).toBe(403);
    expect((await a.request("POST", `/api/rooms/${code}/join`, { displayName: "X" }, evil)).status).toBe(403);
    expect((await a.request("POST", `/api/rooms/${code}/session`, undefined, evil)).status).toBe(403);
    expect((await a.request("POST", `/api/rooms/${code}/leave`, undefined, evil)).status).toBe(403);
    expect((await a.request("GET", `/api/rooms/${code}/turn-credentials`, undefined, evil)).status).toBe(403);
    const cookie = Array.from(a.cookies, ([k, v]) => `${k}=${v}`).join("; ");
    expect(await rawUpgrade(srv, code, { Origin: "https://evil.example", Cookie: cookie })).toEqual({ status: 403 });
    expect(await rawUpgrade(srv, code, { Cookie: cookie })).toEqual({ status: 403 }); // tanpa Origin
    // Tidak ada efek: peserta masih ada dan sesi masih sah.
    expect((await a.request("POST", `/api/rooms/${code}/session`)).status).toBe(200);
    const pv = await new Client(srv).request("GET", `/api/rooms/${code}/preview`);
    expect(pv.body).toMatchObject({ participantCount: 1 });
  });

  it("CORS: hanya origin yang diizinkan mendapat Allow-Origin; preflight asing ditolak", async () => {
    srv = await startServer();
    const ok = await fetch(`${srv.base}/api/health`, { headers: { Origin: ORIGIN } });
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const bad = await fetch(`${srv.base}/api/health`, { headers: { Origin: "https://evil.example" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await fetch(`${srv.base}/api/rooms`, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    expect(pre.status).toBe(403);
  });

  it("header keamanan API: nosniff, no-store, Referrer-Policy, CSP ketat", async () => {
    srv = await startServer();
    const r = await fetch(`${srv.base}/api/health`);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("content-security-policy")).toContain("default-src 'none'");
  });
});

describe("TC-SEC-018: signed URL storage lokal", () => {
  const key = "rooms/11111111-1111-4111-8111-111111111111/attempts/a/full.jpg";
  const tokenOf = (url: string) => url.split("/api/storage/")[1]!;

  it("GET: kedaluwarsa, dimodifikasi, metode salah, key di luar rooms/ → 403; valid → 200 dengan header isolasi", async () => {
    srv = await startServer();
    await srv.storage.put(key, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), "image/jpeg");
    const now = Math.floor(Date.now() / 1000);
    const good = srv.storage.signer.sign({ k: key, m: "GET", e: now + 60 });
    const res = await fetch(good);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("cross-origin");

    expect((await fetch(srv.storage.signer.sign({ k: key, m: "GET", e: now - 1 }))).status).toBe(403); // lewat TTL
    const t = tokenOf(good);
    expect((await fetch(`${srv.base}/api/storage/${t.slice(0, -3)}AAA`)).status).toBe(403); // tanda tangan diubah
    expect((await fetch(good, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: "x" })).status).toBe(403); // metode salah
    expect((await fetch(srv.storage.signer.sign({ k: "secrets/db.env", m: "GET", e: now + 60 }))).status).toBe(403);
    expect((await fetch(srv.storage.signer.sign({ k: "rooms/../etc/passwd", m: "GET", e: now + 60 }))).status).toBe(403);
  });

  it("PUT: content-type salah, melebihi ukuran, key bukan upload, dan pemakaian ulang (replay) ditolak", async () => {
    srv = await startServer();
    const now = Math.floor(Date.now() / 1000);
    const put = (url: string, body: string, type = "image/jpeg") => fetch(url, { method: "PUT", headers: { "Content-Type": type }, body });

    const url1 = srv.storage.signer.sign({ k: key, m: "PUT", e: now + 60, ct: "image/jpeg", max: 1000 });
    expect((await put(url1, "x".repeat(10), "text/html")).status).toBe(403);
    const url2 = srv.storage.signer.sign({ k: key, m: "PUT", e: now + 60, ct: "image/jpeg", max: 1000 });
    expect((await put(url2, "x".repeat(5000))).status).toBe(413);
    expect((await put(srv.storage.signer.sign({ k: "rooms/x/random.html", m: "PUT", e: now + 60, ct: "image/jpeg", max: 100 }), "x")).status).toBe(403);
    expect((await put(srv.storage.signer.sign({ k: key, m: "PUT", e: now - 5, ct: "image/jpeg", max: 100 }), "x")).status).toBe(403);

    const url3 = srv.storage.signer.sign({ k: key, m: "PUT", e: now + 60, ct: "image/jpeg", max: 1000 });
    expect((await put(url3, "ok")).status).toBe(200);
    expect((await put(url3, "ganti")).status).toBe(403); // sekali pakai
    expect(await srv.storage.size(key)).toBe(2);
  });
});

describe("TC-SEC-040: flood", () => {
  it("500 event dalam sekejap: koneksi pelaku dibatasi/ditutup; peserta room lain tetap responsif", async () => {
    srv = await startServer();
    const a = new Client(srv);
    const code = (await a.create("Nadia")).body!.roomCode as string;
    const b = new Client(srv);
    await b.join(code, "Raka");
    const other = new Client(srv);
    const otherCode = (await other.create("Sasa")).body!.roomCode as string;
    const sa = await a.connect(code);
    const sb = await b.connect(code);
    const so = await other.connect(otherCode);

    for (let i = 0; i < 600; i++) sa.send("cursor.move", { surface: "lobby", x: Math.random(), y: Math.random() });
    for (let i = 0; i < 200; i++) sa.send("presence.activity", { activity: "spam" });

    // Room lain & rekan satu room tetap dilayani selama banjir.
    const t = Date.now();
    so.send("time.ping", { t1: t });
    await so.waitFor("time.pong", () => true, 1000);
    expect(Date.now() - t).toBeLessThan(500);
    sb.send("time.ping", { t1: t });
    await sb.waitFor("time.pong", () => true, 1000);

    expect(await sa.waitClose(3000)).toBe(WS_CLOSE.RATE_LIMITED);
    // Peserta lain tidak menerima lebih dari jatah token bucket pelaku.
    const relayed = sb.messages.filter((m) => m.type === "cursor.move").length;
    expect(relayed).toBeLessThanOrEqual(80);
  });

  it("pesan non-editor > 64 KB ditutup 1009; frame biner & JSON rusak ditutup 1003", async () => {
    srv = await startServer();
    const a = new Client(srv);
    const code = (await a.create("Nadia")).body!.roomCode as string;
    const s1 = await a.connect(code);
    s1.ws.send(JSON.stringify({ type: "presence.set", payload: { pad: "x".repeat(70 * 1024) } }));
    expect(await s1.waitClose()).toBe(1009);
    const s2 = await a.connect(code);
    s2.ws.send(Buffer.from([1, 2, 3]));
    expect(await s2.waitClose()).toBe(1003);
    const s3 = await a.connect(code);
    s3.ws.send("{bukan json");
    expect(await s3.waitClose()).toBe(1003);
  });

  it("lalu lintas HTTP umum per IP dibatasi di memori (429), health tetap menjawab bagi IP lain", async () => {
    srv = await startServer({ TRUST_PROXY: "true" });
    const flood = new Client(srv, "198.51.100.50");
    let limited = 0;
    for (let batch = 0; batch < 10; batch++) {
      const rs = await Promise.all(Array.from({ length: 100 }, () => flood.request("GET", "/api/nope")));
      limited += rs.filter((r) => r.status === 429).length;
    }
    expect(limited).toBeGreaterThan(50);
    expect((await new Client(srv, "198.51.100.51").request("GET", "/api/health")).status).toBe(200);
  });
});

describe("TC-SEC-041: log bebas data pribadi", () => {
  it("nama, token, cookie, signed URL, IP, DSN tidak muncul di log aplikasi sepanjang alur uji", async () => {
    const lines: string[] = [];
    setLogSink((l) => lines.push(l));
    srv = await startServer({ TRUST_PROXY: "true", PARTICIPANT_HOLD_SECONDS: "0.2", ROOM_GRACE_PERIOD_SECONDS: "0.5" });
    const a = new Client(srv, "203.0.113.77");
    const created = await a.create("ZebraUnik");
    const code = created.body!.roomCode as string;
    const roomId = created.body!.roomId as string;
    const token = a.cookies.get(cookieNameFor(roomId))!;
    const signed = await srv.storage.presignGet(`rooms/${roomId}/x.jpg`, 60);
    await srv.storage.put(`rooms/${roomId}/x.jpg`);
    await a.request("GET", `/api/rooms/${code}/attempts/${crypto.randomUUID()}/url`);
    await new Client(srv, "203.0.113.77").request("GET", "/api/rooms/ZZZZZZ/preview");
    const s = await a.connect(code);
    s.send("bukan.event", {}, "e1");
    await s.waitFor("ack", (m) => (m as { replyTo?: string }).replyTo === "e1");
    s.close();
    await sleep(1500); // hold → LEFT → grace → cleanup
    const all = lines.join("\n");
    expect(all.length).toBeGreaterThan(0); // log memang ada
    for (const secret of ["ZebraUnik", token, signed.split("/api/storage/")[1]!, "203.0.113.77", "rooms/", "Cookie", "set-cookie"]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe("pengaman kapasitas", () => {
  it("batas pembuatan room global per menit & per IP menghasilkan RATE_LIMITED yang ramah (retryAfterSec)", async () => {
    srv = await startServer({ TRUST_PROXY: "true" });
    const results: number[] = [];
    let retry: unknown;
    for (let i = 0; i < 12; i++) {
      const r = await new Client(srv, "198.51.100.200").create(`P${i}`);
      results.push(r.status);
      if (r.status === 429) retry = r.body!.retryAfterSec;
    }
    expect(results.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(results.slice(10)).toEqual([429, 429]);
    expect(Number(retry)).toBeGreaterThan(0);
  });

  it("room aktif melebihi MAX_ACTIVE_ROOMS → 503 SERVICE_UNAVAILABLE + Retry-After, room lama tetap berjalan", async () => {
    srv = await startServer({ MAX_ACTIVE_ROOMS: "2", TRUST_PROXY: "true" });
    const first = await new Client(srv, "198.51.100.1").create("A");
    await new Client(srv, "198.51.100.2").create("B");
    const third = await new Client(srv, "198.51.100.3").create("C");
    expect(third.status).toBe(503);
    expect(third.res.headers.get("retry-after")).toBeTruthy();
    expect((await new Client(srv).request("GET", `/api/rooms/${first.body!.roomCode}/preview`)).status).toBe(200);
  });
});
