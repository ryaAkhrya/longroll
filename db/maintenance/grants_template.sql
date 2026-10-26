-- =============================================================================
-- LONGROLL — Role aplikasi least-privilege untuk service realtime (P02).
-- -----------------------------------------------------------------------------
-- PENTING (Neon): role yang dibuat lewat Neon Console/API/CLI otomatis menjadi
-- anggota `neon_superuser` (CREATEROLE, CREATEDB, BYPASSRLS, pg_write_all_data).
-- Karena itu role aplikasi dibuat dengan SQL ini, dijalankan sebagai pemilik
-- database (mis. neondb_owner), SETELAH migrasi 0001.
--
-- Password diberikan lewat variabel psql (jangan ditulis di file ini):
--   psql "$OWNER_URL" -v app_password="$(openssl rand -base64 36 | tr -d '/+=')" -f grants_template.sql
-- Neon mensyaratkan password role SQL berentropi ≥ 60 bit.
--
-- Hak yang diberikan = persis yang dipakai PostgresRoomStore P02:
--   lr_schema_migrations : SELECT                        (cek versi skema saat start)
--   lr_room_codes        : SELECT, INSERT, UPDATE, DELETE (reservasi, tombstone, purge)
--   lr_rooms             : SELECT, INSERT, UPDATE, DELETE (snapshot, cleanup; DELETE meng-cascade)
--   lr_participants      : SELECT, INSERT, UPDATE         (upsert; dihapus via cascade milik owner)
--   lr_room_events       : SELECT, INSERT, DELETE         (append + pangkas)
--   lr_rate_limits       : SELECT, INSERT, UPDATE, DELETE (counter + purge)
-- Tidak ada: DDL, TRUNCATE, REFERENCES, TRIGGER, CREATE di schema, tabel TEMP,
-- CREATEDB/CREATEROLE/BYPASSRLS, keanggotaan neon_superuser.
-- =============================================================================

BEGIN;

CREATE ROLE longroll_app
  LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 20;

-- Batas waktu sisi server sebagai pengaman tambahan (aplikasi juga memasang statement_timeout).
ALTER ROLE longroll_app SET statement_timeout = '10s';
ALTER ROLE longroll_app SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE longroll_app SET lock_timeout = '5s';

-- PUBLIC secara default boleh membuat tabel TEMP di database; cabut agar role aplikasi tidak
-- bisa melakukan DDL sementara. Pemilik database & neon_superuser tidak terdampak (punya hak eksplisit).
REVOKE TEMPORARY ON DATABASE neondb FROM PUBLIC;
GRANT CONNECT ON DATABASE neondb TO longroll_app;

-- Schema public: hanya USAGE (tanpa CREATE). PostgreSQL 15+ sudah tidak memberi CREATE ke PUBLIC.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO longroll_app;

GRANT SELECT                         ON lr_schema_migrations TO longroll_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON lr_room_codes        TO longroll_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON lr_rooms             TO longroll_app;
GRANT SELECT, INSERT, UPDATE         ON lr_participants      TO longroll_app;
GRANT SELECT, INSERT, DELETE         ON lr_room_events       TO longroll_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON lr_rate_limits       TO longroll_app;
-- P04/P05 (tabel dari migrasi 0003/0004; migrasi itu juga memberi hak ini bila role sudah ada).
GRANT SELECT, INSERT, UPDATE         ON lr_sessions          TO longroll_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON lr_frames            TO longroll_app;

COMMIT;

-- Jangan ekspos tabel lr_* lewat Neon Data API / role publik mana pun:
-- tabel ini berisi hash token & display name dan hanya untuk service realtime.
