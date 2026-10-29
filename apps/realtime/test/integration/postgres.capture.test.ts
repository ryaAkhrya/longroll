import { afterAll, describe, expect, it, vi } from "vitest";
import { RoomActor } from "../../src/room/RoomActor";
import { createPgDb } from "../../src/store/db";
import { PostgresRoomStore } from "../../src/store/postgres";
import { MemoryObjectStorage } from "../../src/storage/memory";
import { jpeg, sha, TestConn } from "../fixtures/capture";

/**
 * P06 pada Neon `development` dengan role longroll_app (LONGROLL_TEST_DATABASE_URL). Hanya menyentuh
 * baris dengan roomId/kode acak miliknya sendiri dan menghapusnya di akhir.
 */
const url = process.env.LONGROLL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const CFG = { graceSeconds: 1, holdSeconds: 1, maxLifetimeHours: null, connectDeadlineMs: 1000, credentialTtlSeconds: 60, credentialRotationGraceMs: 1000 };
const randomCode = () => Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

suite("P06 persistensi capture di PostgreSQL (Neon development)", () => {
  const store = new PostgresRoomStore(createPgDb(url ?? "postgres://invalid", { poolMax: 2, statementTimeoutMs: 8000 }));
  afterAll(async () => {
    await store.close();
  });

  it("shot, attempt, accepted, retake tersimpan; dimuat ulang setelah 'restart'; finalize membersihkan semua baris", async () => {
    const rid = crypto.randomUUID();
    const code = randomCode();
    const storage = new MemoryObjectStorage();
    expect(await store.reserveCode(code, rid)).toBe(true);
    const actor = new RoomActor(RoomActor.createState(rid, code, CFG), { store, config: CFG, onExpiring: () => undefined, storage });
    const ppl: { id: string; conn: TestConn }[] = [];
    for (const n of ["Nadia", "Raka"]) {
      const j = await actor.join(n);
      const conn = new TestConn();
      await actor.attach(conn, j.participant.participantId, null);
      ppl.push({ id: j.participant.participantId, conn });
    }
    const [a, b] = ppl as [(typeof ppl)[0], (typeof ppl)[0]];
    await actor.intent(a.id, "session.create", {});
    const sid = actor.view().activeSession!.sessionId;
    for (const p of ppl) await actor.intent(p.id, "vote.cast", { sessionId: sid, round: 1, mode: "PHOTO_GRID" });
    for (const p of ppl) await actor.intent(p.id, "presence.set", { camera: "live", ready: true });
    await actor.intent(a.id, "studio.update", { sessionId: sid, patch: { countdownSec: 3 } });
    expect(await actor.intent(a.id, "shot.arm", { sessionId: sid, shotIndex: 0 })).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 3300));

    const shoot = async (p: (typeof ppl)[0], seed: number) => {
      const prep = await actor.intent(p.id, "attempt.prepare", { sessionId: sid, shotIndex: 0 });
      expect(prep.ok).toBe(true);
      const id = (prep.data as { attemptId: string }).attemptId;
      const rec = actor.attemptRecord(id)!;
      const pv = await jpeg(320, 240, seed);
      const full = await jpeg(800, 600, seed);
      await storage.put(rec.previewKey!, pv, "image/jpeg");
      await storage.put(rec.fullKey!, full, "image/jpeg");
      expect(await actor.intent(p.id, "attempt.uploaded", { attemptId: id, part: "preview", bytes: pv.byteLength, width: 320, height: 240, sha256: sha(pv) })).toEqual({ ok: true });
      expect(await actor.intent(p.id, "attempt.uploaded", { attemptId: id, part: "full", bytes: full.byteLength, width: 800, height: 600, sha256: sha(full) })).toEqual({ ok: true });
      return id;
    };
    const ia = await shoot(a, 1);
    const ib = await shoot(b, 2);
    expect(await actor.intent(b.id, "capture.accept", { sessionId: sid, shotIndex: 0, attemptId: ib })).toEqual({ ok: true });
    expect(await actor.intent(a.id, "capture.retake", { sessionId: sid, shotIndex: 0, attemptId: ia })).toEqual({ ok: true });
    actor.dispose();

    // "Restart": muat dari Postgres.
    const loaded = (await store.loadRoom(rid))!;
    const s = loaded.state.sessions[sid]!;
    expect(s.state).toBe("CAPTURING");
    expect(s.studio!.structureLocked).toBe(true);
    const shot = s.capture!.shots[0]!;
    expect(shot).toMatchObject({ state: "REVIEW", required: expect.arrayContaining([a.id, b.id]) });
    expect(shot.perParticipant[b.id]).toMatchObject({ status: "ACCEPTED", acceptedAttemptId: ib });
    expect(shot.perParticipant[a.id]).toMatchObject({ status: "RETAKE_COUNTDOWN", acceptedAttemptId: null });
    expect(s.capture!.attempts[ia]).toMatchObject({ status: "REJECTED", attemptNo: 1 });
    expect(s.capture!.attempts[ib]!.full!.bytes).toBeGreaterThan(0);
    expect(s.capture!.bytesUsed).toBeGreaterThan(0);
    const actor2 = new RoomActor(loaded.state, { store, config: CFG, onExpiring: () => undefined, storage }, loaded.events);
    for (const p of ppl) await actor2.attach(new TestConn(), p.id, null);
    expect(actor2.view().activeSession!.capture!.shots[0]!.perParticipant[b.id]!.acceptedAttemptId).toBe(ib);
    actor2.dispose();

    await store.finalizeExpiredRoom(rid, code, 60);
    expect(await store.countRoomData(rid)).toBe(0);
    vi.useRealTimers();
  });
});
