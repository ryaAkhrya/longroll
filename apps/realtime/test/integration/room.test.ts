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
