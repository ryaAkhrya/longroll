# Checklist produksi LONGROLL

Legenda: ✅ selesai & terbukti di repo/dev · ⛔ diblokir (butuh tindakan/akun/infrastruktur eksternal) · ⚠️ ada celah/keputusan.
**Aplikasi publik BELUM boleh disebut berfungsi** sampai bagian "Verifikasi publik" dijalankan terhadap deployment nyata.

## 1. Infrastruktur yang dibutuhkan (manual)
| # | Item | Status | Tindakan |
|---|---|---|---|
| 1 | **Domain kustom** (satu registrable domain untuk `app.` dan `rt.`) | ⛔ | Daftarkan/setujui domain. Tanpa ini cookie `SameSite=Strict` tidak bisa bekerja antara `vercel.app` dan host realtime (`DOMAIN_COOKIES.md`). DEC-082 tetap OPEN sampai disetujui. |
| 2 | Hosting realtime persisten (Railway) | ⛔ | Buat service dari repo, ikuti `REALTIME_HOSTING.md` (config sudah ada: `railway.json`). |
| 3 | Vercel project `apps/web` | ⚠️ | Root Directory `apps/web`, "Include source files outside Root Directory" ON; set env (`VERCEL.md`). URL placeholder `realtime.longroll.invalid` **harus diganti** — build produksi kini gagal bila tidak. |
| 4 | Neon production branch + migrasi 0001–0007 | ⛔ | Belum disentuh (hanya `development`). Terapkan `db/migrations` dengan role owner; buat role `longroll_app` (DML saja) dan pakai DSN-nya untuk service. |
| 5 | Object storage privat + kredensial | ⛔ | Lihat §3. |
| 6 | TURN | ⛔ | Lihat §4. |
| 7 | Google OAuth Client ID | ⛔ | Lihat §5 (opsional; tanpa ini tombol Drive nonaktif, Unduh tetap jalan). |

## 2. Neon
- ✅ Dev: migrasi 0001–0007, role `longroll_app` least-privilege (tanpa CREATE/superuser), `saveRoom` kini satu statement atomik
  (tervalidasi terhadap Neon dev: 6 file integrasi + beban 5 room: ack p95 189 → 31 ms dari mesin dengan RTT 20 ms).
- ⚠️ Pooler: gunakan endpoint `-pooler` dan `DATABASE_POOL_MAX=5` pada Free. Cold start ≤ ~10 dtk ditangani (retry koneksi + warm-up boot).
- ⛔ Latensi dari region produksi belum diukur (jalankan `npm run latency:db -w @longroll/realtime` dari host realtime; harapan ≈ RTT×1).
- ⚠️ Retensi/hapus: tombstone kode 24 jam disimpan (tanpa data pribadi). Backup/PITR Neon di luar kendali aplikasi — jangan klaim penghapusan dari cadangan penyedia (DEC-075).

