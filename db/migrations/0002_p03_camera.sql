-- =============================================================================
-- LONGROLL — Migrasi 0002: presence kamera P03 (cermin + framing pra-capture)
-- -----------------------------------------------------------------------------
-- Prasyarat: 0001_p02_rooms. Idempoten, non-destruktif (hanya ADD COLUMN dengan
-- DEFAULT), satu transaksi. Baris peserta lama otomatis mendapat nilai default.
-- Hak role aplikasi `longroll_app` pada lr_participants (SELECT/INSERT/UPDATE)
-- otomatis mencakup kolom baru; tidak perlu GRANT tambahan.
-- =============================================================================

BEGIN;

ALTER TABLE lr_participants
  ADD COLUMN IF NOT EXISTS mirrored boolean NOT NULL DEFAULT false;

-- 09 §4 / 14 §3 CameraPresentation: hanya pemilik yang boleh menulis (ditegakkan service).
ALTER TABLE lr_participants
  ADD COLUMN IF NOT EXISTS camera_presentation jsonb NOT NULL
    DEFAULT '{"zoom":1,"offset":{"x":0,"y":0},"brightness":0,"warmth":0}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lr_participants_camera_presentation_object') THEN
    ALTER TABLE lr_participants
      ADD CONSTRAINT lr_participants_camera_presentation_object
      CHECK (jsonb_typeof(camera_presentation) = 'object');
  END IF;
END $$;

INSERT INTO lr_schema_migrations (version) VALUES ('0002_p03_camera')
ON CONFLICT (version) DO NOTHING;

COMMIT;
