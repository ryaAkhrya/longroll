-- =============================================================================
-- LONGROLL — Migrasi 0006: snapshot dokumen editor kolaboratif P07 (Yjs)
-- -----------------------------------------------------------------------------
-- Prasyarat: 0001–0005. Idempoten, non-destruktif (CREATE TABLE IF NOT EXISTS), satu transaksi.
-- Satu baris per sesi: `Y.encodeStateAsUpdate` (biner) — ditulis maks. tiap 5 detik bila ada perubahan
-- (tidak per-update, agar tulis PostgreSQL tetap rendah). Awareness/kursor TIDAK pernah disimpan.
-- Ikut terhapus bersama sesi/room (ON DELETE CASCADE). Batas ukuran 2 MB ditegakkan server + CHECK.
-- Hak role aplikasi: SELECT, INSERT, UPDATE (tanpa DELETE; penghapusan via cascade).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS lr_editor_docs (
  session_id  uuid        PRIMARY KEY REFERENCES lr_sessions (session_id) ON DELETE CASCADE,
  room_id     uuid        NOT NULL REFERENCES lr_rooms (room_id) ON DELETE CASCADE,
  doc         bytea       NOT NULL,
  bytes       integer     NOT NULL,
  version     bigint      NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lr_editor_docs_size CHECK (bytes BETWEEN 1 AND 2621440 AND octet_length(doc) = bytes)
);

CREATE INDEX IF NOT EXISTS lr_editor_docs_room_idx ON lr_editor_docs (room_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'longroll_app') THEN
    GRANT SELECT, INSERT, UPDATE ON lr_editor_docs TO longroll_app;
  END IF;
END $$;

INSERT INTO lr_schema_migrations (version) VALUES ('0006_p07_editor_docs')
ON CONFLICT (version) DO NOTHING;

COMMIT;
