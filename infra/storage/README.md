# Object storage LONGROLL (privat, sementara)

Status: **bucket dev dibuat, kredensial/CORS BELUM diverifikasi** (lihat HANDOFF_P09.md §Storage).

## Bucket
- Neon Object Storage, branch `development` (project `hidden-glade-82216110`), bucket **`longroll-dev`**, access level **private**.
- Endpoint: `https://br-quiet-dust-azdjpq7u.storage.c-3.ap-southeast-1.aws.neon.tech`, region `ap-southeast-1`, path-style.
- Semua objek di bawah `rooms/{roomId}/`. Klien hanya memakai presigned URL (PUT ≤ 5 mnt, GET ≤ 10 mnt).

## Langkah manual (butuh kredensial; jangan di-commit)
1. Buat kredensial untuk branch `development` dengan scope **`storage:write`** (bukan lebih):
   `neon credentials create --project-id hidden-glade-82216110 --branch development --scope storage:write --name longroll-dev-storage`
   (`token_id` → `S3_ACCESS_KEY_ID`, `s3_secret_access_key` → `S3_SECRET_ACCESS_KEY`; ditampilkan sekali.)
2. Isi `apps/realtime/.env` (file ini di-.gitignore):
   ```
   S3_ENDPOINT=https://br-quiet-dust-azdjpq7u.storage.c-3.ap-southeast-1.aws.neon.tech
   S3_REGION=ap-southeast-1
   S3_BUCKET=longroll-dev
   S3_FORCE_PATH_STYLE=true
   S3_ACCESS_KEY_ID=...
   S3_SECRET_ACCESS_KEY=...
   ```
3. CORS (ganti `AllowedOrigins` dengan `ALLOWED_ORIGINS` yang sebenarnya, tanpa wildcard):
   `aws s3api put-bucket-cors --bucket longroll-dev --cors-configuration file://infra/storage/cors.json --endpoint-url $S3_ENDPOINT`
4. Verifikasi adapter terhadap bucket nyata (hanya menyentuh prefix `rooms/{uuid-acak}/` miliknya):
   `LONGROLL_TEST_S3=1 npx vitest run --config vitest.integration.config.ts test/integration/s3.storage.test.ts` (di `apps/realtime`, dengan env S3_* terpasang).
5. Jalankan service dengan env tsb; cek `storage: "s3"` pada log `server.listening`.

## Lifecycle 24 jam (DEC-036) — TIDAK TERSEDIA di Neon Object Storage
`lifecycle.json` hanya disimpan; Neon **tidak menjalankan** aturan lifecycle (docs: "Lifecycle rules stored but not enforced").
Lapisan terakhir penghapusan di Neon = **sweeper objek yatim harian** di service realtime (`ORPHAN_SWEEP_INTERVAL_SECONDS`,
default 86400; `RoomManager.sweepOrphans`) + cleanup per room. Bila pindah ke provider yang menegakkan lifecycle
(S3/R2), terapkan `lifecycle.json` (TC-SEC-032) dan tetap jalankan sweeper.

## Catatan privasi provider
- `DeleteObject` di Neon = *soft delete* pada branch (copy-on-write). Jangan klaim "dihapus permanen" (15 §8.4).
- Konfigurasi enkripsi at-rest tidak dapat dibaca/diatur lewat API (`GetBucketEncryption` = 501) → DEC-075 **tidak terverifikasi**.
