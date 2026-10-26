import type { CameraState, ConnectionState, PlayerColor, RoomStatus, S2C } from "@longroll/shared";
import { ROOM_DEFAULTS } from "@longroll/shared";
import type { RoomState, ServerParticipant } from "../room/types";
import type { Db, Queryable } from "./db";
import { StaleRevisionError, StoreUnavailableError, TOMBSTONE, windowStartMs } from "./types";
import type { LoadedRoom, RoomStore, SaveRoomInput } from "./types";

/** Versi skema yang wajib sudah dijalankan manual oleh pemilik database (db/migrations). */
export const REQUIRED_SCHEMA_VERSION = "0001_p02_rooms";

/** ms epoch → timestamptz (NULL tetap NULL). */
const TS = (n: number) => `to_timestamp($${n}::float8 / 1000)`;
/** timestamptz → ms epoch (float8 agar driver mengembalikan number). */
const MS = (col: string) => `(extract(epoch from ${col}) * 1000)::float8`;

const STALE_RESERVATION = "1 hour";

interface RoomRow {
  room_id: string;
  code: string;
  status: RoomStatus;
  created_ms: number;
  empty_since_ms: number | null;
  expires_ms: number | null;
  active_session_id: string | null;
  session_order: string[];
  room_version: string | number;
  last_seq: string | number;
  revision: string | number;
}

interface ParticipantRow {
  participant_id: string;
  display_name: string;
  color: PlayerColor;
  joined_ms: number;
  connection: ConnectionState;
  disconnected_ms: number | null;
  camera: CameraState;
  ready: boolean;
  token_hash: string | null;
  token_issued_ms: number | null;
  prev_token_hash: string | null;
  prev_token_valid_until_ms: number | null;
}

interface EventRow {
  seq: string | number;
  type: string;
  payload: unknown;
  room_version: string | number;
  at_ms: number;
}

/**
 * Adapter PostgreSQL (Neon). Room actor tetap otoritatif di memori; tabel ini adalah snapshot tahan
 * restart. Setiap saveRoom = satu transaksi dengan optimistic concurrency pada `revision`
 * (UPDATE … WHERE revision = expected mengunci baris room). Kapasitas & warna unik juga dijaga
 * indeks parsial di database (lapisan pertahanan kedua di bawah actor serial).
 */
export class PostgresRoomStore implements RoomStore {
  readonly kind = "postgres" as const;

