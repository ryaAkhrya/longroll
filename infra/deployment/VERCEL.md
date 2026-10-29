# Vercel — `apps/web`

Hanya frontend Next.js 16 (`apps/web`) yang berjalan di Vercel. Service realtime **tidak** bisa di Vercel (butuh proses persisten
dengan WebSocket; lihat `REALTIME_HOSTING.md`).

## Pengaturan project
| Setting | Nilai |
|---|---|
| Framework Preset | Next.js |
| **Root Directory** | `apps/web` |
| **Include source files outside of the Root Directory** | **ON** (wajib: `@longroll/shared` ada di `packages/shared`) |
| Install Command | bawaan (Vercel mendeteksi npm workspaces dan menginstal dari root memakai `package-lock.json`) |
| Build Command | bawaan (`next build`) |
| Node.js | 22.x (`engines.node >= 22.9`) |

Build memakai `apps/web/tsconfig.json` yang **tidak** menyertakan `e2e/` dan config Playwright; tes E2E dicek terpisah oleh
`npm run typecheck` (`tsconfig.e2e.json`). Dengan begitu dependensi tes (`ws`, Playwright) tidak diperlukan saat build produksi
(kegagalan build 9c2988e).

## Environment Variables (Production)
| Nama | Nilai | Catatan |
|---|---|---|
| `NEXT_PUBLIC_REALTIME_URL` | `https://rt.<domain>` | **Wajib.** Origin murni, `https://`, bukan placeholder/localhost. Di-bake ke bundel DAN dibaca `proxy.ts` untuk CSP → ubah = redeploy. |
| `NEXT_PUBLIC_STORAGE_ORIGIN` | origin endpoint S3 (mis. `https://<endpoint-neon-storage>`) | CSP `img-src`/`connect-src` untuk URL bertanda tangan. Kosong = storage lokal via realtime (tidak untuk produksi). |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | OAuth Client ID Web (publik) | Opsional. Kosong = tombol Drive nonaktif. Lihat `PRODUCTION_CHECKLIST.md` §Google Drive. |

Jangan taruh rahasia di variabel `NEXT_PUBLIC_*` (terlihat publik). Web tidak memerlukan rahasia apa pun.

**Placeholder gagal-cepat.** Saat `VERCEL_ENV=production`, `next build` **gagal** bila `NEXT_PUBLIC_REALTIME_URL` kosong, placeholder
(`*.invalid`, `*.example`, `*.test`), `localhost`, bukan `https://`, atau berisi path (`apps/web/src/security/deploy-check.ts`,
dipanggil dari `next.config.ts`). Pada Preview/lokal hanya peringatan. Artinya URL `https://realtime.longroll.invalid` yang kini
terpasang akan menggagalkan build produksi berikutnya sampai diganti — itu disengaja.

## Perilaku yang perlu diketahui
- **Semua halaman dirender dinamis** (CSP bernonce per request lewat `proxy.ts` + `await headers()` di layout). Tidak ada halaman
  statis ter-cache di CDN; ini harga CSP tanpa `unsafe-inline` (`15 §6`).
- Header keamanan dari `next.config.ts` (HSTS, X-Frame-Options, Permissions-Policy `camera=(self)`) + CSP dari `proxy.ts`.
- `/dev/components` dijawab 404 di produksi (rewrite di `proxy.ts`).
- Preview deployment (`*.vercel.app`) **tidak akan bisa membuat room** terhadap realtime produksi: origin-nya tidak ada di
  `ALLOWED_ORIGINS` (allowlist eksak, tanpa wildcard) dan lintas-site (`DOMAIN_COOKIES.md`).
- Domain: tambahkan `app.<domain>` di *Settings → Domains*; ikuti instruksi DNS Vercel.

## Verifikasi
- Lokal sebelum push: `NEXT_PUBLIC_REALTIME_URL=https://rt.<domain> npm run build -w @longroll/web` (simulasi: tambahkan `VERCEL_ENV=production`).
- Setelah deploy: `node infra/deployment/smoke.mjs https://app.<domain> https://rt.<domain>`.
- Rollback: *Deployments → Promote to Production* pada deployment sebelumnya. `protocolVersion` klien lama diterima/ditolak
  realtime dengan `4426 UPGRADE_REQUIRED`; deploy realtime dulu bila protokol berubah.
