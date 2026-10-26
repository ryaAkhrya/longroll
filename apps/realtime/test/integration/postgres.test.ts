import { afterAll, describe, expect, it } from "vitest";
import { RoomActor } from "../../src/room/RoomActor";
import { createPgDb } from "../../src/store/db";
import { PostgresRoomStore } from "../../src/store/postgres";
import { StaleRevisionError } from "../../src/store/types";

/**
 * Tes integrasi adapter PostgreSQL — DILEWATI secara default.
 *
 * Hanya dijalankan MANUAL oleh pemilik database, setelah migrasi 0001 diterapkan, dengan
 * LONGROLL_TEST_DATABASE_URL menunjuk database/branch KHUSUS UJI (mis. Postgres lokal atau branch
 * Neon development). Jangan arahkan ke produksi. Tes hanya menyentuh baris dengan roomId/kode acak
 * miliknya sendiri dan menghapusnya di akhir.
 */
const url = process.env.LONGROLL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const CFG = {
  graceSeconds: 1,
  holdSeconds: 1,
  maxLifetimeHours: null,
  connectDeadlineMs: 1000,
  credentialTtlSeconds: 60,
  credentialRotationGraceMs: 1000,
};

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

suite("PostgresRoomStore (integrasi manual)", () => {
  const store = new PostgresRoomStore(createPgDb(url ?? "postgres://invalid", { poolMax: 2, statementTimeoutMs: 5000 }));
  const roomId = crypto.randomUUID();
  const code = randomCode();

  afterAll(async () => {
    await store.finalizeExpiredRoom(roomId, code, 0).catch(() => undefined);
    await store.purgeExpired().catch(() => undefined);
    await store.close();
  });

  it("skema 0001 sudah diterapkan", async () => {
    expect(await store.hasSchema()).toBe(true);
  });

  it("reserve → simpan room+peserta+event → muat → revisi basi ditolak → finalize", async () => {
    expect(await store.reserveCode(code, roomId)).toBe(true);
    expect(await store.reserveCode(code, crypto.randomUUID())).toBe(false);

    const actor = new RoomActor(RoomActor.createState(roomId, code, CFG), { store, config: CFG, onExpiring: () => undefined });
    const a = await actor.join("Nadia");
    await actor.join("Raka");
    actor.dispose();

    const loaded = await store.loadRoom(roomId);
    expect(Object.keys(loaded!.state.participants)).toHaveLength(2);
    expect(loaded!.state.participants[a.participant.participantId]!.color).toBe("P1");
    expect(loaded!.events.map((e) => e.type)).toContain("participant.joined");

    const stale = { ...loaded!.state, revision: loaded!.state.revision + 1 };
    await expect(
      store.saveRoom({ state: stale, expectedRevision: loaded!.state.revision - 1, events: [], changedParticipantIds: [] }),
    ).rejects.toBeInstanceOf(StaleRevisionError);

    expect(await store.hit(`test:${roomId}`, 60)).toBe(1);
    expect(await store.hit(`test:${roomId}`, 60)).toBe(2);
    expect(await store.peek(`test:${roomId}`, 60)).toBe(2);

    await store.finalizeExpiredRoom(roomId, code, 60);
    expect(await store.countRoomData(roomId)).toBe(0);
    expect(await store.resolveCode(code)).toBe("EXPIRED");
  });

  it("P04: sesi & voting tersimpan (lr_sessions), mode terkunci bertahan setelah muat ulang, finalize membersihkan", async () => {
    const rid = crypto.randomUUID();
    const c = randomCode();
    expect(await store.reserveCode(c, rid)).toBe(true);
    const actor = new RoomActor(RoomActor.createState(rid, c, CFG), { store, config: CFG, onExpiring: () => undefined });
    const conn = (id: string) => ({ id, send: () => undefined, close: () => undefined });
    const a = await actor.join("Nadia");
    const b = await actor.join("Raka");
    await actor.attach(conn("ca"), a.participant.participantId, null);
    await actor.attach(conn("cb"), b.participant.participantId, null);
    expect(await actor.intent(b.participant.participantId, "session.create", {})).toEqual({ ok: true });
    const sid = actor.view().activeSession!.sessionId;
    await actor.intent(a.participant.participantId, "vote.cast", { sessionId: sid, round: 1, mode: "GROUP_SHOT" });
    await actor.intent(b.participant.participantId, "vote.cast", { sessionId: sid, round: 1, mode: "GROUP_SHOT" });
    actor.dispose();

    const loaded = await store.loadRoom(rid);
    const s = loaded!.state.sessions[sid]!;
    expect(s).toMatchObject({ index: 1, state: "STUDIO", mode: "GROUP_SHOT", createdBy: b.participant.participantId });
    expect(s.voting).toMatchObject({ phase: "LOCKED", result: { mode: "GROUP_SHOT", method: "UNANIMOUS" } });
    expect(loaded!.state.activeSessionId).toBe(sid);

    await store.finalizeExpiredRoom(rid, c, 60);
    expect(await store.countRoomData(rid)).toBe(0);
  });

  it("P05: studio & frame custom tersimpan (lr_sessions.studio, lr_frames), dimuat ulang, dibersihkan cascade", async () => {
    const rid = crypto.randomUUID();
    const c = randomCode();
    expect(await store.reserveCode(c, rid)).toBe(true);
    const actor = new RoomActor(RoomActor.createState(rid, c, CFG), { store, config: CFG, onExpiring: () => undefined });
    const conn = (id: string) => ({ id, send: () => undefined, close: () => undefined });
    const a = await actor.join("Nadia");
    await actor.attach(conn("ca"), a.participant.participantId, null);
    await actor.intent(a.participant.participantId, "session.create", {});
    const sid = actor.view().activeSession!.sessionId;
    await actor.intent(a.participant.participantId, "vote.cast", { sessionId: sid, round: 1, mode: "PHOTO_GRID" });
    expect(await actor.intent(a.participant.participantId, "studio.update", { sessionId: sid, baseVersion: 1, patch: { shotCount: 3, style: { filterPreset: "FILM" } } })).toEqual({ ok: true });
    const pending = await actor.framePrepare(a.participant.participantId, { fileName: "f.png", contentType: "image/png", bytes: 1234 });
    const expired = await actor.framePrepare(a.participant.participantId, { fileName: "g.png", contentType: "image/png", bytes: 99 });
    await actor.frameReady(pending.frameId, {
      objectKey: pending.rawKey.replace(/\.upload$/, ".png"),
      bytes: 1000,
      template: { id: `room/${rid}/${pending.frameId}`, name: "f", category: "CUSTOM", modes: ["PHOTO_GRID"], baseSize: { w: 800, h: 800 }, adapt: "CONTAIN", layers: {}, palette: { bg: "#FFFFFF", ink: "#000000" }, license: { source: "uji" }, version: 1 },
    });
    await actor.frameDiscard(expired.frameId);
    actor.dispose();

    const loaded = await store.loadRoom(rid);
    const st = loaded!.state.sessions[sid]!.studio!;
    expect(st.layout.shotCount).toBe(3);
    expect(st.style.filterPreset).toBe("FILM");
    expect(st.undo?.changeId).toBe(st.lastChange!.changeId);
    expect(Object.keys(loaded!.state.frames)).toEqual([pending.frameId]);
    expect(loaded!.state.frames[pending.frameId]).toMatchObject({ status: "READY", bytes: 1000, expiresAtMs: null });

    await store.finalizeExpiredRoom(rid, c, 60);
    expect(await store.countRoomData(rid)).toBe(0);
  });
});
