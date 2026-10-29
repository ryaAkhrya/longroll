import type { CameraState, ConnectionState, PlayerColor, RoomStatus, S2C, SessionView } from "@longroll/shared";
import { DEFAULT_CAMERA_PRESENTATION, ROOM_DEFAULTS, sanitizeCameraPresentation } from "@longroll/shared";
import type { RoomState, ServerFrame, ServerParticipant } from "../room/types";
import type { Db, Queryable } from "./db";
import { StaleRevisionError, StoreUnavailableError, TOMBSTONE, windowStartMs } from "./types";
import type { LoadedRoom, RoomStore, SaveRoomInput } from "./types";

/** Versi skema yang wajib sudah dijalankan manual oleh pemilik database (db/migrations). */
export const REQUIRED_SCHEMA_VERSION = "0007_p08_results";

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
  mirrored: boolean;
  camera_presentation: ServerParticipant["cameraPresentation"] | null;
  token_hash: string | null;
  token_issued_ms: number | null;
  prev_token_hash: string | null;
  prev_token_valid_until_ms: number | null;
}

interface SessionRow {
  session_id: string;
  idx: number;
  state: SessionView["state"];
  mode: SessionView["mode"];
  created_ms: number;
  created_by: string;
  locked_ms: number | null;
  voting: SessionView["voting"];
  studio: SessionView["studio"];
  capture: SessionView["capture"];
  result: SessionView["result"];
  event_log: SessionView["eventLog"];
}

interface FrameRow {
  frame_id: string;
  uploaded_by: string;
  status: ServerFrame["status"];
  file_name: string;
  content_type: ServerFrame["contentType"];
  declared_bytes: number;
  raw_key: string;
  object_key: string | null;
  bytes: number | null;
  template: ServerFrame["template"];
  created_ms: number;
  expires_ms: number | null;
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

  /**
   * Satu simpan = SATU statement SQL (CTE data-modifying), yaitu satu round-trip jaringan, bukan BEGIN + N statement + COMMIT.
   * Atomisitas dijamin PostgreSQL untuk satu statement; optimistic concurrency tetap: CTE `r` (INSERT/UPDATE room
   * `WHERE revision = expected`) menjadi gerbang semua CTE lain (`EXISTS (SELECT 1 FROM r)`), jadi revisi basi tidak menulis
   * apa pun dan melempar StaleRevisionError. Pengukuran P10-A: transaksi 5 round-trip 102 ms vs 22 ms satu statement
   * (RTT 20 ms ke Neon ap-southeast-1).
   */
  saveRoom(input: SaveRoomInput) {
    return this.run(async () => {
      const { sql, params } = buildSaveRoomSql(input, this.eventBufferSize);
      const r = await this.db.query<{ n: number }>(sql, params);
      if (Number(r.rows[0]?.n ?? 0) !== 1) throw new StaleRevisionError(input.state.roomId);
    });
  }

  saveEditorDoc(roomId: string, sessionId: string, doc: Uint8Array) {
    return this.run(async () => {
      await this.db.query(
        `INSERT INTO lr_editor_docs (session_id, room_id, doc, bytes, version, updated_at)
         VALUES ($1, $2, $3, $4, 1, now())
         ON CONFLICT (session_id) DO UPDATE
           SET doc = EXCLUDED.doc, bytes = EXCLUDED.bytes, version = lr_editor_docs.version + 1, updated_at = now()
           WHERE lr_editor_docs.room_id = EXCLUDED.room_id`,
        [sessionId, roomId, Buffer.from(doc), doc.byteLength],
      );
    });
  }

