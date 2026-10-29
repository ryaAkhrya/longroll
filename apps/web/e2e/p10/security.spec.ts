import { expect, test } from "@playwright/test";
import http from "node:http";
import { collectCsp, createRoom, fakeIp, openPerson } from "./kit";

/**
 * P10-A — regresi keamanan P09 DI BROWSER/HTTP NYATA terhadap build produksi: CSP nonce, header, injeksi skrip/eval,
 * XSS lewat nama, atribut cookie, CORS/Origin, WS Origin, IDOR/otorisasi, URL storage palsu, route dev.
 */
const WEB = "http://localhost:3000";
const API = "http://localhost:4000";

test.describe("CSP & header dokumen", () => {
  for (const path of ["/", "/r/ABCDEF", "/tidak-ada-halaman"]) {
    test(`header + nonce: ${path}`, async ({ request }) => {
      const res = await request.get(WEB + path);
      const csp = res.headers()["content-security-policy"] ?? "";
      expect(csp).not.toBe("");
      const dirs = csp.split(";").map((d) => d.trim());
      const script = dirs.find((d) => d.startsWith("script-src"))!;
      expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]{16,}'/);
      expect(script).toContain("'strict-dynamic'");
      expect(script).not.toContain("'unsafe-inline'");
      expect(script).not.toContain("'unsafe-eval'");
      const style = dirs.find((d) => d.startsWith("style-src "))!;
      expect(style).not.toContain("'unsafe-inline'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'none'");
      const h = res.headers();
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["referrer-policy"]).toBeTruthy();
      expect(h["strict-transport-security"]).toMatch(/max-age=\d{6,}/);
      // Semua <script> di HTML membawa nonce yang sama dengan header.
      const nonce = /'nonce-([^']+)'/.exec(script)![1]!;
      const html = await res.text();
      const tags = html.match(/<script\b[^>]*>/g) ?? [];
      expect(tags.length).toBeGreaterThan(0);
      for (const t of tags) expect(t, t.slice(0, 120)).toContain(`nonce="${nonce}"`);
      // Nonce berbeda tiap request.
      const again = (await request.get(WEB + path)).headers()["content-security-policy"] ?? "";
      expect(/'nonce-([^']+)'/.exec(again)![1]).not.toBe(nonce);
    });
  }

  test("katalog komponen dev tidak tersedia di produksi", async ({ request }) => {
    expect((await request.get(WEB + "/dev/components")).status()).toBe(404);
  });
});

test("browser: handler inline (innerHTML), eval, new Function & URL javascript: diblokir; aplikasi sendiri tanpa pelanggaran", async ({ browser }, info) => {
  const p = await openPerson(browser, info, "Uji", { camera: false });
  await p.page.goto("/");
  await expect(p.page.getByRole("heading", { level: 1 })).toBeVisible();
  // Hidrasi: komponen interaktif bekerja (bukan HTML statis).
  await p.page.getByRole("link", { name: /Bikin room/ }).first().click();
  await expect(p.page).toHaveURL(/\/r\/new$/);
  expect(await collectCsp(p), "pelanggaran CSP dari aplikasi sendiri").toEqual([]);

  const r = await p.page.evaluate(async () => {
    const out: Record<string, unknown> = {};
    const w = window as unknown as Record<string, unknown>;
    // Vektor injeksi HTML (bukan skrip buatan skrip tepercaya — 'strict-dynamic' memang mengizinkan itu): handler atribut inline.
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onload="window.__inlineRan=1">';
    await new Promise((res) => setTimeout(res, 300));
    out.inline = w.__inlineRan === 1;
    try {
      out.eval = String(eval("1+1"));
    } catch (e) {
      out.eval = (e as Error).name;
    }
    try {
      out.fn = String(new Function("return 7")());
    } catch (e) {
      out.fn = (e as Error).name;
    }
    const a = document.createElement("a");
    a.href = "javascript:window.__jsurl=1";
    document.body.appendChild(a);
    a.click();
    await new Promise((res) => setTimeout(res, 100));
    out.jsurl = w.__jsurl === 1;
    return out;
  });
  expect(r.inline).toBe(false);
  expect(r.eval).toBe("EvalError");
  expect(r.fn).toBe("EvalError");
  expect(r.jsurl).toBe(false);
  // Pelanggaran dari percobaan di atas tercatat (bukti bahwa CSP benar-benar menegakkan).
  const v = await collectCsp(p);
  expect(v.some((x) => /script-src/.test(x))).toBe(true);
  await p.ctx.close();
});

