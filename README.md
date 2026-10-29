# LONGROLL

Photobooth online multiplayer (maks. 4 orang). Dokumentasi produk: [docs/00_README.md](docs/00_README.md).
Status: **P10-A — QA akhir & regresi browser** (Chromium desktop+mobile, Firefox, WebKit; build produksi). Alur 4 peserta P02→P08 lulus di Chromium/Firefox; perangkat nyata, TURN, OAuth Google, dan S3 nyata belum. Rincian: [HANDOFF_P10.md](HANDOFF_P10.md). **Kesiapan online & deployment:** [HANDOFF_ONLINE_READINESS.md](HANDOFF_ONLINE_READINESS.md), [infra/deployment/](infra/deployment/) (Vercel, realtime hosting, domain/cookie, checklist, `smoke.mjs`) — aplikasi publik belum berfungsi sampai domain kustom + service realtime tersedia. Handoff: [HANDOFF_P02.md](HANDOFF_P02.md), [HANDOFF_P02_NEON.md](HANDOFF_P02_NEON.md), [HANDOFF_P03.md](HANDOFF_P03.md), [HANDOFF_P04.md](HANDOFF_P04.md), [HANDOFF_P05.md](HANDOFF_P05.md), [HANDOFF_P06.md](HANDOFF_P06.md), [HANDOFF_P07.md](HANDOFF_P07.md), [HANDOFF_P08.md](HANDOFF_P08.md), [HANDOFF_P09.md](HANDOFF_P09.md) (runbook: [ops/RUNBOOK.md](ops/RUNBOOK.md)). Migrasi Neon `development`: 0001–0007.

## Struktur

| Path | Isi |
|---|---|
| `apps/web` | Next.js (App Router). Landing, `/r/[code]` (bikin/gabung/lobby/keluar/bubar), klien room di `src/room/` |
| `apps/realtime` | Node.js + `ws`. HTTP API room, gateway WebSocket, RoomActor, store PostgreSQL (Neon), cleanup |
| `db/` | Migrasi SQL (dijalankan MANUAL oleh pemilik database) & skrip pemeliharaan |
| `packages/shared` | Kontrak protokol, konfigurasi default, validasi nama & kode |

## Menjalankan lokal

```bash
npm install
npm run dev:realtime   # http://localhost:4000 (tanpa DATABASE_URL: store memori, dev saja)
npm run dev            # http://localhost:3000
```

Buka web lewat **http://localhost:3000** (bukan 127.0.0.1): cookie kredensial & `ALLOWED_ORIGINS` memakai host `localhost`.
Konfigurasi: lihat [.env.example](.env.example).

### PostgreSQL / Neon (pemilik database)

Service **tidak** menjalankan migrasi (skema diterapkan terpisah). Urutan manual ada di
[db/README.md](db/README.md). Setelah migrasi diterapkan: isi `DATABASE_URL` di `apps/realtime/.env`
lalu `npm run dev:realtime`. Bila skema belum ada, service berhenti dengan log `store.schema_missing`.

## Tes (jalankan sendiri / atas izin)

```bash
npm test                                         # unit (web, realtime, shared)
npm run test:integration -w @longroll/realtime   # HTTP + WS sungguhan, store memori
LONGROLL_TEST_DATABASE_URL=… npm run test:integration -w @longroll/realtime   # + adapter PostgreSQL (manual, DB uji)
npm run test:e2e -w @longroll/web                # Playwright, 4 konteks browser (Chrome terpasang)
npm run typecheck && npm run lint
```

## Topologi cookie (DEC-082)

Token peserta = cookie `lr_p_{roomId}` `HttpOnly; SameSite=Strict; Secure`, milik host realtime. Browser
hanya mengirimnya bila web dan realtime **satu site** (registrable domain sama, mis. `app.longroll.app` +
`rt.longroll.app`, atau `localhost:3000` + `localhost:4000`). Domain berbeda (mis. `*.vercel.app` + `*.fly.dev`)
membuat cookie jadi pihak ketiga dan diblokir → butuh keputusan arsitektur (bukan fallback diam-diam).
Fallback `sessionStorage` + pesan `auth` **tidak diaktifkan**.