## 3. Object storage (Neon Object Storage, S3-compatible)
Status: bucket privat `longroll-dev` sudah ada di branch `development`. **Adaptor S3 belum pernah diuji terhadap bucket nyata** karena
membuat kredensial lewat tool otomatis menampilkan rahasia di log (kredensial P09 sudah dicabut dan tidak boleh dipakai ulang), dan
menulisnya ke `.env` otomatis tidak diizinkan. Langkah manual (±5 menit), lengkap di `infra/storage/README.md`:
1. Neon Console → project LONGROLL → branch `development` → Storage → buat kredensial `storage:write` (salin sekali).
2. Tempel ke `apps/realtime/.env`: `S3_ENDPOINT`, `S3_REGION=ap-southeast-1`, `S3_BUCKET=longroll-dev`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE=true`.
3. `put-bucket-cors` dari `infra/storage/cors.json` dengan origin web yang sebenarnya.
4. `LONGROLL_TEST_S3=1 node --env-file=.env ../../node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts test/integration/s3.storage.test.ts` (dari `apps/realtime`) — baru setelah ini boleh dikatakan "S3 lulus".
5. Produksi: bucket + kredensial terpisah pada branch produksi; set `NEXT_PUBLIC_STORAGE_ORIGIN` di Vercel.

Sudah ada di adaptor/server (teruji secara terisolasi dengan storage lokal/memori, bukan S3 nyata): URL PUT/GET bertanda tangan
berumur pendek yang terikat key/content-type/ukuran; validasi format+dimensi+ukuran; **EXIF/XMP/ICC dibuang** (re-encode sharp);
varian capture (full/preview/edit); frame custom; PUT lokal sekali pakai; cleanup per prefix room + verifikasi kosong + retry
(60 s/5 m/15 m/1 j); sweeper objek yatim harian; timeout & retry S3 SDK.
Batas penyedia (jangan diklaim lain): lifecycle bucket Neon **disimpan tapi tidak dijalankan**; `DeleteObject` = soft delete pada
branch (bukan penghapusan fisik segera); enkripsi at-rest tidak bisa diverifikasi lewat API (`GetBucketEncryption` 501).

## 4. WebRTC / TURN
- ✅ Kode: mesh 4 peserta, ICE restart (disconnected 3 dtk), rebuild PC, `replaceTrack` ganti kamera, deteksi visibilitychange,
  izin kamera ditolak (SCR-04 + "Masuk tanpa kamera"), mikrofon tidak pernah diminta. Diuji di browser dengan kamera palsu
  (`webrtc.spec.ts`, `fullflow.spec.ts`).
- ✅ Konfigurasi provider-netral: `STUN_URLS` (bawaan `stun.l.google.com`), `TURN_URLS` + `TURN_SHARED_SECRET` (REST "use-auth-secret",
  kredensial berumur `TURN_TTL_SECONDS`, `GET /api/rooms/:code/turn-credentials` hanya untuk peserta sah). Acuan: `infra/turn/`.
- ⛔ **Belum ada TURN.** Tanpa relay, peserta di balik NAT ketat/CGNAT/jaringan korporat tidak akan terhubung. NAT traversal ketat **belum
  diverifikasi**. Pilihan: coturn di VPS (butuh 3478/udp+tcp, 5349/tls, rentang relay) atau penyedia TURN terkelola. Tidak dibuat otomatis (biaya).
- Setelah TURN ada: uji `iceTransportPolicy` relay-only dari dua jaringan berbeda dan ukur `rtc_relay_ratio` sebelum rilis.

## 5. Google Drive (opsional, P08)
Kode: Google Identity Services *token model*, scope **hanya** `https://www.googleapis.com/auth/drive.file` (akses hanya file yang dibuat
LONGROLL), token di memori tab (tidak dikirim ke server LONGROLL, tidak disimpan), tanpa client secret, tanpa registrasi LONGROLL,
consent per pengguna, penanganan ditolak/popup diblokir/kedaluwarsa/kuota/jaringan + retry. CSP membuka `accounts.google.com` &
`www.googleapis.com` hanya bila `NEXT_PUBLIC_GOOGLE_CLIENT_ID` terisi. **Belum pernah dijalankan terhadap Google** (tidak ada client ID).
Setup (manual, saya tidak membuat proyek Google Cloud):
1. console.cloud.google.com → proyek baru → *APIs & Services → Library → Google Drive API → Enable*.
2. *OAuth consent screen*: External, nama app, support email, scope **hanya** `…/auth/drive.file`, tambahkan test users selama status Testing.
3. *Credentials → Create credentials → OAuth client ID → Web application*. **Authorized JavaScript origins**: `https://app.<domain>` dan `http://localhost:3000`. Tanpa redirect URI, tanpa secret.
4. Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` di Vercel (dan lokal bila perlu) → redeploy web.
5. Uji manual: Unduh dulu, lalu Simpan ke Drive → consent → file di folder "LONGROLL" → "Putuskan Google Drive".
`drive.file` termasuk scope non-sensitif; verifikasi aplikasi biasanya tidak diwajibkan (cek di Consent screen saat publish).

## 6. Keputusan produk (tidak disetujui otomatis)
| DEC | Perilaku saat ini | Catatan |
|---|---|---|
| 052 umur maks. room | **Tanpa batas** (`ROOM_MAX_LIFETIME_HOURS` kosong) | Tetap OPEN |
| 056 analitik | **Mati**, tidak ada kode analitik | Perlu persetujuan eksplisit sebelum menambah apa pun |
| 061 binding mode | Bawaan reversibel per mode dipertahankan | Tidak diubah |
| 073 TURN | Provider dapat dikonfigurasi | Pilihan penyedia OPEN |
| 075 enkripsi at-rest | Tidak diklaim | Tidak terverifikasi |
| 082 cookie/domain | Topologi valid = satu registrable domain, cookie host-only | Domain butuh persetujuan |

## 7. Verifikasi publik (WAJIB sebelum menyebut "berfungsi")
1. `node infra/deployment/smoke.mjs https://app.<domain> https://rt.<domain>` → semua LULUS.
2. Browser nyata (Chrome desktop + Safari iOS + Chrome Android), 4 peserta, jaringan berbeda: buat room → gabung → kamera → vote →
   studio → capture multi-shot → Ulang/Pakai → editor → unduh PNG → galeri → sesi baru → keluar → room bubar.
3. Cek data: setelah bubar, `lr_rooms` kosong dan prefix `rooms/<id>/` kosong di bucket (hapus-lunak penyedia dicatat).
4. Restart service Railway di tengah sesi → klien pulih ≤ 10 dtk.
5. Dua jaringan dengan NAT ketat → TURN relay (setelah TURN ada).
6. Pasang alarm/pager untuk `alarm.*` (`ops/RUNBOOK.md`); catat rencana rollback (Vercel promote, Railway redeploy sebelumnya).
7. Estimasi biaya per 1.000 sesi dari data uji (NFR-10) — belum dibuat.

## 8. Tes otomatis yang harus hijau sebelum rilis
`npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration -w @longroll/realtime` (dengan `LONGROLL_TEST_DATABASE_URL`
untuk file Neon), `NEXT_PUBLIC_REALTIME_URL=… npm run build -w @longroll/web`, Playwright P10 (`apps/web`, `HANDOFF_P10.md` §2 dan
`HANDOFF_ONLINE_READINESS.md`).
