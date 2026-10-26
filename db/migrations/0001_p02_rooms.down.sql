-- =============================================================================
-- LONGROLL — ROLLBACK migrasi 0001 (DESTRUKTIF)
-- -----------------------------------------------------------------------------
-- MENGHAPUS SEMUA TABEL P02 BESERTA ISINYA: room aktif, peserta, event,
-- tombstone, dan counter rate limit. Semua room yang sedang berjalan hilang dan
-- semua peserta keluar paksa.
--
-- Jalankan HANYA bila memang ingin membatalkan migrasi 0001, sebaiknya di branch
-- development, setelah service realtime DIHENTIKAN. Jangan jalankan di produksi
-- tanpa keputusan eksplisit.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS lr_room_events;
DROP TABLE IF EXISTS lr_participants;
DROP TABLE IF EXISTS lr_rooms;
DROP TABLE IF EXISTS lr_room_codes;
DROP TABLE IF EXISTS lr_rate_limits;
DELETE FROM lr_schema_migrations WHERE version = '0001_p02_rooms';
-- lr_schema_migrations sengaja tidak di-drop (dipakai migrasi berikutnya).

COMMIT;
