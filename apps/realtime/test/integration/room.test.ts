import { afterEach, describe, expect, it } from "vitest";
import { WS_CLOSE } from "@longroll/shared";
import { Client, sleep, startServer } from "./helpers";
import type { TestServer } from "./helpers";

let srv: TestServer;
afterEach(async () => {
  await srv?.close();
});

describe("HTTP API room (TC-ROOM-001..005)", () => {
  it("create → preview (inisial saja) → join → peserta ke-5 ditolak", async () => {
    srv = await startServer();
    const nadia = new Client(srv);
    const created = await nadia.create("Nadia");
    expect(created.status).toBe(201);
    const code = created.body!.roomCode as string;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(created.body).not.toHaveProperty("participantToken");
    expect(created.res.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Strict/);

    const preview = await new Client(srv).request("GET", `/api/rooms/${code}/preview`);
    expect(preview.body).toMatchObject({ exists: true, participantCount: 1, initials: ["N"] });
    expect(JSON.stringify(preview.body)).not.toContain("Nadia");

    for (const n of ["Raka", "Sasa", "Bimo"]) expect((await new Client(srv).join(code, n)).status).toBe(200);
    const fifth = await new Client(srv).join(code, "Eko");
    expect(fifth.status).toBe(409);
    expect(fifth.body).toMatchObject({ error: "ROOM_FULL" });
  });

  it("join bersamaan untuk slot terakhir aman (EC-02)", async () => {
    srv = await startServer();
    const code = (await new Client(srv).create("A")).body!.roomCode as string;
    await new Client(srv).join(code, "B");
    await new Client(srv).join(code, "C");
    const results = await Promise.all(["D", "E", "F"].map((n) => new Client(srv).join(code, n)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
  });

  it("menolak POST tanpa Origin yang diizinkan (TH-13) dan kode tidak dikenal", async () => {
    srv = await startServer();
    const c = new Client(srv);
    expect((await c.request("POST", "/api/rooms", { displayName: "A" }, { origin: null })).status).toBe(403);
    expect((await c.request("POST", "/api/rooms", { displayName: "A" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await c.request("GET", "/api/rooms/ZZZZZZ/preview")).status).toBe(404);
    expect((await c.create("<b>x</b>")).body).toMatchObject({ error: "NAME_INVALID" });
  });

  it("rate limit kode salah (DEC-067)", async () => {
    srv = await startServer();
    const c = new Client(srv, "198.51.100.7");
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await c.request("GET", `/api/rooms/ZZZZZ${"ABCDEFGHJKLMNPQRSTUVW"[i]}/preview`)).status;
    expect(last).toBe(429);
  });
});

describe("WebSocket presence & lifecycle", () => {
  it("tanpa cookie / Origin salah → upgrade ditolak", async () => {
    srv = await startServer();
    const code = (await new Client(srv).create("A")).body!.roomCode as string;
    await expect(new Client(srv).connect(code)).rejects.toThrow("HTTP 401");
  });

  it("presence join/leave tersiar, kursor di-relay, keluar mencabut cookie (TC-ROOM-012)", async () => {
    srv = await startServer();
    const a = new Client(srv);
    const code = (await a.create("Nadia")).body!.roomCode as string;
    const sa = await a.connect(code);
    const b = new Client(srv);
    await b.join(code, "Raka");
    await sa.waitFor("participant.joined");
    const sb = await b.connect(code);

    sb.send("cursor.move", { surface: "lobby", x: 0.5, y: 0.25 });
    const cur = await sa.waitFor("cursor.move");
    expect(cur.payload).toMatchObject({ x: 0.5, y: 0.25 });
    expect(cur.seq).toBeUndefined();

    sb.send("participant.leave", {}, "leave-1");
    await sa.waitFor("participant.left");
    expect(await sb.waitClose()).toBe(WS_CLOSE.LEFT);
    const again = await b.request("POST", `/api/rooms/${code}/session`);
    expect(again.status).toBe(401);
  });

  it("reload: session merotasi token, resume dengan lastSeq me-replay event (TC-ROOM-020)", async () => {
    srv = await startServer();
    const a = new Client(srv);
    const code = (await a.create("Nadia")).body!.roomCode as string;
    const s1 = await a.connect(code);
    const auth = await s1.waitFor("auth.ok");
    const lastSeq = (auth.payload as { room: { lastSeq: number } }).room.lastSeq;
    s1.close();
    await sleep(100);
    await new Client(srv).join(code, "Raka");

    const ses = await a.request("POST", `/api/rooms/${code}/session`);
    expect(ses.status).toBe(200);
    const s2 = await a.connect(code, lastSeq);
    const ok = await s2.waitFor("auth.ok");
    expect(ok.payload).toMatchObject({ resumedFromSeq: lastSeq });
    await s2.waitFor("participant.joined");
  });

  it("multi-tab takeover (TC-ROOM-024)", async () => {
    srv = await startServer();
    const a = new Client(srv);
    const code = (await a.create("Nadia")).body!.roomCode as string;
    const tab1 = await a.connect(code);
    await a.connect(code);
    await tab1.waitFor("session.replaced");
    expect(await tab1.waitClose()).toBe(WS_CLOSE.REPLACED);
  });

  it("hold habis → LEFT; grace habis → 410 + tombstone + storage bersih (TC-ROOM-022, TC-SEC-030)", async () => {
    srv = await startServer({ PARTICIPANT_HOLD_SECONDS: "0.3", ROOM_GRACE_PERIOD_SECONDS: "0.8" });
    const a = new Client(srv);
    const created = await a.create("Nadia");
    const code = created.body!.roomCode as string;
    const roomId = created.body!.roomId as string;
    srv.storage.put(`rooms/${roomId}/attempts/x/preview.jpg`);
    const s = await a.connect(code);
    s.close();
    await sleep(500);
    // Lewat hold, belum lewat grace: kredensial lama tidak dipulihkan, tapi join ulang boleh.
    expect((await a.request("POST", `/api/rooms/${code}/session`)).status).toBe(401);
    await sleep(800);
    const preview = await new Client(srv).request("GET", `/api/rooms/${code}/preview`);
    expect(preview.status).toBe(410);
    expect(preview.body).toMatchObject({ error: "ROOM_EXPIRED" });
    await sleep(200);
    expect(await srv.storage.list(`rooms/${roomId}/`)).toEqual([]);
    expect(await srv.store.countRoomData(roomId)).toBe(0);
  });
});

describe("P03: signaling WebRTC & ICE servers", () => {
  it("rtc.* di-relay hanya ke target di room yang sama; `from` dari server; tidak bisa lintas room", async () => {
    srv = await startServer();
    const a = new Client(srv);
    const code = (await a.create("Nadia")).body!.roomCode as string;
    const sa = await a.connect(code);
    const b = new Client(srv);
    const joined = await b.join(code, "Raka");
    const bId = joined.body!.participantId as string;
    const sb = await b.connect(code);
    const auth = await sa.waitFor("auth.ok");
    const aId = (auth.payload as { participantId: string }).participantId;

    sa.send("rtc.offer", { to: bId, from: "pemalsu", pc: "pc-a", sdp: { type: "offer", sdp: "v=0" } });
    const offer = await sb.waitFor("rtc.offer");
    expect(offer.payload).toMatchObject({ from: aId, pc: "pc-a" });

    // Room lain: tidak bisa mengirim ke peserta room ini.
    const x = new Client(srv);
    const code2 = (await x.create("Orang Lain")).body!.roomCode as string;
    const sx = await x.connect(code2);
    sx.send("rtc.ice", { to: bId, pc: "pc-x", candidate: null });
    sa.send("rtc.ice", { to: bId, pc: "pc-a", candidate: null });
    const ice = await sb.waitFor("rtc.ice");
    expect(ice.payload).toMatchObject({ from: aId });
    expect(sb.messages.filter((m) => m.type === "rtc.ice")).toHaveLength(1);

    // Bentuk salah dibuang diam-diam.
    sa.send("rtc.answer", { to: bId, pc: "pc-a", sdp: { type: "offer", sdp: "x" } });
    await sleep(100);
    expect(sb.messages.some((m) => m.type === "rtc.answer")).toBe(false);
  });

  it("turn-credentials: butuh cookie; STUN saja bila TURN tidak dikonfigurasi", async () => {
    srv = await startServer({ STUN_URLS: "stun:stun.example.test:3478" });
    const a = new Client(srv);
    const code = (await a.create("Nadia")).body!.roomCode as string;
    expect((await new Client(srv).request("GET", `/api/rooms/${code}/turn-credentials`)).status).toBe(401);
    const r = await a.request("GET", `/api/rooms/${code}/turn-credentials`);
    expect(r.body).toMatchObject({ turn: false, iceServers: [{ urls: ["stun:stun.example.test:3478"] }] });
  });

  it("turn-credentials: HMAC sementara (username = expiry:participantId) bila TURN dikonfigurasi", async () => {
    srv = await startServer({ TURN_URLS: "turn:turn.example.test:3478?transport=udp,turns:turn.example.test:443", TURN_SHARED_SECRET: "rahasia-uji", STUN_URLS: "none" });
    const a = new Client(srv);
    const created = await a.create("Nadia");
    const code = created.body!.roomCode as string;
    const r = await a.request("GET", `/api/rooms/${code}/turn-credentials`);
    const turn = (r.body!.iceServers as { urls: string[]; username: string; credential: string }[])[0]!;
    expect(r.body!.turn).toBe(true);
    const [expiry, pid] = turn.username.split(":");
    expect(pid).toBe(created.body!.participantId);
    expect(Number(expiry)).toBeGreaterThan(Date.now() / 1000);
    const { createHmac } = await import("node:crypto");
    expect(turn.credential).toBe(createHmac("sha1", "rahasia-uji").update(turn.username).digest("base64"));
  });
});

describe("P04: voting mode lewat WebSocket", () => {
  it("4 peserta, suara bersamaan → hasil identik; Tutup vote awal ditolak; intent duplikat tidak menggandakan", async () => {
    srv = await startServer();
    const a = new Client(srv);
    const code = (await a.create("Nadia")).body!.roomCode as string;
    const clients = [a];
    for (const n of ["Raka", "Sasa", "Dimas"]) {
      const c = new Client(srv);
      await c.join(code, n);
      clients.push(c);
    }
    const socks = await Promise.all(clients.map((c) => c.connect(code)));

    socks[3]!.send("session.create", {}, "s-1");
    socks[3]!.send("session.create", {}, "s-1");
    const ack = await socks[3]!.waitFor("ack", (m) => m.replyTo === "s-1");
    expect(ack.payload).toEqual({ ok: true });
    const st = await socks[0]!.waitFor("session.state");
    const session = (st.payload as { session: { sessionId: string; voting: { round: number } } }).session;
    await socks[0]!.waitFor("session.invite");

    socks[0]!.send("vote.close", { sessionId: session.sessionId, round: 1 }, "c-early");
    expect((await socks[0]!.waitFor("ack", (m) => m.replyTo === "c-early")).payload).toEqual({ ok: false, error: "CLOSE_NOT_ALLOWED" });

    const modes = ["PHOTO_STRIP", "PHOTO_STRIP", "PHOTO_STRIP", "FREEFORM_COLLAGE"];
    socks.forEach((s, i) => s.send("vote.cast", { sessionId: session.sessionId, round: 1, mode: modes[i] }, `v-${i}`));
    const resolved = await Promise.all(socks.map((s) => s.waitFor("vote.resolved")));
    expect(new Set(resolved.map((r) => JSON.stringify(r.payload))).size).toBe(1);
    expect(resolved[0]!.payload).toMatchObject({ mode: "PHOTO_STRIP", method: "MAJORITY" });

    socks[1]!.send("vote.cast", { sessionId: session.sessionId, round: 1, mode: "GROUP_SHOT" }, "late");
    expect((await socks[1]!.waitFor("ack", (m) => m.replyTo === "late")).payload).toEqual({ ok: false, error: "MODE_LOCKED" });
    const created = socks[3]!.messages.filter((m) => m.type === "session.invite");
    expect(created).toHaveLength(1);
  });
});
