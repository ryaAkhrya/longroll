### Handoff P02 — Adaptasi PostgreSQL (Neon)

- **Status:** TERVERIFIKASI di Neon project `longroll`, branch `development` (2026-10-26). Branch `production` tidak disentuh.
- **Hasil verifikasi:**
  - Migrasi `0001_p02_rooms` sudah tercatat (diterapkan pemilik); skema cocok (6 tabel, 13 indeks, 21 constraint). Tidak dijalankan ulang.
  - Typecheck, lint, unit (55), integrasi (11, termasuk adapter PostgreSQL ke Neon dev), build: lulus.
  - E2E Playwright 4 konteks (realtime memakai Neon dev): lulus.
  - Restart service: room, peserta, dan cookie lama pulih dari Neon; grace dilanjutkan; cleanup menghapus semua baris room dan menulis tombstone.
- **Koneksi lokal:** `apps/realtime/.env` (di-.gitignore) berisi `DATABASE_URL` pooled milik role `longroll_app`, dengan `sslmode=verify-full`. Kredensial owner sudah tidak disimpan di disk.
- **Role aplikasi `longroll_app` (development):**
  - Dibuat lewat SQL (`db/maintenance/grants_template.sql`), bukan lewat Console/API, sehingga tidak menjadi anggota `neon_superuser`.
  - Atribut: NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOINHERIT, NOBYPASSRLS, tanpa keanggotaan role lain, batas 20 koneksi.
  - Timeout di level role: statement 10 s, idle-in-transaction 15 s, lock 5 s.
  - Hak: hanya DML yang dipakai P02 (lihat template). Tanpa CREATE pada schema/database, tanpa TEMP (dicabut dari PUBLIC di dev).
  - Terverifikasi ditolak (42501): CREATE TABLE/TEMP/SCHEMA/INDEX/FUNCTION/ROLE/DATABASE, ALTER, DROP, TRUNCATE, `SET ROLE` ke owner, DELETE peserta, UPDATE event, INSERT ke `lr_schema_migrations`. `GRANT` dari app tidak berefek.
  - Cascade cleanup tetap jalan (aksi FK dijalankan dengan hak pemilik tabel).
  - Integrasi 11/11, E2E 2/2, dan uji restart + cleanup lulus memakai role ini.

#### Deviasi arsitektur dari dokumentasi V1.1 (dicatat di sini, docs/ tidak diubah)

| Dokumen | V1.1 | Sekarang | Status |
|---|---|---|---|
| 13 §7–§8, DEC-037 | Snapshot room di Redis (AOF) + TTL | PostgreSQL (Neon). Room actor di memori tetap otoritatif | Keputusan pemilik produk; perlu dicatat sebagai DEC baru di 18 oleh pemilik dokumen |
| 15 §8.2 langkah 4–5 | `DEL room:{roomId}:*` + `code:{CODE}` tombstone | `DELETE FROM lr_rooms` (cascade) + upsert tombstone di `lr_room_codes`, **satu transaksi** | Setara |
| 13 §8 TTL keamanan 48 jam | TTL Redis | Tidak ada TTL. Penghapusan eksplisit (grace → cleanup) + sweeper `purgeExpired` | Lihat `db/README.md` |
| DEC-067 counter | Redis INCR | `lr_rate_limits` fixed-window (`INSERT … ON CONFLICT … hits + 1`) + purge berkala | Setara |
| 14 §13 ring buffer | Memori (hilang saat restart) | Memori + `lr_room_events` (±500 terakhir/room) → resume tetap replay setelah restart | Lebih kuat |

#### Yang dipertahankan (tanpa perubahan perilaku)

- Room actor serial; event kritis **disimpan (commit) dulu sebelum ack/siaran**.
- Kapasitas 4 atomik di actor. Database menambah pengaman: indeks unik parsial `(room_id, color) WHERE connection <> 'LEFT'`; karena hanya ada 4 warna, peserta aktif per room maksimal 4.
- Token tetap disimpan sebagai hash SHA-256 (CHECK format hex). Peserta `LEFT` tidak boleh punya token (CHECK).
- Rotasi token, cookie HttpOnly, takeover multi-tab, presence, reconnect, hold slot vs grace, tombstone 24 jam, dan DEC-052 nonaktif (`expires_at` NULL).
- Kursor, heartbeat, dan rate limit event WebSocket **tidak** ditulis ke database (memori proses).

#### Konkurensi & pemulihan

- **Satu transaksi per mutasi:** `UPDATE lr_rooms … WHERE revision = expected` (mengunci baris room), lalu upsert peserta yang berubah saja, insert event baru, dan pangkas event lama.
- `revision` adalah penghitung khusus server, terpisah dari `roomVersion` milik klien.
- **Revisi tidak cocok** (commit ambigu setelah koneksi putus, atau penulis kedua):
  - intent ditolak `SERVICE_UNAVAILABLE`;
  - actor memuat ulang state + event dari database;
  - klien terhubung menerima `room.snapshot`;
  - bila room sudah tidak ada di database → `room.expired`.
