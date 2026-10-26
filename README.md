# LONGROLL

Photobooth online multiplayer (maks. 4 orang). Dokumentasi produk: [docs/00_README.md](docs/00_README.md).
Status: **P01 — Foundation & Design System** (belum diverifikasi; lihat bagian Verifikasi).

## Struktur

| Path | Isi |
|---|---|
| `apps/web` | Next.js (App Router) + TypeScript. Token, komponen, landing, kerangka `/r/[code]` |
| `apps/realtime` | Node.js + TypeScript. Hanya `GET /api/health` (belum ada WebSocket/Redis) |
| `packages/shared` | Konstanta & tipe bersama (alfabet kode room, batas teknis, warna pemain) |

## Menjalankan (lokal)

Memakai **npm workspaces** (pnpm belum terpasang di mesin pengembangan; mudah dipindah ke pnpm).

```bash
npm install
npm run dev            # web  → http://localhost:3000
npm run dev:realtime   # realtime → http://localhost:4000/api/health
```

Salin `.env.example` ke `apps/web/.env.local` dan `apps/realtime/.env` bila perlu. Tidak ada rahasia di P01.

Rute: `/` landing · `/r/new` kerangka SCR-02 · `/r/KODE` kerangka SCR-03 · `/dev/components` katalog (dev saja).
Pratinjau layout dengan data contoh (dev saja): `/r/BUBA27?preview=lobby|join|create|expired`.

## Keputusan teknis P01

- **DEC-038** Next.js + TS + React: PROPOSED/RECOMMENDED (belum disetujui).
- **DEC-078** Tailwind: **tidak dipakai**. Token = CSS custom properties (`apps/web/src/styles/tokens.css`) + CSS Modules.
- **DEC-014** Font OFL di-self-host di `apps/web/public/fonts` (lisensi disertakan). `font-stretch: 75%` Bricolage perlu diuji di Chrome/Safari/Firefox.
- CSP awal di `apps/web/next.config.ts` memakai `'unsafe-inline'` untuk skrip; upgrade ke nonce/hash dicatat sebagai risiko terbuka.

## Skrip

`npm test` (Vitest), `npm run typecheck`, `npm run lint`. Jalankan sendiri; belum dijalankan oleh agen.
