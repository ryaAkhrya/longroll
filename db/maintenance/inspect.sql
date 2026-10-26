-- =============================================================================
-- LONGROLL — Pemeriksaan READ-ONLY setelah migrasi 0001. Aman dijalankan kapan saja.
-- =============================================================================

-- 1. Versi skema yang tercatat (harus ada '0001_p02_rooms').
SELECT version, applied_at FROM lr_schema_migrations ORDER BY version;

-- 2. Tabel & indeks yang diharapkan ada.
SELECT tablename FROM pg_tables
 WHERE schemaname = current_schema()
   AND tablename IN ('lr_schema_migrations', 'lr_room_codes', 'lr_rooms', 'lr_participants', 'lr_room_events', 'lr_rate_limits')
 ORDER BY tablename;

SELECT indexname FROM pg_indexes
 WHERE schemaname = current_schema() AND tablename LIKE 'lr\_%'
 ORDER BY indexname;

-- 3. Ringkasan isi (tanpa data pribadi).
SELECT status, count(*) AS rooms FROM lr_rooms GROUP BY status ORDER BY status;
SELECT state, count(*) AS codes, min(tombstone_until) AS next_tombstone_expiry FROM lr_room_codes GROUP BY state;
SELECT count(*) AS active_participants FROM lr_participants WHERE connection <> 'LEFT';
SELECT count(*) AS events FROM lr_room_events;
SELECT count(*) AS rate_limit_rows, min(expires_at) AS oldest_expiry FROM lr_rate_limits;

-- 4. Invariant: tidak boleh ada room dengan > 4 peserta aktif (harus 0 baris).
SELECT room_id, count(*) FROM lr_participants WHERE connection <> 'LEFT' GROUP BY room_id HAVING count(*) > 4;

-- 5. Room yang macet di EXPIRING > 30 menit (cleanup perlu dicek; service akan me-retry).
SELECT room_id, code, updated_at FROM lr_rooms WHERE status = 'EXPIRING' AND updated_at < now() - interval '30 minutes';