- **Database mati / timeout** (`statement_timeout` 5 s, koneksi 5 s):
  - mutasi ditolak `SERVICE_UNAVAILABLE` dan state di memori tidak berubah;
  - klien me-retry dengan `clientEventId` yang sama;
  - putus koneksi di-retry tiap 2 s.
- **Restart:** room `ACTIVE/GRACE/EXPIRING` dimuat dari `lr_rooms`.
  - Peserta `CONNECTED` → `RECONNECTING`.
  - Grace dilanjutkan dari `empty_since` yang tersimpan.
  - Room `EXPIRING` melanjutkan cleanup.
- **Cleanup:**
  - objek storage dihapus dan diverifikasi kosong **dulu**, baru data room dihapus + tombstone (satu transaksi);
  - setelah itu `countRoomData = 0` diverifikasi;
  - gagal → retry 1m/5m/15m/1j; room tetap `EXPIRING` sampai bersih.
- **Startup:** service tidak pernah membuat skema. Bila `0001_p02_rooms` belum ada → log `store.schema_missing` lalu berhenti.

#### Kompatibilitas Neon

- Driver `pg` (node-postgres) dengan pool maks. 5 (`DATABASE_POOL_MAX`).
- Aman dengan endpoint **pooled** (PgBouncer mode transaksi): tanpa LISTEN/NOTIFY, tanpa advisory lock sesi, tanpa prepared statement bernama.
- Error koneksi idle (compute di-suspend) ditangkap dan tidak menjatuhkan proses.

#### File

| Area | File |
|---|---|
| SQL baru | `db/migrations/0001_p02_rooms.sql`, `db/migrations/0001_p02_rooms.down.sql` (destruktif) |
| Skrip pemeliharaan | `db/maintenance/inspect.sql`, `purge_expired.sql`, `grants_template.sql`, `db/README.md` |
| Kode baru | `apps/realtime/src/store/db.ts`, `apps/realtime/src/store/postgres.ts` |
| Kode diubah | `apps/realtime/src/store/{types,memory}.ts`, `apps/realtime/src/room/{RoomActor,RoomManager,cleanup,types}.ts`, `apps/realtime/src/{config,index}.ts`, `packages/shared/src/config.ts` |
| Dihapus | `apps/realtime/src/store/redis.ts`, `apps/realtime/test/integration/redis.test.ts`, dependensi `ioredis` |
| Tes | `src/store/postgres.test.ts` (Db palsu), `src/room/{RoomActor,cleanup}.test.ts` (revisi, replay setelah restart, resync, tombstone), `test/integration/postgres.test.ts` (dilewati kecuali `LONGROLL_TEST_DATABASE_URL` diset manual) |
| Konfigurasi | `.env.example`: `DATABASE_URL`, `DATABASE_POOL_MAX`, `DATABASE_STATEMENT_TIMEOUT_MS`, `LONGROLL_TEST_DATABASE_URL`. Script `dev`/`start` realtime membaca `apps/realtime/.env` bila ada |

#### Langkah manual (pemilik database)

Lihat `db/README.md`. Ringkasnya, di branch **development** Neon:

1. Jalankan `0001_p02_rooms.sql`.
2. Jalankan `inspect.sql`.
3. (Opsional) Jalankan `grants_template.sql`.
4. Isi `DATABASE_URL` di `apps/realtime/.env`, lalu start service.

Jangan anggap migrasi sukses sebelum langkah 2 terkonfirmasi.

#### Tes yang belum dijalankan

- Perangkat nyata iOS/Android, Safari, dan pengukuran latensi p95 di bawah beban.
- Branch `production` belum dimigrasi/diuji (sengaja).

#### Risiko terbuka

- **Latensi.** Setiap event kritis (join/leave/presence koneksi/rotasi token) = 1 transaksi ke Neon sebelum ack. Region Neon harus sama dengan realtime service (DEC-051, mis. Singapura); target round-trip ≤ 150 ms p95 perlu diukur.
- **Cold start Neon.** Setelah autosuspend, query pertama bisa lambat (berpotensi kena timeout 5 s → `SERVICE_UNAVAILABLE` sementara). Untuk produksi, pertimbangkan menonaktifkan autosuspend atau menaikkan `DATABASE_STATEMENT_TIMEOUT_MS`.
- **Tidak ada RLS.** Tabel `lr_*` tidak boleh diekspos lewat Neon Data API / role publik.
- **Password owner `neondb_owner` (development)** sempat tersimpan di `.env` lokal dan muncul di log sesi agen. Disarankan dirotasi lewat Neon Console.
- **Branch `production`** belum punya migrasi maupun role `longroll_app`. Ulangi `0001` + `grants_template.sql` saat siap rilis.
- **Reservasi kode yatim.** Crash di antara reservasi kode dan simpan room membuat kode tertahan ≤ 1 jam sampai dipurge.
- **CSP.** Masih `script-src 'unsafe-inline'`; tidak berubah di tahap ini.
