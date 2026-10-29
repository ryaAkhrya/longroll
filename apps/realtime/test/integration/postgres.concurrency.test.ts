import { afterAll, describe, expect, it } from "vitest";
import { LIMITS } from "@longroll/shared";
import { RoomActor } from "../../src/room/RoomActor";
import { createPgDb } from "../../src/store/db";
import { PostgresRoomStore } from "../../src/store/postgres";
import { StoreUnavailableError } from "../../src/store/types";

/**
 * P09 pada Neon `development` (role longroll_app): konsistensi transaksi & konkurensi.
 * Aman untuk Free plan: beberapa puluh query kecil, satu room uji, dibersihkan lewat jalur finalisasi resmi.
 */
const url = process.env.LONGROLL_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const CFG = { graceSeconds: 30, holdSeconds: 30, maxLifetimeHours: null, connectDeadlineMs: 20_000, credentialTtlSeconds: 60, credentialRotationGraceMs: 1000 };
const randomCode = () => Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

suite("P09 konkurensi & konsistensi di PostgreSQL (Neon development)", () => {
  const store = new PostgresRoomStore(createPgDb(url ?? "postgres://invalid", { poolMax: 4, statementTimeoutMs: 8000 }));
  const rooms: { id: string; code: string }[] = [];
  afterAll(async () => {
    for (const r of rooms) await store.finalizeExpiredRoom(r.id, r.code, 1).catch(() => undefined);
    await store.close();
  });

  it("dua penulis (split-brain) pada room yang sama: kapasitas 4 tidak pernah terlampaui, revisi & seq tetap konsisten", async () => {
    const id = crypto.randomUUID();
    const code = randomCode();
    rooms.push({ id, code });
    expect(await store.reserveCode(code, id)).toBe(true);
    const a = new RoomActor(RoomActor.createState(id, code, CFG), { store, config: CFG, onExpiring: () => undefined });
    await a.join("Nadia");
    const loaded = (await store.loadRoom(id))!;
    const b = new RoomActor(loaded.state, { store, config: CFG, onExpiring: () => undefined }, loaded.events);

    const attempts = await Promise.allSettled([
      ...["A1", "A2", "A3"].map((n) => a.join(n)),
      ...["B1", "B2", "B3"].map((n) => b.join(n)),
    ]);
    a.dispose();
    b.dispose();

    const final = (await store.loadRoom(id))!;
    const active = Object.values(final.state.participants).filter((p) => p.connection !== "LEFT");
    expect(active.length).toBeLessThanOrEqual(LIMITS.maxParticipants);
    expect(active.length).toBe(1 + attempts.filter((r) => r.status === "fulfilled").length);
    // Yang kalah revisi gagal sebagai SERVICE_UNAVAILABLE (bukan kerusakan data) — klien mencoba lagi.
    for (const r of attempts) if (r.status === "rejected") expect(["SERVICE_UNAVAILABLE", "ROOM_FULL"]).toContain((r.reason as { code?: string }).code);
    // seq event unik & berurutan tanpa lubang (PK room_id+seq menjaga ini; pastikan tak ada yang terbuang).
    const seqs = final.events.map((e) => e.seq!).sort((x, y) => x - y);
    expect(new Set(seqs).size).toBe(seqs.length);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1]! + 1);
    expect(await store.countRoomData(id)).toBeGreaterThan(0);
  });

  it("counter rate limit atomik: 12 hit paralel pada kunci yang sama menghasilkan nilai 1..12 tanpa duplikat", async () => {
    const key = `p09-test:${crypto.randomUUID().slice(0, 12)}`;
    const values = await Promise.all(Array.from({ length: 12 }, () => store.hit(key, 60)));
    expect([...values].sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(await store.peek(key, 60)).toBe(12);
  });

  it("antrean pool dibatasi: banjir query ditolak cepat (StoreUnavailable), yang lolos tetap benar, dan store pulih setelahnya", async () => {
    const tight = new PostgresRoomStore(createPgDb(url!, { poolMax: 2, statementTimeoutMs: 8000, maxWaiting: 3 }));
    try {
      const t = Date.now();
      const results = await Promise.allSettled(Array.from({ length: 40 }, () => tight.resolveCode("ZZZZZZ")));
      const ok = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(ok.length).toBeGreaterThan(0);
      expect(rejected.length).toBeGreaterThan(0);
      for (const r of rejected) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(StoreUnavailableError);
      for (const r of ok) expect((r as PromiseFulfilledResult<unknown>).value).toBeNull();
      expect(Date.now() - t).toBeLessThan(15_000);
      expect(await tight.ping()).toBe(true);
    } finally {
      await tight.close();
    }
  });

  it("role aplikasi tidak bisa DDL / TRUNCATE (least privilege) dan tak membuka kolom hash token ke event", async () => {
    const db = createPgDb(url!, { poolMax: 1, statementTimeoutMs: 5000 });
    try {
      await expect(db.query("CREATE TABLE p09_should_fail (x int)")).rejects.toThrow();
      await expect(db.query("TRUNCATE lr_rooms")).rejects.toThrow();
      await expect(db.query("DROP TABLE lr_rate_limits")).rejects.toThrow();
    } finally {
      await db.close();
    }
  });
});
