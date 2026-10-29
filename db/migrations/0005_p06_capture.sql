-- =============================================================================
-- LONGROLL — Migrasi 0005: state capture P06 (shot, attempt, keputusan per peserta)
-- -----------------------------------------------------------------------------
-- Prasyarat: 0001–0004. Idempoten, non-destruktif (hanya ADD COLUMN), satu transaksi.
-- `capture` berisi Shot[] + Attempt[] (metadata, TANPA byte foto) milik sesi; objek foto ada di object
-- storage privat di bawah rooms/{roomId}/attempts/. JSON ini sekaligus indeks aset attempt untuk
-- cleanup & verifikasi (14 §11). Ikut terhapus bersama room (cascade lr_sessions).
-- Hak role aplikasi: sudah cukup (UPDATE pada lr_sessions mencakup kolom baru).
-- =============================================================================

BEGIN;

ALTER TABLE lr_sessions ADD COLUMN IF NOT EXISTS capture jsonb NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_sessions_capture_object') THEN
    ALTER TABLE lr_sessions
      ADD CONSTRAINT lr_sessions_capture_object CHECK (capture IS NULL OR jsonb_typeof(capture) = 'object');
  END IF;
END $$;

INSERT INTO lr_schema_migrations (version) VALUES ('0005_p06_capture')
ON CONFLICT (version) DO NOTHING;

COMMIT;