test("XSS lewat nama panggilan: ditolak di UI dan API; tidak ada yang dieksekusi", async ({ browser, request }, info) => {
  const p = await openPerson(browser, info, "Uji", { camera: false });
  await p.page.goto("/r/new");
  await p.page.getByLabel("Nama panggilan").fill('<img src=x onerror="window.__xss=1">');
  await expect(p.page.getByRole("button", { name: "Bikin room" })).toBeDisabled();
  expect(await p.page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(await p.page.locator('img[src="x"]').count()).toBe(0);
  await p.ctx.close();
  // Server tidak mempercayai validasi klien.
  const res = await request.post(`${API}/api/rooms`, { headers: { Origin: WEB, "Content-Type": "application/json", "X-Forwarded-For": fakeIp() }, data: { displayName: '<img src=x onerror="alert(1)">' } });
  expect(res.status()).toBe(400);
});

test("cookie kredensial: HttpOnly + SameSite=Strict; token tidak ada di storage/URL/DOM", async ({ browser }, info) => {
  const p = await openPerson(browser, info, "Uji", { camera: false });
  const code = await createRoom(p.page, "Nadia", false);
  const cookies = await p.ctx.cookies();
  const c = cookies.find((x) => x.httpOnly);
  expect(c, `cookie: ${cookies.map((x) => x.name).join(",")}`).toBeTruthy();
  expect(c!.httpOnly).toBe(true);
  // Playwright-WebKit tidak melaporkan SameSite dengan benar (selalu "None"); atribut diverifikasi dari header Set-Cookie di tes API.
  if (!info.project.name.startsWith("webkit")) expect(c!.sameSite).toBe("Strict");
  if (info.project.name.startsWith("chromium") || info.project.name.startsWith("firefox")) expect(c!.secure, "cookie harus Secure (default)").toBe(true);
  expect(c!.value.length).toBeGreaterThan(20);
  const leaked = await p.page.evaluate((val) => {
    const hay = [JSON.stringify(localStorage), JSON.stringify(sessionStorage), location.href, document.cookie, document.documentElement.outerHTML].join("\n");
    return hay.includes(val);
  }, c!.value);
  expect(leaked).toBe(false);
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  await p.ctx.close();
});

test.describe("API: Origin/CORS/otorisasi/enumerasi", () => {
  test("POST /api/rooms dari Origin asing ditolak; preflight asing tanpa ACAO", async ({ request }) => {
    const bad = await request.post(`${API}/api/rooms`, { headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, data: { displayName: "x" } });
    expect(bad.status()).toBe(403);
    const pre = await request.fetch(`${API}/api/rooms`, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
    expect(pre.headers()["access-control-allow-origin"]).toBeUndefined();
    const ok = await request.fetch(`${API}/api/rooms`, { method: "OPTIONS", headers: { Origin: WEB, "Access-Control-Request-Method": "POST" } });
    expect(ok.headers()["access-control-allow-origin"]).toBe(WEB);
    expect(ok.headers()["access-control-allow-credentials"]).toBe("true");
  });

  test("tanpa kredensial: sesi/leave/URL attempt/frame ditolak; kode tak ada vs lain tidak membocorkan perbedaan", async ({ request }) => {
    const h = { Origin: WEB };
    // /leave tanpa kredensial idempoten ({ok:true}, tidak mencabut siapa pun) dan sama untuk kode apa pun: tidak membocorkan keberadaan room.
    const leave = await request.fetch(`${API}/api/rooms/ABCDEF/leave`, { method: "POST", headers: h, data: {} });
    const leave2 = await request.fetch(`${API}/api/rooms/ZZZZZZ/leave`, { method: "POST", headers: h, data: {} });
    expect([leave.status(), await leave.text()]).toEqual([leave2.status(), await leave2.text()]);
    for (const [m, path] of [
      ["POST", "/api/rooms/ABCDEF/session"],
      ["POST", "/api/rooms/ABCDEF/attempts/00000000-0000-4000-8000-000000000000/url"],
      ["POST", "/api/rooms/ABCDEF/frames"],
    ] as const) {
      const res = await request.fetch(API + path, { method: m, headers: h, data: {} });
      expect([401, 403, 404], `${m} ${path}`).toContain(res.status());
    }
    const a = await request.get(`${API}/api/rooms/ZZZZZZ/preview`, { headers: h });
    const b = await request.get(`${API}/api/rooms/YYYYYY/preview`, { headers: h });
    expect(a.status()).toBe(b.status());
    expect(await a.text()).toBe(await b.text());
  });

  test("URL storage palsu/dirusak tidak bisa dibaca atau ditulis", async ({ request }) => {
    const forged = "AAAA.BBBB";
    expect((await request.get(`${API}/api/storage/${forged}`)).status()).toBeGreaterThanOrEqual(400);
    const put = await request.put(`${API}/api/storage/${forged}`, { headers: { "Content-Type": "image/jpeg" }, data: Buffer.from([0xff, 0xd8, 0xff]) });
    expect(put.status()).toBeGreaterThanOrEqual(400);
  });

  test("WebSocket: Origin asing & tanpa cookie ditolak saat upgrade", async () => {
    // Permintaan upgrade mentah (tanpa dependensi ws): server harus menjawab status HTTP penolakan, bukan 101.
    const attempt = (origin: string) =>
      new Promise<number>((resolve) => {
        const req = http.request({
          host: "localhost",
          port: 4000,
          path: "/ws?code=ABCDEF&v=1",
          headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", Origin: origin },
        });
        req.on("upgrade", (_res, socket) => {
          socket.destroy();
          resolve(101);
        });
        req.on("response", (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", () => resolve(-1));
        req.setTimeout(8000, () => {
          req.destroy();
          resolve(-2);
        });
        req.end();
      });
    expect([401, 403, 404, 429]).toContain(await attempt("https://evil.example"));
    expect([401, 403, 404, 429]).toContain(await attempt(WEB));
  });

  test("Set-Cookie kredensial: HttpOnly; SameSite=Strict; Path=/; Max-Age; host-only (+Secure di produksi)", async ({ request }) => {
    const res = await request.post(`${API}/api/rooms`, { headers: { Origin: WEB, "Content-Type": "application/json", "X-Forwarded-For": fakeIp() }, data: { displayName: "Cookie" } });
    expect(res.status()).toBe(201);
    const sc = res.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value);
    expect(sc.length).toBe(1);
    expect(sc[0]).toMatch(/HttpOnly/);
    expect(sc[0]).toMatch(/SameSite=Strict/);
    expect(sc[0]).toMatch(/Path=\//);
    expect(sc[0]).toMatch(/Max-Age=\d+/);
    expect(sc[0], "tanpa atribut Domain (host-only)").not.toMatch(/;\s*Domain=/i);
    if (process.env.P10_WEBKIT !== "1") expect(sc[0]).toMatch(/;\s*Secure/);
    const tokenValue = sc[0]!.split("=")[1]!.split(";")[0]!;
    expect(await res.text(), "token tidak boleh ada di body respons").not.toContain(tokenValue);
  });

  test("IDOR: kredensial room A tidak membuka apa pun di room B (sesi, URL foto, frame, leave tidak mencabut orang lain)", async ({ playwright }) => {
    const mk = async () => {
      const ctx = await playwright.request.newContext({ extraHTTPHeaders: { Origin: WEB, "X-Forwarded-For": fakeIp() } });
      const r = await ctx.post(`${API}/api/rooms`, { data: { displayName: "Uji" } });
      expect(r.status()).toBe(201);
      return { ctx, body: (await r.json()) as { roomCode: string; participantId: string } };
    };
    const a = await mk();
    const b = await mk();
    const fakeAttempt = "00000000-0000-4000-8000-000000000000";
    // Cookie A dikirim ke room B (cookie per-room dipisah nama; konteks A tidak punya cookie B).
    for (const path of [`/api/rooms/${b.body.roomCode}/session`, `/api/rooms/${b.body.roomCode}/turn-credentials`]) {
      const r = await a.ctx.fetch(API + path, { method: path.endsWith("session") ? "POST" : "GET", data: {} });
      expect([401, 403, 404], path).toContain(r.status());
    }
    const att = await a.ctx.post(`${API}/api/rooms/${b.body.roomCode}/attempts/${fakeAttempt}/url?part=full`, { data: {} });
    expect([401, 403, 404]).toContain(att.status());
    const frames = await a.ctx.post(`${API}/api/rooms/${b.body.roomCode}/frames`, { data: { fileName: "x.png", contentType: "image/png", bytes: 10 } });
    expect([401, 403, 404]).toContain(frames.status());
    // Mengirim ID peserta B sebagai milik A tidak memberi apa pun; leave dari A hanya memengaruhi room A.
    const leaveA = await a.ctx.post(`${API}/api/rooms/${a.body.roomCode}/leave`, { data: {} });
    expect(leaveA.status()).toBe(200);
    const stillB = await b.ctx.post(`${API}/api/rooms/${b.body.roomCode}/session`, { data: {} });
    expect(stillB.status(), "room B tetap utuh setelah A keluar").toBe(200);
    await b.ctx.post(`${API}/api/rooms/${b.body.roomCode}/leave`, { data: {} });
    await a.ctx.dispose();
    await b.ctx.dispose();
  });

  test("health publik tidak membocorkan rahasia/DSN", async ({ request }) => {
    const t = await (await request.get(`${API}/api/health`)).text();
    expect(t).not.toMatch(/postgres|DATABASE|secret|token|nsk_|nak_|@.*neon/i);
  });
});
