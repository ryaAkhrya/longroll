import { afterAll, describe, expect, it } from "vitest";
import type { GalleryView } from "@longroll/shared";
import { RoomActor } from "../../src/room/RoomActor";
import { MemoryObjectStorage } from "../../src/storage/memory";
import { createPgDb } from "../../src/store/db";
import { PostgresRoomStore } from "../../src/store/postgres";
import { TestConn, jpeg, sha } from "../fixtures/capture";

/** P08 pada Neon `development` (role longroll_app): hasil sesi, galeri, sesi baru, snapshot editor, cascade bersih. */
const url = process.env.LONGROLL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const CFG = { graceSeconds: 1, holdSeconds: 1, maxLifetimeHours: null, connectDeadlineMs: 1000, credentialTtlSeconds: 60, credentialRotationGraceMs: 1000 };
const randomCode = () => Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

suite("P08 hasil sesi di PostgreSQL (Neon development)", () => {
  const store = new PostgresRoomStore(createPgDb(url ?? "postgres://invalid", { poolMax: 2, statementTimeoutMs: 8000 }));
  afterAll(async () => {
    await store.close();
  });

  it("finalisasi → SessionResult tersimpan; muat ulang setelah 'restart'; sesi baru menutup sesi lama; galeri; room bubar → bersih", async () => {
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
    for (const p of ppl) await actor.intent(p.id, "vote.cast", { sessionId: sid, round: 1, mode: "PHOTO_STRIP" });
    await actor.intent(a.id, "studio.update", { sessionId: sid, patch: { shotCount: 1, countdownSec: 3 } });
    for (const p of ppl) await actor.intent(p.id, "presence.set", { camera: "live", ready: true });
    expect(await actor.intent(a.id, "shot.arm", { sessionId: sid, shotIndex: 0 })).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 3300));
    for (const [i, p] of ppl.entries()) {
      const prep = await actor.intent(p.id, "attempt.prepare", { sessionId: sid, shotIndex: 0 });
      const id = (prep.data as { attemptId: string }).attemptId;
      const rec = actor.attemptRecord(id)!;
      const pv = await jpeg(320, 240, i + 1);
      const full = await jpeg(800, 600, i + 1);
      await storage.put(rec.previewKey!, pv, "image/jpeg");
      await storage.put(rec.fullKey!, full, "image/jpeg");
      await actor.intent(p.id, "attempt.uploaded", { attemptId: id, part: "preview", bytes: pv.byteLength, width: 320, height: 240, sha256: sha(pv) });
      await actor.intent(p.id, "attempt.uploaded", { attemptId: id, part: "full", bytes: full.byteLength, width: 800, height: 600, sha256: sha(full) });
      expect(await actor.intent(p.id, "capture.accept", { sessionId: sid, shotIndex: 0, attemptId: id })).toEqual({ ok: true });
    }
    expect(actor.view().activeSession!.state).toBe("EDITING");
    expect(await actor.intent(b.id, "editor.sync", { sessionId: sid, stateVector: "" })).toMatchObject({ ok: true });
    expect(await actor.intent(b.id, "session.finalize", { sessionId: sid })).toEqual({ ok: true });

    const saved = (await store.loadRoom(rid))!;
    const r = saved.state.sessions[sid]!.result!;
    expect(saved.state.sessions[sid]!.state).toBe("FINAL");
    expect(r).toMatchObject({ version: 1, finalizedBy: b.id, previewReady: false, title: "Sesi 1" });
    expect(r.acceptedAttempts).toHaveLength(2);
    expect(await store.loadEditorDoc(sid)).not.toBeNull();
    expect((await storage.list(`rooms/${rid}/sessions/`)).some((k) => k.endsWith("doc.bin"))).toBe(true);

    expect(await actor.intent(a.id, "session.create", {})).toEqual({ ok: true });
    const after = (await store.loadRoom(rid))!;
    expect(after.state.sessions[sid]!.state).toBe("CLOSED");
    expect(after.state.sessions[sid]!.result).toMatchObject({ version: 1 });
    expect(after.state.sessionOrder).toHaveLength(2);
    const g = (await actor.intent(a.id, "gallery.get", {})).data as GalleryView;
    expect(g.sessions).toHaveLength(1);
    expect(g.perPerson).toHaveLength(2);
    actor.dispose();

    await store.finalizeExpiredRoom(rid, code, 60);
    expect(await store.countRoomData(rid)).toBe(0);
    expect(await store.loadEditorDoc(sid)).toBeNull();
  });
});