  constructor(
    private readonly db: Db,
    private readonly eventBufferSize: number = ROOM_DEFAULTS.eventBufferSize,
  ) {}

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof StaleRevisionError || err instanceof StoreUnavailableError) throw err;
      throw new StoreUnavailableError(err);
    }
  }

  async ping() {
    try {
      await this.db.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  /** true bila migrasi wajib sudah dijalankan. Tidak pernah membuat/mengubah skema. */
  async hasSchema(version = REQUIRED_SCHEMA_VERSION): Promise<boolean> {
    try {
      const r = await this.db.query("SELECT 1 FROM lr_schema_migrations WHERE version = $1", [version]);
      return (r.rowCount ?? r.rows.length) > 0;
    } catch {
      return false;
    }
  }

  reserveCode(code: string, roomId: string) {
    return this.run(async () => {
      const r = await this.db.query(
        `INSERT INTO lr_room_codes (code, room_id, state, created_at)
         VALUES ($1, $2, 'ACTIVE', now())
         ON CONFLICT (code) DO UPDATE
           SET room_id = EXCLUDED.room_id, state = 'ACTIVE', tombstone_until = NULL, created_at = now()
           WHERE lr_room_codes.state = 'TOMBSTONE' AND lr_room_codes.tombstone_until <= now()
         RETURNING code`,
        [code, roomId],
      );
      return r.rows.length === 1;
    });
  }

  releaseCode(code: string, roomId: string) {
    return this.run(async () => {
      await this.db.query("DELETE FROM lr_room_codes WHERE code = $1 AND room_id = $2 AND state = 'ACTIVE'", [code, roomId]);
    });
  }

  resolveCode(code: string) {
    return this.run(async () => {
      const r = await this.db.query<{ room_id: string | null; state: string; live: boolean | null }>(
        "SELECT room_id, state, tombstone_until > now() AS live FROM lr_room_codes WHERE code = $1",
        [code],
      );
      const row = r.rows[0];
      if (!row) return null;
      if (row.state === "TOMBSTONE") return row.live ? TOMBSTONE : null;
      return row.room_id;
    });
  }

  saveRoom(input: SaveRoomInput) {
    return this.run(() => this.db.transaction((tx) => this.saveInTx(tx, input)));
  }

  private async saveInTx(tx: Queryable, { state, expectedRevision, events, changedParticipantIds }: SaveRoomInput) {
    const values = [
      state.roomId,
      state.code,
      state.status,
      state.createdAtMs,
      state.emptySinceMs,
      state.expiresAtMs,
      state.activeSessionId,
      JSON.stringify(state.sessionOrder),
      state.roomVersion,
      state.lastSeq,
      state.revision,
    ];
    const r =
      expectedRevision === 0
        ? await tx.query(
            `INSERT INTO lr_rooms (room_id, code, status, created_at, empty_since, expires_at, active_session_id,
                                   session_order, room_version, last_seq, revision, updated_at)
             VALUES ($1, $2, $3, ${TS(4)}, ${TS(5)}, ${TS(6)}, $7, $8::jsonb, $9, $10, $11, now())
             ON CONFLICT (room_id) DO NOTHING
             RETURNING room_id`,
            values,
          )
        : await tx.query(
            `UPDATE lr_rooms
                SET status = $3, empty_since = ${TS(4)}, expires_at = ${TS(5)}, active_session_id = $6,
                    session_order = $7::jsonb, room_version = $8, last_seq = $9, revision = $10, updated_at = now()
              WHERE room_id = $1 AND code = $2 AND revision = $11
              RETURNING room_id`,
            // Tanpa created_at: setiap parameter harus dipakai di SQL (tipe parameter tak terpakai tak bisa diinfer).
            [...values.slice(0, 3), ...values.slice(4), expectedRevision],
          );
    if (r.rows.length !== 1) throw new StaleRevisionError(state.roomId);

    for (const pid of changedParticipantIds) {
      const p = state.participants[pid];
      if (p) await this.upsertParticipant(tx, state.roomId, p);
    }

    for (const e of events) {
      await tx.query(
        `INSERT INTO lr_room_events (room_id, seq, type, payload, room_version, at)
         VALUES ($1, $2, $3, $4::jsonb, $5, ${TS(6)})
         ON CONFLICT (room_id, seq) DO NOTHING`,
        [state.roomId, e.seq, e.type, JSON.stringify(e.payload), e.roomVersion ?? state.roomVersion, e.atMs],
      );
    }
    if (events.length) {
      await tx.query("DELETE FROM lr_room_events WHERE room_id = $1 AND seq <= $2", [
        state.roomId,
        state.lastSeq - this.eventBufferSize,
      ]);
    }
  }

  private upsertParticipant(tx: Queryable, roomId: string, p: ServerParticipant) {
    return tx.query(
      `INSERT INTO lr_participants (participant_id, room_id, display_name, color, joined_at, connection,
                                    disconnected_at, camera, ready, token_hash, token_issued_at,
                                    prev_token_hash, prev_token_valid_until, updated_at)
       VALUES ($1, $2, $3, $4, ${TS(5)}, $6, ${TS(7)}, $8, $9, $10, ${TS(11)}, $12, ${TS(13)}, now())
       ON CONFLICT (participant_id) DO UPDATE
         SET display_name = EXCLUDED.display_name, color = EXCLUDED.color, connection = EXCLUDED.connection,
             disconnected_at = EXCLUDED.disconnected_at, camera = EXCLUDED.camera, ready = EXCLUDED.ready,
             token_hash = EXCLUDED.token_hash, token_issued_at = EXCLUDED.token_issued_at,
             prev_token_hash = EXCLUDED.prev_token_hash, prev_token_valid_until = EXCLUDED.prev_token_valid_until,
             updated_at = now()
         WHERE lr_participants.room_id = EXCLUDED.room_id`,
      [
        p.participantId,
        roomId,
        p.displayName,
        p.color,
        p.joinedAtMs,
        p.connection,
        p.disconnectedAtMs,
        p.camera,
        p.ready,
        p.tokenHash,
        p.tokenIssuedAtMs,
        p.prevTokenHash,
        p.prevTokenValidUntilMs,
      ],
    );
  }

  loadRoom(roomId: string): Promise<LoadedRoom | null> {
    return this.run(async () => {
      const rooms = await this.db.query<RoomRow>(
        `SELECT room_id, code, status, ${MS("created_at")} AS created_ms, ${MS("empty_since")} AS empty_since_ms,
                ${MS("expires_at")} AS expires_ms, active_session_id, session_order, room_version, last_seq, revision
           FROM lr_rooms WHERE room_id = $1`,
        [roomId],
      );
      const row = rooms.rows[0];
      if (!row) return null;
      const people = await this.db.query<ParticipantRow>(
        `SELECT participant_id, display_name, color, ${MS("joined_at")} AS joined_ms, connection,
                ${MS("disconnected_at")} AS disconnected_ms, camera, ready, token_hash,
                ${MS("token_issued_at")} AS token_issued_ms, prev_token_hash,
                ${MS("prev_token_valid_until")} AS prev_token_valid_until_ms
           FROM lr_participants WHERE room_id = $1 ORDER BY joined_at, participant_id`,
        [roomId],
      );
      const evs = await this.db.query<EventRow>(
        `SELECT seq, type, payload, room_version, ${MS("at")} AS at_ms
           FROM lr_room_events WHERE room_id = $1 ORDER BY seq DESC LIMIT $2`,
        [roomId, this.eventBufferSize],
      );
      const participants: Record<string, ServerParticipant> = {};
      for (const p of people.rows) {
        participants[p.participant_id] = {
          participantId: p.participant_id,
          displayName: p.display_name,
          color: p.color,
          joinedAtMs: p.joined_ms,
          connection: p.connection,
          disconnectedAtMs: p.disconnected_ms,
          camera: p.camera,
          ready: p.ready,
          tokenHash: p.token_hash,
          tokenIssuedAtMs: p.token_issued_ms,
          prevTokenHash: p.prev_token_hash,
          prevTokenValidUntilMs: p.prev_token_valid_until_ms,
        };
      }
      const state: RoomState = {
        roomId: row.room_id,
        code: row.code,
        status: row.status,
        createdAtMs: row.created_ms,
        emptySinceMs: row.empty_since_ms,
        expiresAtMs: row.expires_ms,
        participants,
        activeSessionId: row.active_session_id,
        sessionOrder: row.session_order ?? [],
        roomVersion: Number(row.room_version),
        lastSeq: Number(row.last_seq),
        revision: Number(row.revision),
      };
      const events: S2C[] = evs.rows.reverse().map((e) => ({
        type: e.type,
        payload: e.payload,
        seq: Number(e.seq),
        roomVersion: Number(e.room_version),
        atMs: e.at_ms,
      }));
      return { state, events };
    });
  }

  listRecoverableRooms() {
    return this.run(async () => {
      const r = await this.db.query<{ room_id: string; code: string }>(
        "SELECT room_id, code FROM lr_rooms WHERE status IN ('ACTIVE', 'GRACE', 'EXPIRING')",
      );
      return r.rows.map((x) => ({ roomId: x.room_id, code: x.code }));
    });
  }

  finalizeExpiredRoom(roomId: string, code: string, tombstoneSeconds: number) {
    return this.run(() =>
      this.db.transaction(async (tx) => {
        // ON DELETE CASCADE menghapus peserta & event milik room.
        await tx.query("DELETE FROM lr_rooms WHERE room_id = $1", [roomId]);
        await tx.query(
          `INSERT INTO lr_room_codes (code, room_id, state, tombstone_until, created_at)
           VALUES ($1, NULL, 'TOMBSTONE', now() + make_interval(secs => $2::float8), now())
           ON CONFLICT (code) DO UPDATE
             SET room_id = NULL, state = 'TOMBSTONE', tombstone_until = EXCLUDED.tombstone_until
             WHERE lr_room_codes.room_id = $3 OR lr_room_codes.state = 'TOMBSTONE'`,
          [code, tombstoneSeconds, roomId],
        );
      }),
    );
  }

  countRoomData(roomId: string) {
    return this.run(async () => {
      const r = await this.db.query<{ n: string | number }>(
        `SELECT (SELECT count(*) FROM lr_rooms WHERE room_id = $1)
              + (SELECT count(*) FROM lr_participants WHERE room_id = $1)
              + (SELECT count(*) FROM lr_room_events WHERE room_id = $1) AS n`,
        [roomId],
      );
      return Number(r.rows[0]?.n ?? 0);
    });
  }

  hit(key: string, windowSeconds: number) {
    return this.run(async () => {
      const start = windowStartMs(windowSeconds);
      const r = await this.db.query<{ hits: number }>(
        `INSERT INTO lr_rate_limits (bucket, window_start, hits, expires_at)
         VALUES ($1, ${TS(2)}, 1, ${TS(3)})
         ON CONFLICT (bucket, window_start) DO UPDATE SET hits = lr_rate_limits.hits + 1
         RETURNING hits`,
        [key, start, start + windowSeconds * 1000],
      );
      return Number(r.rows[0]?.hits ?? 0);
    });
  }

  peek(key: string, windowSeconds: number) {
    return this.run(async () => {
      const r = await this.db.query<{ hits: number }>(
        `SELECT hits FROM lr_rate_limits WHERE bucket = $1 AND window_start = ${TS(2)}`,
        [key, windowStartMs(windowSeconds)],
      );
      return Number(r.rows[0]?.hits ?? 0);
    });
  }

  purgeExpired() {
    return this.run(async () => {
      const t = await this.db.query("DELETE FROM lr_room_codes WHERE state = 'TOMBSTONE' AND tombstone_until <= now()");
      const rl = await this.db.query("DELETE FROM lr_rate_limits WHERE expires_at <= now()");
      const stale = await this.db.query(
        `DELETE FROM lr_room_codes c
          WHERE c.state = 'ACTIVE' AND c.created_at < now() - interval '${STALE_RESERVATION}'
            AND NOT EXISTS (SELECT 1 FROM lr_rooms r WHERE r.room_id = c.room_id)`,
      );
      return { tombstones: t.rowCount ?? 0, rateLimits: rl.rowCount ?? 0, staleReservations: stale.rowCount ?? 0 };
    });
  }

  close() {
    return this.db.close();
  }
}
