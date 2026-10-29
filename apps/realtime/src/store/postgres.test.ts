import { describe, expect, it } from "vitest";
import { RoomActor } from "../room/RoomActor";
import type { Db, Queryable, QueryResultLike } from "./db";
import { PostgresRoomStore } from "./postgres";
import { StaleRevisionError, StoreUnavailableError, TOMBSTONE } from "./types";

/**
 * Tes adapter dengan Db PALSU (tanpa database sungguhan, tanpa jaringan): memastikan alur
 * transaksi, optimistic concurrency, pemetaan error, dan SQL yang dikirim.
 */
type Responder = (sql: string, params: unknown[]) => QueryResultLike<Record<string, unknown>> | Error;

class FakeDb implements Db {
  log: { sql: string; params: unknown[]; tx: boolean }[] = [];
  tx = { begun: 0, committed: 0, rolledBack: 0 };
  constructor(private readonly respond: Responder) {}

  private exec(sql: string, params: unknown[] = [], inTx: boolean) {
    this.log.push({ sql: sql.replace(/\s+/g, " ").trim(), params, tx: inTx });
    const r = this.respond(sql, params);
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(r as QueryResultLike<never>);
  }

  query<R>(text: string, params?: unknown[]) {
    return this.exec(text, params, false) as Promise<QueryResultLike<R>>;
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    this.tx.begun++;
    const tx: Queryable = { query: <R>(t: string, p?: unknown[]) => this.exec(t, p, true) as Promise<QueryResultLike<R>> };
    try {
      const r = await fn(tx);
      this.tx.committed++;
      return r;
    } catch (err) {
      this.tx.rolledBack++;
      throw err;
    }
  }

  async close() {}
}

const ok = (rows: Record<string, unknown>[] = []) => ({ rows, rowCount: rows.length });

const CFG = {
  graceSeconds: 120,
  holdSeconds: 60,
  maxLifetimeHours: null,
  connectDeadlineMs: 15_000,
  credentialTtlSeconds: 3600,
  credentialRotationGraceMs: 60_000,
};

function stateWithOne() {
  const state = RoomActor.createState("0190a6c2-0000-7000-8000-000000000001", "GENG27", CFG, 1_000);
  state.revision = 1;
  state.lastSeq = 2;
  state.roomVersion = 2;
  state.participants.p1 = {
    participantId: "p1",
    displayName: "Nadia",
    color: "P1",
    joinedAtMs: 1_000,
    connection: "CONNECTED",
    disconnectedAtMs: null,
    camera: "none",
    ready: false,
    mirrored: false,
    cameraPresentation: { zoom: 1, offset: { x: 0, y: 0 }, brightness: 0, warmth: 0 },
    tokenHash: "a".repeat(64),
    tokenIssuedAtMs: 1_000,
    prevTokenHash: null,
    prevTokenValidUntilMs: null,
  };
  return state;
}

