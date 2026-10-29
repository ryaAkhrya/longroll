-- =============================================================================
-- LONGROLL — Migrasi 0007: hasil sesi & galeri P08 (SessionResult)
-- -----------------------------------------------------------------------------
-- Prasyarat: 0001–0006. Idempoten, non-destruktif (hanya ADD COLUMN), satu transaksi.
-- `result` = SessionResult (metadata: siapa/kapan finalisasi, accepted attempt per shot, snapshot nama peserta,
-- key objek snapshot dokumen & pratinjau di storage). TANPA byte gambar dan tanpa data attempt REJECTED.
-- Ikut terhapus bersama room (cascade lr_sessions). Hak role aplikasi sudah cukup (UPDATE lr_sessions).
-- =============================================================================

BEGIN;

ALTER TABLE lr_sessions ADD COLUMN IF NOT EXISTS result jsonb NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_sessions_result_object') THEN
    ALTER TABLE lr_sessions
      ADD CONSTRAINT lr_sessions_result_object CHECK (result IS NULL OR jsonb_typeof(result) = 'object');
  END IF;
END $$;

INSERT INTO lr_schema_migrations (version) VALUES ('0007_p08_results')
ON CONFLICT (version) DO NOTHING;

COMMIT;
