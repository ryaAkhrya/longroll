# Database LONGROLL (PostgreSQL / Neon)

Database dikelola **hanya oleh pemiliknya**. Service realtime tidak pernah menjalankan migrasi atau DDL;
saat start ia hanya memeriksa bahwa `lr_schema_migrations` berisi versi yang dibutuhkan.

## Isi folder

| File | Sifat | Kapan |
|---|---|---|
| `migrations/0001_p02_rooms.sql` | Idempoten, non-destruktif, satu transaksi | Wajib sebelum service memakai `DATABASE_URL` |
| `maintenance/inspect.sql` | Read-only | Setelah migrasi / kapan saja |
| `maintenance/grants_template.sql` | Membuat role `longroll_app` + hak minimum | Wajib sebelum service memakai database |
| `maintenance/purge_expired.sql` | Hanya baris kedaluwarsa | Opsional; service sudah mem-purge berkala |
| `migrations/0001_p02_rooms.down.sql` | **DESTRUKTIF** (DROP semua tabel P02) | Hanya untuk membatalkan 0001 |

## Urutan manual (mulai dari branch development Neon)

1. Buka SQL Editor Neon pada **branch development** (bukan produksi), database tujuan.
2. Baca isi `migrations/0001_p02_rooms.sql`, lalu jalankan seluruh file (sudah dibungkus `BEGIN … COMMIT`).
3. Jalankan `maintenance/inspect.sql`. Hasil yang diharapkan:
   - ada baris `0001_p02_rooms` di `lr_schema_migrations`;
   - 6 tabel `lr_*` ada;
   - query invariant (#4) mengembalikan 0 baris.
4. Buat role aplikasi least-privilege dengan `maintenance/grants_template.sql` (SQL, sebagai owner,
   password lewat variabel psql). **Jangan** buat role aplikasi lewat Neon Console/API: role seperti itu
   otomatis menjadi anggota `neon_superuser`.
5. Simpan connection string **pooled** milik role `longroll_app` (host `…-pooler…`, `sslmode=verify-full`)
   ke `apps/realtime/.env` sebagai `DATABASE_URL`. Jangan pakai kredensial owner di aplikasi; jangan commit file ini.
6. Start service: `npm run dev:realtime`. Log `store.schema_missing` = langkah 2 belum berhasil;
   `store.unreachable` = koneksi/kredensial/jaringan.
7. Setelah dev branch terverifikasi, ulangi langkah 1–5 di branch produksi.

Tidak ada migrasi lain untuk P02. Urutan file berikutnya mengikuti nomor (`0002_…`, dst.).

## Perilaku data (tanpa TTL bawaan)

PostgreSQL tidak menghapus data otomatis. Penghapusan dikerjakan service secara eksplisit:

| Data | Dihapus oleh | Kapan |
|---|---|---|
| Room + peserta + event (`lr_rooms`, cascade) | Cleanup room | Grace habis → EXPIRING → objek storage bersih → `DELETE` + tombstone dalam satu transaksi → verifikasi |
| Event lama | Setiap simpan | Hanya ±500 event terakhir per room yang disimpan |
| Tombstone kode | Sweeper (`purgeExpired`) | 24 jam setelah room bubar |
| Counter rate limit | Sweeper | Setelah window-nya lewat |
| Reservasi kode yatim | Sweeper | > 1 jam tanpa baris room (crash saat bikin room) |

Room yang macet di `EXPIRING` (mis. storage gagal dihapus) tetap ada dan di-retry (1m/5m/15m/1j);
`inspect.sql` #5 menampilkannya.
