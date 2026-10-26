-- =============================================================================
-- LONGROLL — Migrasi 0003: sesi & voting P04 (+ wadah studio P05)
-- -----------------------------------------------------------------------------
-- Prasyarat: 0001, 0002. Idempoten, non-destruktif, satu transaksi.
-- Data sesi ikut terhapus bersama room (ON DELETE CASCADE).
-- Hak role aplikasi: SELECT/INSERT/UPDATE (tanpa DELETE langsung; penghapusan via cascade).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS lr_sessions (
  session_id  uuid        PRIMARY KEY,
  room_id     uuid        NOT NULL REFERENCES lr_rooms (room_id) ON DELETE CASCADE,
  idx         integer     NOT NULL,
  state       text        NOT NULL,
  mode        text        NULL,
  created_at  timestamptz NOT NULL,
  created_by  uuid        NOT NULL,
  locked_at   timestamptz NULL,
  -- Voting terbuka (bukan rahasia, 08 §4): fase, ronde, opsi, suara, jendela tutup, hasil.
  voting      jsonb       NOT NULL,
  -- StudioState P05 (null sampai mode terkunci).
  studio      jsonb       NULL,
  event_log   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lr_sessions_idx_range CHECK (idx BETWEEN 1 AND 1000),
  CONSTRAINT lr_sessions_state_valid
    CHECK (state IN ('VOTING', 'STUDIO', 'CAPTURING', 'EDITING', 'FINAL', 'CLOSED')),
  CONSTRAINT lr_sessions_mode_valid
    CHECK (mode IS NULL OR mode IN ('PHOTO_STRIP', 'GROUP_SHOT', 'PHOTO_GRID', 'FREEFORM_COLLAGE')),
  -- REQ-VOTE-06: setelah VOTING, mode wajib ada (terkunci).
  CONSTRAINT lr_sessions_mode_locked CHECK (state = 'VOTING' OR mode IS NOT NULL),
  CONSTRAINT lr_sessions_voting_object CHECK (jsonb_typeof(voting) = 'object'),
  CONSTRAINT lr_sessions_event_log_array CHECK (jsonb_typeof(event_log) = 'array'),
  CONSTRAINT lr_sessions_room_idx_unique UNIQUE (room_id, idx)
);

CREATE INDEX IF NOT EXISTS lr_sessions_room_idx ON lr_sessions (room_id);

-- Role aplikasi least-privilege (dibuat lewat db/maintenance/grants_template.sql).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'longroll_app') THEN
    GRANT SELECT, INSERT, UPDATE ON lr_sessions TO longroll_app;
  END IF;
END $$;

INSERT INTO lr_schema_migrations (version) VALUES ('0003_p04_sessions')
ON CONFLICT (version) DO NOTHING;

COMMIT;
