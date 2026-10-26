import { afterEach, describe, expect, it } from "vitest";
import type { FramePrepareResponse } from "@longroll/shared";
import { bombPng, framePng } from "../fixtures/frames";
import { Client, ORIGIN, sleep, startServer } from "./helpers";
import type { TestServer } from "./helpers";

let srv: TestServer;
afterEach(async () => {
  await srv?.close();
});

async function upload(c: Client, code: string, bytes: Buffer, opts: { contentType?: string; fileName?: string; declared?: number } = {}) {
  const contentType = opts.contentType ?? "image/png";
  const prep = await c.request("POST", `/api/rooms/${code}/frames`, { fileName: opts.fileName ?? "frame-kita.png", contentType, bytes: opts.declared ?? bytes.byteLength });
  if (prep.status !== 200) return { prep, put: null, done: null };
  const p = prep.body as unknown as FramePrepareResponse;
  const put = await fetch(p.uploadUrl, { method: "PUT", headers: { ...p.uploadHeaders, Origin: ORIGIN }, body: bytes });
  const done = await c.request("POST", `/api/rooms/${code}/frames/${p.frameId}/complete`);
  return { prep, put, done, frameId: p.frameId };
}

describe("P05: upload frame custom (TC-FRAME-010/011, TC-SEC-016/017)", () => {
  it("presign → PUT → complete → frame.added ke peserta lain; signed URL bisa dibaca & berumur pendek", async () => {
    srv = await startServer();
    const a = new Client(srv);
    const created = await a.create("Nadia");
    const code = created.body!.roomCode as string;
    const roomId = created.body!.roomId as string;
    const b = new Client(srv);
    await b.join(code, "Raka");
    const sb = await b.connect(code);

    const r = await upload(a, code, await framePng(), { fileName: "../../etc/frame\u0007-kita.png" });
    expect(r.put!.status).toBe(200);
    expect(r.done!.status).toBe(200);
    expect(r.done!.body).toMatchObject({ holes: 4, frame: { template: { category: "CUSTOM", adapt: "FIXED", fileName: "frame-kita.png" } } });
    const added = await sb.waitFor("frame.added");
    expect(added.payload).toMatchObject({ frame: { frameId: r.frameId } });

    // Objek mentah dihapus, hasil re-encode ada di bawah prefix room.
    const keys = await srv.storage.list(`rooms/${roomId}/frames/`);
    expect(keys).toEqual([`rooms/${roomId}/frames/${r.frameId}.png`]);

    const u = await b.request("GET", `/api/rooms/${code}/frames/${r.frameId}/url`);
    expect(u.status).toBe(200);
    expect((u.body!.expiresAtMs as number) - Date.now()).toBeLessThanOrEqual(600_000);
    const img = await fetch(u.body!.url as string, { headers: { Origin: ORIGIN } });
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    // Token dimodifikasi → ditolak; tanpa cookie → URL tidak diterbitkan.
    expect((await fetch(`${u.body!.url as string}x`)).status).toBe(403);
    expect((await new Client(srv).request("GET", `/api/rooms/${code}/frames/${r.frameId}/url`)).status).toBe(401);
    // complete ganda = idempoten.
    expect((await a.request("POST", `/api/rooms/${code}/frames/${r.frameId}/complete`)).status).toBe(200);
    // Peserta lain tidak bisa menyelesaikan upload milik orang lain.
    const r2 = await a.request("POST", `/api/rooms/${code}/frames`, { fileName: "x.png", contentType: "image/png", bytes: 10 });
    expect((await b.request("POST", `/api/rooms/${code}/frames/${r2.body!.frameId as string}/complete`)).status).toBe(404);
  });

  it("AC-P05-5: > 10 MB ditolak saat presign (413) dan body PUT melebihi deklarasi ditolak (413)", async () => {
    srv = await startServer();
    const a = new Client(srv);
    const code = (await a.create("Nadia")).body!.roomCode as string;
    const big = await a.request("POST", `/api/rooms/${code}/frames`, { fileName: "frame-glitter.png", contentType: "image/png", bytes: 14 * 1024 * 1024 });
    expect(big.status).toBe(413);
    expect(big.body).toMatchObject({ error: "FRAME_TOO_LARGE" });
    const lie = await upload(a, code, Buffer.alloc(5000, 1), { declared: 1000 });
    expect(lie.put!.status).toBe(413);
    expect((await a.request("POST", `/api/rooms/${code}/frames`, { fileName: "a.gif", contentType: "image/gif", bytes: 100 })).status).toBe(400);
  });

  it("AC-P05-7: SVG menyamar & bomb ditolak saat complete; record & objek dibersihkan", async () => {
    srv = await startServer();
    const a = new Client(srv);
    const created = await a.create("Nadia");
    const code = created.body!.roomCode as string;
    const roomId = created.body!.roomId as string;
    const svg = await upload(a, code, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    expect(svg.done!.status).toBe(400);
    expect(svg.done!.body).toMatchObject({ error: "FRAME_UNSUPPORTED" });
    const bomb = await upload(a, code, bombPng());
    expect(bomb.done!.status).toBe(422);
    expect(bomb.done!.body).toMatchObject({ error: "FRAME_DIMENSIONS" });
    expect(await srv.storage.list(`rooms/${roomId}/frames/`)).toEqual([]);
    // Content-Type PUT berbeda dari yang ditandatangani → ditolak.
    const prep = await a.request("POST", `/api/rooms/${code}/frames`, { fileName: "x.png", contentType: "image/png", bytes: 10 });
    const put = await fetch(prep.body!.uploadUrl as string, { method: "PUT", headers: { "Content-Type": "image/svg+xml" }, body: Buffer.alloc(10) });
    expect(put.status).toBe(403);
  });

  it("DEC-067: 20 upload/jam/peserta (RATE_LIMITED) dan 20 frame/room (FRAME_QUOTA)", async () => {
    srv = await startServer();
    const a = new Client(srv);
    const code = (await a.create("Nadia")).body!.roomCode as string;
    const b = new Client(srv);
    await b.join(code, "Raka");
    for (let i = 0; i < 20; i++) {
      expect((await a.request("POST", `/api/rooms/${code}/frames`, { fileName: `f${i}.png`, contentType: "image/png", bytes: 100 })).status).toBe(200);
    }
    const limited = await a.request("POST", `/api/rooms/${code}/frames`, { fileName: "x.png", contentType: "image/png", bytes: 100 });
    expect(limited.body).toMatchObject({ error: "RATE_LIMITED" });
    const quota = await b.request("POST", `/api/rooms/${code}/frames`, { fileName: "x.png", contentType: "image/png", bytes: 100 });
    expect(quota.status).toBe(409);
    expect(quota.body).toMatchObject({ error: "FRAME_QUOTA" });
  });

  it("frame custom berlubang dipasang buat semua (FIXED) & room bubar → objek frame ikut terhapus (TC-SEC-030)", async () => {
    srv = await startServer({ PARTICIPANT_HOLD_SECONDS: "0.3", ROOM_GRACE_PERIOD_SECONDS: "0.8" });
    const a = new Client(srv);
    const created = await a.create("Nadia");
    const code = created.body!.roomCode as string;
    const roomId = created.body!.roomId as string;
    const s = await a.connect(code);
    const r = await upload(a, code, await framePng());
    s.send("session.create", {}, "c1");
    const st = await s.waitFor("session.state");
    const sid = (st.payload as { session: { sessionId: string } }).session.sessionId;
    s.send("vote.cast", { sessionId: sid, round: 1, mode: "PHOTO_STRIP" }, "v1");
    await s.waitFor("vote.resolved");
    s.send("studio.update", { sessionId: sid, baseVersion: 1, patch: { frame: { frameId: r.frameId, source: "CUSTOM", adapt: "FIXED", overlayOpacity: 1 } } }, "u1");
    const ack = await s.waitFor("ack", (m) => m.replyTo === "u1");
    expect(ack.payload).toEqual({ ok: true });
    const upd = await s.waitFor("studio.updated");
    expect((upd.payload as { studio: { layout: { arrangement: string; slots: unknown[] } } }).studio.layout).toMatchObject({ arrangement: "CUSTOM" });
    expect(await srv.storage.list(`rooms/${roomId}/`)).toHaveLength(1);
    s.close();
    await sleep(1600);
    expect(await srv.storage.list(`rooms/${roomId}/`)).toEqual([]);
    expect(await srv.store.countRoomData(roomId)).toBe(0);
  });
});
