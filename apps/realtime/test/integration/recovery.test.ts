import { afterAll, afterEach, describe, expect, it } from "vitest";
import { MemoryObjectStorage } from "../../src/storage/memory";
import { createPgDb } from "../../src/store/db";
import { MemoryRoomStore } from "../../src/store/memory";
import { PostgresRoomStore } from "../../src/store/postgres";
import type { RoomStore } from "../../src/store/types";
import { Client, sleep, startServer } from "./helpers";
import type { TestServer } from "./helpers";

/**
 * IC-6 (P09): restart instance realtime tunggal di tengah voting, sambil room diakses lewat HTTP+WS sungguhan.
 * "Crash" = server dimatikan tanpa flush (sama seperti SIGKILL: tak ada shutdown rapi), instance baru memakai
 * store + storage yang sama. Dijalankan pada store memori; pada Neon `development` bila LONGROLL_TEST_DATABASE_URL
 * diset (room uji dibersihkan sendiri — hanya room yang dibuat tes ini).
 */
const url = process.env.LONGROLL_TEST_DATABASE_URL;
let running: TestServer[] = [];
afterEach(async () => {
  await Promise.all(running.map((s) => s.close().catch(() => undefined)));
  running = [];
});

async function votingRestart(store: RoomStore, created: string[], lookupOnly: boolean) {
  const storage = new MemoryObjectStorage();
  const env = { COOKIE_SECURE: "false", ROOM_GRACE_PERIOD_SECONDS: "30", PARTICIPANT_HOLD_SECONDS: "30", TRUST_PROXY: "true" };
  let srv = await startServer(env, store, storage);
  running.push(srv);
  const a = new Client(srv, "198.51.100.10");
  const b = new Client(srv, "198.51.100.11");
  const made = await a.create("Nadia");
  const code = made.body!.roomCode as string;
  created.push(made.body!.roomId as string);
  await b.join(code, "Raka");
  const sa = await a.connect(code);
  const sb = await b.connect(code);
  sa.send("session.create", {}, "s1");
  await sa.waitFor("ack", (m) => m.replyTo === "s1");
  const st = await sa.waitFor("session.state");
  const sid = (st.payload as { session: { sessionId: string } }).session.sessionId;
  sa.send("vote.cast", { sessionId: sid, round: 1, mode: "PHOTO_STRIP" }, "v1");
  expect((await sa.waitFor("ack", (m) => m.replyTo === "v1")).payload).toEqual({ ok: true });
  await sleep(150);
  const lastSeq = Math.max(...sb.messages.map((m) => m.seq ?? 0));

  // ---- CRASH: tanpa flush/graceful. Semua WS putus; instance baru memuat dari store.
  await srv.close();
  running = [];
  const restartedAt = Date.now();
  srv = await startServer(env, store, storage);
  running.push(srv);
  a.rebind(srv);
  b.rebind(srv);
  if (lookupOnly) await srv.app.manager.lookup(code);
  else await srv.app.manager.recover();
  const recoverMs = Date.now() - restartedAt;

  // Kredensial lama tetap sah (hash token tersimpan) → rotasi sesi + resume dari lastSeq.
  expect((await b.request("POST", `/api/rooms/${code}/session`)).status).toBe(200);
  const sb2 = await b.connect(code, lastSeq);
  const resumeMs = Date.now() - restartedAt;
  // Suara A sebelum crash tidak hilang: suara B yang sama → langsung resolved (2 dari 2).
  sb2.send("vote.cast", { sessionId: sid, round: 1, mode: "PHOTO_STRIP" }, "v2");
  expect((await sb2.waitFor("ack", (m) => m.replyTo === "v2")).payload).toEqual({ ok: true });
  const resolved = await sb2.waitFor("vote.resolved");
  expect(resolved.payload).toMatchObject({ mode: "PHOTO_STRIP" });
  // A kembali setelah B; peserta tetap 2 (tidak ada duplikasi), dan sesi tidak ganda.
  expect((await a.request("POST", `/api/rooms/${code}/session`)).status).toBe(200);
  const sa2 = await a.connect(code);
  const auth = (await sa2.waitFor("auth.ok")).payload as { room?: { participants: unknown[]; activeSession?: { sessionId: string } } };
  expect(auth.room?.participants).toHaveLength(2);
  expect(auth.room?.activeSession?.sessionId).toBe(sid);
  return { recoverMs, resumeMs, code };
}

describe("IC-6: restart instance tunggal saat voting (store memori)", () => {
  it("room, suara & kredensial pulih; resume ≤ 10 dtk (AC-5)", async () => {
    const r = await votingRestart(new MemoryRoomStore(), [], false);
    console.log(`[IC-6 memory] recover=${r.recoverMs}ms resume=${r.resumeMs}ms`);
    expect(r.resumeMs).toBeLessThan(10_000);
  });

  it("store mati sesaat setelah restart: event kritis ditolak SERVICE_UNAVAILABLE lalu diterima setelah pulih (retry aman)", async () => {
    const store = new MemoryRoomStore();
    const srv = await startServer({ COOKIE_SECURE: "false" }, store);
    running.push(srv);
    const a = new Client(srv);
    const code = (await a.create("Nadia")).body!.roomCode as string;
    const sa = await a.connect(code);
    store.failing = true;
    sa.send("session.create", {}, "sx");
    const down = await sa.waitFor("ack", (m) => m.replyTo === "sx");
    expect(down.payload).toMatchObject({ ok: false, error: "SERVICE_UNAVAILABLE" });
    store.failing = false;
    sa.send("session.create", {}, "sx"); // clientEventId sama: kegagalan sementara tidak di-cache
    const up = await sa.waitFor("ack", (m) => m.replyTo === "sx" && (m.payload as { ok: boolean }).ok === true, 3000);
    expect(up.payload).toEqual({ ok: true });
    // Kursor (volatile) tetap jalan walau store mati.
    store.failing = true;
    sa.send("cursor.move", { surface: "lobby", x: 0.1, y: 0.1 });
    await sleep(50);
    expect(sa.ws.readyState).toBe(1);
    store.failing = false;
  });
});

const pg = url ? describe : describe.skip;
pg("IC-6 pada Neon development (role longroll_app)", () => {
  const store = new PostgresRoomStore(createPgDb(url ?? "postgres://invalid", { poolMax: 3, statementTimeoutMs: 8000 }));
  const created: string[] = [];
  afterAll(async () => {
    // Hanya room yang dibuat tes ini: kode dilepas & baris dihapus lewat jalur finalisasi resmi.
    for (const id of created) {
      const loaded = await store.loadRoom(id).catch(() => null);
      if (loaded) await store.finalizeExpiredRoom(id, loaded.state.code, 1).catch(() => undefined);
    }
    await store.close();
  });

  it("restart saat voting: pemulihan on-demand dari Postgres, resume ≤ 10 dtk", async () => {
    const r = await votingRestart(store, created, true);
    console.log(`[IC-6 neon] recover(lookup)=${r.recoverMs}ms resume=${r.resumeMs}ms`);
    expect(r.resumeMs).toBeLessThan(10_000);
  });
});
