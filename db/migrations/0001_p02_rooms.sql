-- =============================================================================
-- LONGROLL — Migrasi 0001: room & presence P02 (PostgreSQL / Neon)
-- -----------------------------------------------------------------------------
-- DIJALANKAN MANUAL oleh pemilik database (awalnya di branch development Neon).
-- Aplikasi TIDAK menjalankan migrasi; saat start ia hanya memeriksa baris
-- lr_schema_migrations.version = '0001_p02_rooms'.
--
-- Sifat:
--   * Idempoten: CREATE ... IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING.
--     Catatan: IF NOT EXISTS TIDAK mengubah tabel yang sudah ada dengan definisi
--     berbeda. Bila skrip ini pernah dijalankan sebagian/berbeda, periksa dulu
--     dengan db/maintenance/inspect.sql.
--   * Tidak ada operasi destruktif (tanpa DROP / DELETE / TRUNCATE).
--   * Satu transaksi: gagal di tengah = tidak ada yang tersimpan.
--   * Tidak ada TTL otomatis di PostgreSQL. Data room dihapus eksplisit oleh
--     service (grace habis → cleanup), tombstone & rate limit dipurge berkala
--     oleh service (atau manual: db/maintenance/purge_expired.sql).
--   * Data pribadi (display name) hanya ada di lr_participants & payload
--     lr_room_events, dan ikut terhapus (ON DELETE CASCADE) saat room dihapus.
--     Tombstone tidak menyimpan nama/foto/room_id.
--
-- Prasyarat: PostgreSQL 14+ (Neon default memenuhi). Tidak butuh extension.
-- =============================================================================

BEGIN;

