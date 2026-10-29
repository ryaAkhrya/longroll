# Service realtime — hosting persisten (Railway)

`apps/realtime`: Node 22, HTTP + WebSocket (`ws`), server-authoritative per room (DEC-088). **Satu instance** — jangan skala
horizontal (state aktif room ada di memori proses; Neon menyimpan snapshot untuk pemulihan restart). Railway dipilih karena
mendukung proses long-running dan WebSocket native; penyedia lain yang menjalankan Node persisten + WSS juga cocok.

**Belum dideploy.** Dokumen ini + `railway.json` menyiapkan konfigurasi; deploy menunggu akun/otorisasi pemilik.

## Config-as-code
`railway.json` (root repo):
- `startCommand`: `npm run start -w @longroll/realtime` → `tsx --env-file-if-exists=.env src/index.ts` (`tsx` kini `dependency`,
  bukan devDependency, supaya tersedia pada instalasi produksi).
- `healthcheckPath`: `/api/health` (`{ ok, store, storeOk }`, tidak memerlukan Origin/cookie), `healthcheckTimeout` 60 dtk
  (cold start Neon ≤ ~10 dtk).
- `restartPolicyType: ON_FAILURE`, maks. 10 percobaan.
- Root Directory service = **root repo** (bukan `apps/realtime`) agar workspace `@longroll/shared` ter-resolve.

## Yang sudah benar di kode
- `PORT` dari penyedia dibaca (`PORT`, bawaan 4000); bind bawaan Node dual-stack (`::`, IPv4+IPv6). `HOST` opsional bila perlu.
- SIGTERM/SIGINT → `shutdown()`: berhenti menerima koneksi, tulis snapshot editor yang belum tersimpan, tutup pool; batas keras 10 dtk.
  Set di Railway `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=15` agar SIGKILL tidak datang sebelum 10 dtk itu.
- `unhandledRejection`/`uncaughtException` → shutdown rapi lalu restart oleh Railway; room dipulihkan dari Neon (`recover()`).
- **Guard produksi saat start** (`deployCheck.ts`): menolak start bila origin bukan https, `PUBLIC_WS_URL` bukan `wss://…/ws`,
  `COOKIE_SECURE=false`, host placeholder, web & realtime beda site (DEC-082), `S3_ENDPOINT` bukan https, `TURN_URLS` tanpa secret.
  Juga menolak start tanpa `DATABASE_URL` dan tanpa S3 (kecuali `ALLOW_MEMORY_STORE`, tidak disarankan).
- Service **tidak pernah menjalankan migrasi**; ia hanya memeriksa `lr_schema_migrations` dan berhenti bila skema belum ada.
- Rate limit per IP memakai `X-Forwarded-For` hanya dari proxy tepercaya: `TRUST_PROXY=1` (satu proxy: edge Railway; entri
  paling kanan = IP klien). Tanpa itu semua klien berbagi satu batas.
- WebSocket: upgrade `/ws?code=…` memeriksa cookie + Origin allowlist + rate limit; Railway meneruskan `Upgrade` apa adanya.

## Variabel lingkungan (Railway → Variables; JANGAN di-commit)
| Nama | Nilai | Wajib |
|---|---|---|
| `NODE_ENV` | `production` | ya |
| `ALLOWED_ORIGINS` | `https://app.<domain>` | ya |
| `PUBLIC_WS_URL` | `wss://rt.<domain>/ws` | ya |
| `PUBLIC_HTTP_URL` | `https://rt.<domain>` | ya (diturunkan dari WS bila kosong) |
| `TRUST_PROXY` | `1` | ya |
| `DATABASE_URL` | connection string Neon role **`longroll_app`** (pooled, `sslmode=verify-full`) | ya |
| `DATABASE_POOL_MAX` | `5` (Neon Free) | tidak |
| `S3_ENDPOINT` `S3_REGION` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` `S3_FORCE_PATH_STYLE` | lihat `infra/storage/README.md` | ya |
| `STORAGE_SIGNING_SECRET` | acak panjang (HMAC URL lokal; tak dipakai bila S3) | tidak |
| `RATE_LIMIT_SALT` | acak panjang | disarankan |
| `STUN_URLS` `TURN_URLS` `TURN_SHARED_SECRET` `TURN_TTL_SECONDS` | lihat `infra/turn/README.md` | TURN: ya untuk NAT ketat |
| `ROOM_GRACE_PERIOD_SECONDS` / `PARTICIPANT_HOLD_SECONDS` | 120 / 60 (default) | tidak |
| `ROOM_MAX_LIFETIME_HOURS` | **kosong** (DEC-052 OPEN: tanpa batas) | tidak |
| `COOKIE_SECURE` / `COOKIE_DOMAIN` | **kosong** (Secure default; host-only) | tidak |

Rahasia hanya diset di dashboard Railway. Role runtime wajib `longroll_app` (DML saja, tanpa DDL) — kredensial owner tidak
pernah dipakai service.

## Wilayah & performa
Neon proyek ini di `aws-ap-southeast-1` (Singapura). Tempatkan service Railway di **Singapore (asia-southeast1)**. Pengukuran dari
mesin dev (RTT 20 ms): `saveRoom` sebelumnya 5–9 round-trip (p95 ack 189 ms) → kini **satu statement** (p95 ack 31 ms); dari
region yang sama diharapkan beberapa ms (belum diukur — NOT VERIFIED sampai ada deployment).

## Pemulihan & operasi
- Restart/deploy: klien tersambung ulang sendiri (backoff 0,5–8 dtk), state dari Neon. Terukur (browser nyata + Neon dev, kill -9):
  voting pulih 2,3 dtk, studio 2,5 dtk.
- **Saat boot `recover()` memuat room ACTIVE/GRACE/EXPIRING**; room kosong yang sudah lewat batas langsung dikedaluwarsakan dan
  datanya dihapus (perilaku normal). Jangan menyalakan service terhadap database yang berisi room yang harus dipertahankan.
- Alarm = baris log JSON `alarm.*` (`ops/RUNBOOK.md`). Belum ada pager/dashboard.
- Sweeper objek yatim berjalan harian (lifecycle bucket Neon tidak dijalankan penyedia).

## Langkah deploy (manual, setelah otorisasi)
1. Railway → New Project → Deploy from GitHub repo (`ryaAkhrya/longroll`), Root Directory = `/`. Region Singapore.
2. Isi Variables di atas. Set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=15`. Replicas = 1.
3. Terapkan migrasi 0001–0007 ke database yang dipakai (`db/README.md`) dengan role owner — bukan oleh service.
4. Settings → Networking → Custom Domain `rt.<domain>`; buat CNAME di DNS. Tunggu TLS.
5. Deploy → pastikan `GET https://rt.<domain>/api/health` → `{"ok":true,"store":"postgres","storeOk":true}`.
6. Jalankan `node infra/deployment/smoke.mjs https://app.<domain> https://rt.<domain>`.