  loadEditorDoc(sessionId: string) {
    return this.run(async () => {
      const r = await this.db.query<{ doc: Buffer }>("SELECT doc FROM lr_editor_docs WHERE session_id = $1", [sessionId]);
      const row = r.rows[0];
      return row ? new Uint8Array(row.doc) : null;
    });
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
                ${MS("disconnected_at")} AS disconnected_ms, camera, ready, mirrored, camera_presentation, token_hash,
                ${MS("token_issued_at")} AS token_issued_ms, prev_token_hash,
                ${MS("prev_token_valid_until")} AS prev_token_valid_until_ms
           FROM lr_participants WHERE room_id = $1 ORDER BY joined_at, participant_id`,
        [roomId],
      );
      const sess = await this.db.query<SessionRow>(
        `SELECT session_id, idx, state, mode, ${MS("created_at")} AS created_ms, created_by, ${MS("locked_at")} AS locked_ms,
                voting, studio, event_log, capture, result
           FROM lr_sessions WHERE room_id = $1 ORDER BY idx`,
        [roomId],
      );
      const frs = await this.db.query<FrameRow>(
        `SELECT frame_id, uploaded_by, status, file_name, content_type, declared_bytes, raw_key, object_key, bytes, template,
                ${MS("created_at")} AS created_ms, ${MS("expires_at")} AS expires_ms
           FROM lr_frames WHERE room_id = $1 ORDER BY created_at`,
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
          mirrored: p.mirrored ?? false,
          cameraPresentation: sanitizeCameraPresentation(p.camera_presentation) ?? { ...DEFAULT_CAMERA_PRESENTATION },
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
        sessions: Object.fromEntries(
          sess.rows.map((s) => [
            s.session_id,
            {
              sessionId: s.session_id,
              index: s.idx,
              state: s.state,
              createdAtMs: s.created_ms,
              createdBy: s.created_by,
              mode: s.mode,
              lockedAtMs: s.locked_ms,
              voting: s.voting,
              studio: s.studio,
              capture: s.capture ?? null,
              result: s.result ?? null,
              eventLog: s.event_log ?? [],
            } satisfies SessionView,
          ]),
        ),
        frames: Object.fromEntries(
          frs.rows.map((f) => [
            f.frame_id,
            {
              frameId: f.frame_id,
              uploadedBy: f.uploaded_by,
              status: f.status,
              fileName: f.file_name,
              contentType: f.content_type,
              declaredBytes: Number(f.declared_bytes),
              rawKey: f.raw_key,
              objectKey: f.object_key,
              bytes: f.bytes === null ? null : Number(f.bytes),
              template: f.template,
              createdAtMs: f.created_ms,
              expiresAtMs: f.expires_ms,
            } satisfies ServerFrame,
          ]),
        ),
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

  existingRoomIds(roomIds: string[]) {
    return this.run(async () => {
      const valid = roomIds.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
      if (!valid.length) return new Set<string>();
      const r = await this.db.query<{ room_id: string }>("SELECT room_id::text AS room_id FROM lr_rooms WHERE room_id::text = ANY($1::text[])", [valid]);
      return new Set(r.rows.map((x) => x.room_id.toLowerCase()));
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
              + (SELECT count(*) FROM lr_room_events WHERE room_id = $1)
              + (SELECT count(*) FROM lr_sessions WHERE room_id = $1)
              + (SELECT count(*) FROM lr_frames WHERE room_id = $1)
              + (SELECT count(*) FROM lr_editor_docs WHERE room_id = $1) AS n`,
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

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const uniq = (ids: string[]) => [...new Set(ids)];

const PARTICIPANT_SQL = `
  p AS (
    INSERT INTO lr_participants (participant_id, room_id, display_name, color, joined_at, connection, disconnected_at, camera,
                                 ready, token_hash, token_issued_at, prev_token_hash, prev_token_valid_until, mirrored,
                                 camera_presentation, updated_at)
    SELECT x.participant_id, x.room_id, x.display_name, x.color, x.joined_at, x.connection, x.disconnected_at, x.camera,
           x.ready, x.token_hash, x.token_issued_at, x.prev_token_hash, x.prev_token_valid_until, x.mirrored,
           x.camera_presentation, now()
      FROM jsonb_populate_recordset(NULL::lr_participants, $@::jsonb) x
     WHERE EXISTS (SELECT 1 FROM r)
    ON CONFLICT (participant_id) DO UPDATE
      SET display_name = EXCLUDED.display_name, color = EXCLUDED.color, connection = EXCLUDED.connection,
          disconnected_at = EXCLUDED.disconnected_at, camera = EXCLUDED.camera, ready = EXCLUDED.ready,
          mirrored = EXCLUDED.mirrored, camera_presentation = EXCLUDED.camera_presentation,
          token_hash = EXCLUDED.token_hash, token_issued_at = EXCLUDED.token_issued_at,
          prev_token_hash = EXCLUDED.prev_token_hash, prev_token_valid_until = EXCLUDED.prev_token_valid_until,
          updated_at = now()
      WHERE lr_participants.room_id = EXCLUDED.room_id
    RETURNING 1)`;

const SESSION_SQL = `
  s AS (
    INSERT INTO lr_sessions (session_id, room_id, idx, state, mode, created_at, created_by, locked_at, voting, studio,
                             event_log, capture, result, updated_at)
    SELECT x.session_id, x.room_id, x.idx, x.state, x.mode, x.created_at, x.created_by, x.locked_at, x.voting, x.studio,
           x.event_log, x.capture, x.result, now()
      FROM jsonb_populate_recordset(NULL::lr_sessions, $@::jsonb) x
     WHERE EXISTS (SELECT 1 FROM r)
    ON CONFLICT (session_id) DO UPDATE
      SET state = EXCLUDED.state, mode = COALESCE(lr_sessions.mode, EXCLUDED.mode), locked_at = EXCLUDED.locked_at,
          voting = EXCLUDED.voting, studio = EXCLUDED.studio, event_log = EXCLUDED.event_log,
          capture = EXCLUDED.capture, result = EXCLUDED.result, updated_at = now()
      WHERE lr_sessions.room_id = EXCLUDED.room_id
    RETURNING 1)`;

const FRAME_SQL = `
  f AS (
    INSERT INTO lr_frames (frame_id, room_id, uploaded_by, status, file_name, content_type, declared_bytes, raw_key,
                           object_key, bytes, template, created_at, expires_at, updated_at)
    SELECT x.frame_id, x.room_id, x.uploaded_by, x.status, x.file_name, x.content_type, x.declared_bytes, x.raw_key,
           x.object_key, x.bytes, x.template, x.created_at, x.expires_at, now()
      FROM jsonb_populate_recordset(NULL::lr_frames, $@::jsonb) x
     WHERE EXISTS (SELECT 1 FROM r)
    ON CONFLICT (frame_id) DO UPDATE
      SET status = EXCLUDED.status, object_key = EXCLUDED.object_key, bytes = EXCLUDED.bytes,
          template = EXCLUDED.template, expires_at = EXCLUDED.expires_at, updated_at = now()
      WHERE lr_frames.room_id = EXCLUDED.room_id
    RETURNING 1)`;

/** Membangun satu statement atomik untuk saveRoom. Hanya CTE yang dipakai yang ikut (setiap parameter harus terpakai). */
export function buildSaveRoomSql(
  { state, expectedRevision, events, changedParticipantIds, changedSessionIds = [], changedFrameIds = [], deletedFrameIds = [] }: SaveRoomInput,
  eventBufferSize: number,
): { sql: string; params: unknown[] } {
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
  const roomStmt =
    expectedRevision === 0
      ? `INSERT INTO lr_rooms (room_id, code, status, created_at, empty_since, expires_at, active_session_id,
                               session_order, room_version, last_seq, revision, updated_at)
         VALUES ($1, $2, $3, ${TS(4)}, ${TS(5)}, ${TS(6)}, $7, $8::jsonb, $9, $10, $11, now())
         ON CONFLICT (room_id) DO NOTHING
         RETURNING room_id`
      : `UPDATE lr_rooms
            SET status = $3, empty_since = ${TS(4)}, expires_at = ${TS(5)}, active_session_id = $6,
                session_order = $7::jsonb, room_version = $8, last_seq = $9, revision = $10, updated_at = now()
          WHERE room_id = $1 AND code = $2 AND revision = $11
          RETURNING room_id`;
  // Tanpa created_at pada UPDATE: setiap parameter harus dipakai di SQL (tipe parameter tak terpakai tak bisa diinfer).
  const params: unknown[] = expectedRevision === 0 ? [...values] : [...values.slice(0, 3), ...values.slice(4), expectedRevision];
  const ctes = [`r AS (${roomStmt})`];
  const add = (cte: string, value: unknown) => {
    params.push(value);
    ctes.push(cte.replaceAll("$@", `$${params.length}`));
  };

  const pids = uniq(changedParticipantIds).filter((id) => state.participants[id]);
  if (pids.length) {
    add(
      PARTICIPANT_SQL,
      JSON.stringify(
        pids.map((id) => {
          const p = state.participants[id]!;
          return {
            participant_id: p.participantId,
            room_id: state.roomId,
            display_name: p.displayName,
            color: p.color,
            joined_at: iso(p.joinedAtMs),
            connection: p.connection,
            disconnected_at: iso(p.disconnectedAtMs),
            camera: p.camera,
            ready: p.ready,
            token_hash: p.tokenHash,
            token_issued_at: iso(p.tokenIssuedAtMs),
            prev_token_hash: p.prevTokenHash,
            prev_token_valid_until: iso(p.prevTokenValidUntilMs),
            mirrored: p.mirrored,
            camera_presentation: p.cameraPresentation,
          };
        }),
      ),
    );
  }

  const sids = uniq(changedSessionIds).filter((id) => state.sessions[id]);
  if (sids.length) {
    add(
      SESSION_SQL,
      JSON.stringify(
        sids.map((id) => {
          const s = state.sessions[id]!;
          return {
            session_id: s.sessionId,
            room_id: state.roomId,
            idx: s.index,
            state: s.state,
            mode: s.mode,
            created_at: iso(s.createdAtMs),
            created_by: s.createdBy,
            locked_at: iso(s.lockedAtMs),
            voting: s.voting,
            studio: s.studio,
            event_log: s.eventLog,
            capture: s.capture,
            result: s.result,
          };
        }),
      ),
    );
  }

  const fids = uniq(changedFrameIds).filter((id) => state.frames[id]);
  if (fids.length) {
    add(
      FRAME_SQL,
      JSON.stringify(
        fids.map((id) => {
          const f = state.frames[id]!;
          return {
            frame_id: f.frameId,
            room_id: state.roomId,
            uploaded_by: f.uploadedBy,
            status: f.status,
            file_name: f.fileName,
            content_type: f.contentType,
            declared_bytes: f.declaredBytes,
            raw_key: f.rawKey,
            object_key: f.objectKey,
            bytes: f.bytes,
            template: f.template,
            created_at: iso(f.createdAtMs),
            expires_at: iso(f.expiresAtMs),
          };
        }),
      ),
    );
  }

  if (deletedFrameIds.length) {
    add(`df AS (DELETE FROM lr_frames WHERE room_id = $1::uuid AND frame_id = ANY($@::uuid[]) AND EXISTS (SELECT 1 FROM r) RETURNING 1)`, deletedFrameIds);
  }

  if (events.length) {
    add(
      `e AS (
        INSERT INTO lr_room_events (room_id, seq, type, payload, room_version, at)
        SELECT $1::uuid, e.seq, e.type, e.payload, e.room_version, e.at
          FROM jsonb_to_recordset($@::jsonb) AS e(seq bigint, type text, payload jsonb, room_version bigint, at timestamptz)
         WHERE EXISTS (SELECT 1 FROM r)
        ON CONFLICT (room_id, seq) DO NOTHING
        RETURNING 1)`,
      JSON.stringify(events.map((e) => ({ seq: e.seq, type: e.type, payload: e.payload, room_version: e.roomVersion ?? state.roomVersion, at: iso(e.atMs) }))),
    );
    add(`pr AS (DELETE FROM lr_room_events WHERE room_id = $1::uuid AND seq <= $@::bigint AND EXISTS (SELECT 1 FROM r) RETURNING 1)`, state.lastSeq - eventBufferSize);
  }

  return { sql: `WITH ${ctes.join(",")} SELECT (SELECT count(*)::int FROM r) AS n`, params };
}
