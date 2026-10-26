-- =============================================================================
-- LONGROLL — Migrasi 0004: frame custom P05 (indeks aset frame per room)
-- -----------------------------------------------------------------------------
-- Prasyarat: 0001, 0002, 0003. Idempoten, non-destruktif (hanya CREATE/GRANT), satu transaksi.
-- Baris frame ikut terhapus bersama room (ON DELETE CASCADE). Objek di storage dihapus cleanup room
-- (prefix rooms/{roomId}/) SEBELUM baris room dihapus; tabel ini juga menjadi indeks aset untuk
-- verifikasi cleanup (14 §11, 15 §8).
-- Hak role aplikasi: SELECT/INSERT/UPDATE/DELETE (upload gagal/kedaluwarsa dihapus barisnya).
-- StudioState disimpan di lr_sessions.studio (kolom sudah ada sejak 0003).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS lr_frames (
  frame_id        uuid        PRIMARY KEY,
  room_id         uuid        NOT NULL REFERENCES lr_rooms (room_id) ON DELETE CASCADE,
  uploaded_by     uuid        NOT NULL,
  status          text        NOT NULL,
  file_name       text        NOT NULL,
  content_type    text        NOT NULL,
  declared_bytes  integer     NOT NULL,
  raw_key         text        NOT NULL,
  object_key      text        NULL,
  bytes           integer     NULL,
  -- FrameTemplate (10 §8) setelah validasi & re-encode server.
  template        jsonb       NULL,
  created_at      timestamptz NOT NULL,
  -- Batas upload PENDING (presign); NULL setelah READY.
  expires_at      timestamptz NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lr_frames_status_valid CHECK (status IN ('PENDING', 'READY')),
  CONSTRAINT lr_frames_content_type_valid CHECK (content_type IN ('image/png', 'image/webp')),
  CONSTRAINT lr_frames_declared_bytes_range CHECK (declared_bytes BETWEEN 1 AND 10485760),
  CONSTRAINT lr_frames_bytes_range CHECK (bytes IS NULL OR bytes BETWEEN 1 AND 10485760),
  CONSTRAINT lr_frames_file_name_len CHECK (char_length(file_name) BETWEEN 1 AND 120),
  -- Semua objek wajib di bawah prefix room (cleanup per prefix, 15 §8).
  CONSTRAINT lr_frames_raw_key_prefix CHECK (raw_key LIKE 'rooms/' || room_id::text || '/frames/%'),
  CONSTRAINT lr_frames_object_key_prefix CHECK (object_key IS NULL OR object_key LIKE 'rooms/' || room_id::text || '/frames/%'),
  CONSTRAINT lr_frames_ready_complete
    CHECK (status = 'PENDING' OR (object_key IS NOT NULL AND template IS NOT NULL AND bytes IS NOT NULL)),
  CONSTRAINT lr_frames_template_object CHECK (template IS NULL OR jsonb_typeof(template) = 'object')
);

CREATE INDEX IF NOT EXISTS lr_frames_room_idx ON lr_frames (room_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'longroll_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON lr_frames TO longroll_app;
  END IF;
END $$;

INSERT INTO lr_schema_migrations (version) VALUES ('0004_p05_frames')
ON CONFLICT (version) DO NOTHING;

COMMIT;