-- Versi skema yang sudah diterapkan (diperiksa service saat start).
CREATE TABLE IF NOT EXISTS lr_schema_migrations (
  version    text        PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Registry kode room + tombstone (07 §2, DEC-022, DEC-084).
--   ACTIVE    : kode dipakai room_id tersebut.
--   TOMBSTONE : room sudah bubar; link lama menampilkan SCR-21 sampai
--               tombstone_until, dan kode tidak dipakai ulang selama itu.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lr_room_codes (
  code            text        PRIMARY KEY,
  room_id         uuid        NULL,
  state           text        NOT NULL,
  tombstone_until timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lr_room_codes_code_format
    CHECK (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  CONSTRAINT lr_room_codes_state_valid
    CHECK (state IN ('ACTIVE', 'TOMBSTONE')),
  CONSTRAINT lr_room_codes_state_shape CHECK (
    (state = 'ACTIVE'    AND room_id IS NOT NULL AND tombstone_until IS NULL) OR
    (state = 'TOMBSTONE' AND room_id IS NULL     AND tombstone_until IS NOT NULL)
  )
);

-- Purge tombstone kedaluwarsa & reservasi yatim.
CREATE INDEX IF NOT EXISTS lr_room_codes_tombstone_until_idx
  ON lr_room_codes (tombstone_until) WHERE state = 'TOMBSTONE';
CREATE INDEX IF NOT EXISTS lr_room_codes_active_created_idx
  ON lr_room_codes (created_at) WHERE state = 'ACTIVE';

-- -----------------------------------------------------------------------------
-- Snapshot room (14 §2). Actor di memori tetap otoritatif; `revision` dipakai
-- untuk optimistic concurrency (UPDATE ... WHERE revision = expected).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lr_rooms (
  room_id           uuid        PRIMARY KEY,
  code              text        NOT NULL,
  status            text        NOT NULL,
  created_at        timestamptz NOT NULL,
  empty_since       timestamptz NULL,
  -- DEC-052 (OPEN): NULL = tanpa batas umur room (default).
  expires_at        timestamptz NULL,
  active_session_id uuid        NULL,
  session_order     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  room_version      bigint      NOT NULL DEFAULT 0,
  last_seq          bigint      NOT NULL DEFAULT 0,
  revision          bigint      NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lr_rooms_code_format
    CHECK (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$'),
  CONSTRAINT lr_rooms_status_valid
    CHECK (status IN ('ACTIVE', 'GRACE', 'EXPIRING', 'EXPIRED')),
  CONSTRAINT lr_rooms_grace_has_empty_since
    CHECK (status <> 'GRACE' OR empty_since IS NOT NULL),
  CONSTRAINT lr_rooms_session_order_array
    CHECK (jsonb_typeof(session_order) = 'array'),
  CONSTRAINT lr_rooms_counters_non_negative
    CHECK (room_version >= 0 AND last_seq >= 0 AND revision >= 1)
);

-- Satu room terbuka per kode.
CREATE UNIQUE INDEX IF NOT EXISTS lr_rooms_open_code_uidx
  ON lr_rooms (code) WHERE status IN ('ACTIVE', 'GRACE', 'EXPIRING');
-- Recovery setelah restart & sweeper.
CREATE INDEX IF NOT EXISTS lr_rooms_status_idx ON lr_rooms (status);

-- -----------------------------------------------------------------------------
-- Peserta (14 §3). Token disimpan HANYA sebagai hash SHA-256 (hex).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lr_participants (
  participant_id         uuid        PRIMARY KEY,
  room_id                uuid        NOT NULL REFERENCES lr_rooms (room_id) ON DELETE CASCADE,
  display_name           text        NOT NULL,
  color                  text        NOT NULL,
  joined_at              timestamptz NOT NULL,
  connection             text        NOT NULL,
  disconnected_at        timestamptz NULL,
  camera                 text        NOT NULL DEFAULT 'none',
  ready                  boolean     NOT NULL DEFAULT false,
  token_hash             text        NULL,
  token_issued_at        timestamptz NULL,
  prev_token_hash        text        NULL,
  prev_token_valid_until timestamptz NULL,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  -- DEC-043: 1–20 karakter (char_length menghitung code point, sama dengan validasi aplikasi).
  CONSTRAINT lr_participants_name_length
    CHECK (char_length(display_name) BETWEEN 1 AND 20),
  CONSTRAINT lr_participants_color_valid
    CHECK (color IN ('P1', 'P2', 'P3', 'P4')),
  CONSTRAINT lr_participants_connection_valid
    CHECK (connection IN ('CONNECTED', 'RECONNECTING', 'LEFT')),
  CONSTRAINT lr_participants_camera_valid
    CHECK (camera IN ('live', 'off', 'permission', 'none', 'in_use')),
  CONSTRAINT lr_participants_token_hash_format
    CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT lr_participants_prev_token_hash_format
    CHECK (prev_token_hash IS NULL OR prev_token_hash ~ '^[0-9a-f]{64}$'),
  -- Peserta LEFT tidak boleh punya kredensial aktif (07 §11).
  CONSTRAINT lr_participants_left_has_no_token
    CHECK (connection <> 'LEFT' OR (token_hash IS NULL AND prev_token_hash IS NULL))
);

-- Warna unik di antara peserta non-LEFT. Karena hanya ada 4 warna, indeks ini juga
-- membatasi peserta aktif ≤ 4 per room di level database (pertahanan kedua di bawah
-- actor serial, REQ-ROOM-06).
CREATE UNIQUE INDEX IF NOT EXISTS lr_participants_active_color_uidx
  ON lr_participants (room_id, color) WHERE connection <> 'LEFT';
CREATE INDEX IF NOT EXISTS lr_participants_room_idx ON lr_participants (room_id);

-- -----------------------------------------------------------------------------
-- Event room non-volatile (ber-seq) untuk replay resume setelah restart (14 §13).
-- Service memangkas otomatis ke ±500 event terakhir per room. Kursor, heartbeat,
-- dan awareness TIDAK pernah ditulis ke sini.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lr_room_events (
  room_id      uuid        NOT NULL REFERENCES lr_rooms (room_id) ON DELETE CASCADE,
  seq          bigint      NOT NULL,
  type         text        NOT NULL,
  payload      jsonb       NOT NULL,
  room_version bigint      NOT NULL,
  at           timestamptz NOT NULL,
  PRIMARY KEY (room_id, seq),
  CONSTRAINT lr_room_events_seq_positive CHECK (seq >= 1),
  CONSTRAINT lr_room_events_type_length CHECK (char_length(type) BETWEEN 1 AND 64)
);

-- -----------------------------------------------------------------------------
-- Rate limit fixed-window (DEC-067). `bucket` berisi jenis + HASH IP bersalt,
-- bukan IP mentah (15 §9).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lr_rate_limits (
  bucket       text        NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer     NOT NULL,
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (bucket, window_start),
  CONSTRAINT lr_rate_limits_bucket_length CHECK (char_length(bucket) BETWEEN 1 AND 128),
  CONSTRAINT lr_rate_limits_hits_positive CHECK (hits >= 1)
);

CREATE INDEX IF NOT EXISTS lr_rate_limits_expires_idx ON lr_rate_limits (expires_at);

INSERT INTO lr_schema_migrations (version) VALUES ('0001_p02_rooms')
ON CONFLICT (version) DO NOTHING;

COMMIT;
