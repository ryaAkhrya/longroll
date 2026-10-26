-- =============================================================================
-- LONGROLL — Purge manual data kedaluwarsa (OPSIONAL).
-- -----------------------------------------------------------------------------
-- Service realtime menjalankan pembersihan yang sama secara berkala
-- (RoomStore.purgeExpired). Skrip ini hanya untuk operator bila service mati
-- lama. Hanya menyentuh baris yang SUDAH kedaluwarsa; tidak menghapus room yang
-- masih ACTIVE/GRACE/EXPIRING (room dihapus oleh service lewat cleanup + verifikasi,
-- termasuk objek storage-nya).
-- =============================================================================

BEGIN;

-- Tombstone kode yang masa 24 jamnya sudah lewat (DEC-084).
DELETE FROM lr_room_codes
 WHERE state = 'TOMBSTONE' AND tombstone_until <= now();

-- Counter rate limit yang window-nya sudah lewat.
DELETE FROM lr_rate_limits
 WHERE expires_at <= now();

-- Reservasi kode yatim: service crash di antara reservasi kode dan penyimpanan room.
DELETE FROM lr_room_codes c
 WHERE c.state = 'ACTIVE'
   AND c.created_at < now() - interval '1 hour'
   AND NOT EXISTS (SELECT 1 FROM lr_rooms r WHERE r.room_id = c.room_id);

COMMIT;
