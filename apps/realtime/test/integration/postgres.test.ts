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
});