describe("PostgresRoomStore (Db palsu)", () => {
  it("room baru: room + peserta + event + pangkas = SATU statement atomik (1 round-trip, tanpa BEGIN/COMMIT)", async () => {
    const db = new FakeDb(() => ok([{ n: 1 }]));
    const store = new PostgresRoomStore(db, 500);
    await store.saveRoom({
      state: stateWithOne(),
      expectedRevision: 0,
      changedParticipantIds: ["p1", "p1"], // duplikat diabaikan (ON CONFLICT tak boleh menyentuh baris yang sama dua kali)
      events: [{ type: "participant.joined", seq: 1, roomVersion: 1, atMs: 1_000, payload: {} }],
    });
    expect(db.tx).toEqual({ begun: 0, committed: 0, rolledBack: 0 });
    expect(db.log).toHaveLength(1);
    const q = db.log[0]!;
    expect(q.sql).toMatch(/^WITH r AS \(INSERT INTO lr_rooms/);
    for (const frag of ["p AS ( INSERT INTO lr_participants", "e AS ( INSERT INTO lr_room_events", "pr AS (DELETE FROM lr_room_events"]) expect(q.sql).toContain(frag);
    // Semua CTE tulis digerbang oleh hasil CTE room (revisi cocok).
    expect(q.sql.match(/WHERE EXISTS \(SELECT 1 FROM r\)/g)?.length).toBe(2);
    expect(q.sql).toContain("AND EXISTS (SELECT 1 FROM r)");
    // Hash token ada di JSON peserta (hanya 1 baris), token mentah tak pernah ada di state.
    const participants = JSON.parse(String(q.params.find((x) => typeof x === "string" && x.includes("participant_id"))));
    expect(participants).toHaveLength(1);
    expect(participants[0].token_hash).toBe("a".repeat(64));
    // Setiap placeholder $1..$n terpakai (parameter tak terpakai membuat PostgreSQL gagal infer tipe).
    for (let i = 1; i <= q.params.length; i++) expect(q.sql).toContain(`$${i}`);
  });

  it("hanya CTE yang dibutuhkan ikut: tanpa peserta/event/sesi/frame hanya CTE room", async () => {
    const db = new FakeDb(() => ok([{ n: 1 }]));
    const store = new PostgresRoomStore(db, 500);
    const state = stateWithOne();
    state.revision = 2;
    await store.saveRoom({ state, expectedRevision: 1, changedParticipantIds: [], events: [] });
    const q = db.log[0]!;
    expect(q.sql).toMatch(/^WITH r AS \(UPDATE lr_rooms/);
    expect(q.sql).not.toMatch(/INSERT INTO|DELETE FROM/);
    expect(q.params).toHaveLength(11);
  });

  it("revisi tidak cocok → StaleRevisionError (CTE room kosong = tidak ada yang tertulis)", async () => {
    const db = new FakeDb(() => ok([{ n: 0 }]));
    const store = new PostgresRoomStore(db, 500);
    const state = stateWithOne();
    state.revision = 5;
    await expect(store.saveRoom({ state, expectedRevision: 4, changedParticipantIds: ["p1"], events: [] })).rejects.toBeInstanceOf(
      StaleRevisionError,
    );
    const q = db.log[0]!;
    expect(q.sql).toContain("revision = $11");
    expect(q.params[10]).toBe(4);
    for (let i = 1; i <= q.params.length; i++) expect(q.sql).toContain(`$${i}`);
  });

  it("error koneksi/driver dipetakan ke StoreUnavailableError", async () => {
    const db = new FakeDb(() => Object.assign(new Error("Connection terminated"), { code: "57P01" }));
    const store = new PostgresRoomStore(db, 500);
    await expect(store.resolveCode("GENG27")).rejects.toBeInstanceOf(StoreUnavailableError);
    await expect(store.hit("create:abc", 60)).rejects.toBeInstanceOf(StoreUnavailableError);
    expect(await store.ping()).toBe(false);
    expect(await store.hasSchema()).toBe(false);
  });

  it("resolveCode: ACTIVE → roomId, tombstone hidup → EXPIRED, tombstone lewat → null", async () => {
    let row: Record<string, unknown> | null = { room_id: "r1", state: "ACTIVE", live: null };
    const store = new PostgresRoomStore(new FakeDb(() => ok(row ? [row] : [])), 500);
    expect(await store.resolveCode("GENG27")).toBe("r1");
    row = { room_id: null, state: "TOMBSTONE", live: true };
    expect(await store.resolveCode("GENG27")).toBe(TOMBSTONE);
    row = { room_id: null, state: "TOMBSTONE", live: false };
    expect(await store.resolveCode("GENG27")).toBeNull();
    row = null;
    expect(await store.resolveCode("GENG27")).toBeNull();
  });

  it("reserveCode false bila kode sudah dipakai / tombstone masih berlaku", async () => {
    const store = new PostgresRoomStore(new FakeDb(() => ok([])), 500);
    expect(await store.reserveCode("GENG27", "r1")).toBe(false);
  });

  it("loadRoom memetakan baris (bigint string → number) dan mengurutkan event naik", async () => {
    const db = new FakeDb((sql) => {
      if (sql.includes("FROM lr_rooms"))
        return ok([
          {
            room_id: "r1",
            code: "GENG27",
            status: "GRACE",
            created_ms: 1000,
            empty_since_ms: 2000,
            expires_ms: null,
            active_session_id: null,
            session_order: [],
            room_version: "7",
            last_seq: "7",
            revision: "9",
          },
        ]);
      if (sql.includes("FROM lr_participants"))
        return ok([
          {
            participant_id: "p1",
            display_name: "Nadia",
            color: "P1",
            joined_ms: 1000,
            connection: "RECONNECTING",
            disconnected_ms: 2000,
            camera: "none",
            ready: false,
            token_hash: "b".repeat(64),
            token_issued_ms: 1000,
            prev_token_hash: null,
            prev_token_valid_until_ms: null,
          },
        ]);
      return ok([
        { seq: "7", type: "room.status", payload: {}, room_version: "7", at_ms: 2000 },
        { seq: "6", type: "presence.update", payload: {}, room_version: "6", at_ms: 2000 },
      ]);
    });
    const loaded = await new PostgresRoomStore(db, 500).loadRoom("r1");
    expect(loaded!.state).toMatchObject({ status: "GRACE", emptySinceMs: 2000, revision: 9, lastSeq: 7 });
    expect(loaded!.state.participants.p1).toMatchObject({ connection: "RECONNECTING", tokenHash: "b".repeat(64) });
    expect(loaded!.events.map((e) => e.seq)).toEqual([6, 7]);
  });

  it("finalizeExpiredRoom: hapus room + tombstone dalam satu transaksi", async () => {
    const db = new FakeDb(() => ok());
    await new PostgresRoomStore(db, 500).finalizeExpiredRoom("r1", "GENG27", 86_400);
    expect(db.tx).toEqual({ begun: 1, committed: 1, rolledBack: 0 });
    expect(db.log[0]!.sql).toBe("DELETE FROM lr_rooms WHERE room_id = $1");
    expect(db.log[1]!.sql).toContain("'TOMBSTONE'");
  });
});
