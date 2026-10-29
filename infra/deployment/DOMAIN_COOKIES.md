# Domain, cookie, CORS, WebSocket (DEC-082)

Status keputusan: **DEC-082 tetap OPEN secara formal.** Dokumen ini menetapkan topologi yang *secara teknis valid*; domain
sebenarnya harus disetujui/dibeli pemilik produk. Tidak ada keamanan yang dilonggarkan untuk membuat URL bawaan hosting berfungsi.

## Masalah dengan URL bawaan

Cookie kredensial LONGROLL: `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age` (`apps/realtime/src/http/util.ts`), dipasang oleh
service realtime dan dikirim browser pada `fetch(..., { credentials: "include" })` serta pada upgrade WebSocket dari halaman web.
`SameSite=Strict` hanya mengirim cookie bila halaman web dan service realtime berada di **site yang sama** (registrable domain
yang sama, eTLD+1).

| Web | Realtime | Site sama? | Hasil |
|---|---|---|---|
| `longroll.vercel.app` | `*.up.railway.app` | **Tidak.** `vercel.app` dan `railway.app` adalah public suffix (PSL); tiap subdomain = site sendiri | Cookie tidak pernah terkirim → `POST /session`, WebSocket → 401. Room bisa dibuat tetapi tidak pernah tersambung |
| `app.<domain>` | `rt.<domain>` | **Ya** | Berfungsi, cookie host-only milik `rt.<domain>` |

Service realtime **menolak start di produksi** bila topologinya begini (`apps/realtime/src/deployCheck.ts`, diuji di
`deployCheck.test.ts`): web dan realtime harus satu site, semua origin `https://`, `PUBLIC_WS_URL` `wss://…/ws`,
`COOKIE_SECURE` tidak boleh `false`. Pesan galatnya menunjuk ke dokumen ini. Heuristik site memakai daftar sufiks hosting umum +
ccTLD dua-label; **verifikasi domain sebenarnya terhadap Public Suffix List** sebelum rilis.

## Opsi yang valid

### A. Domain kustom bersama — DIREKOMENDASIKAN
- `app.<domain>` → Vercel (CNAME `cname.vercel-dns.com` atau A record sesuai instruksi Vercel).
- `rt.<domain>` → service realtime (Railway: *Settings → Networking → Custom Domain*, buat CNAME sesuai target yang ditampilkan).
- TLS otomatis di kedua sisi. Wajib HTTPS/WSS.
- Cookie **host-only** (biarkan `COOKIE_DOMAIN` kosong): hanya `rt.<domain>` yang menerima cookie, subdomain lain tidak. Jangan
  isi `COOKIE_DOMAIN` kecuali ada alasan kuat; bila diisi service mencatat peringatan dan memvalidasi bahwa itu induk host realtime
  dan bukan public suffix.
- Env (nilai contoh; `<domain>` = domain yang disetujui):
  - Web (Vercel): `NEXT_PUBLIC_REALTIME_URL=https://rt.<domain>`
  - Realtime: `ALLOWED_ORIGINS=https://app.<domain>`, `PUBLIC_WS_URL=wss://rt.<domain>/ws`, `PUBLIC_HTTP_URL=https://rt.<domain>`,
    `TRUST_PROXY=1`, `COOKIE_SECURE` dibiarkan kosong (default true).
- Biaya: hanya registrasi domain (±US$10–15/tahun). **Tidak dibeli oleh agen** — tindakan manual pemilik produk.

### B. Gateway same-origin (satu origin untuk web + API + WS)
Browser hanya bicara ke `https://<domain>`; gateway mengarahkan `/api/*` dan `/ws` ke realtime dan sisanya ke Vercel.
- Cookie jadi first-party tanpa perlu dua subdomain.
- **Rewrite HTTP biasa di Vercel TIDAK boleh diasumsikan mendukung proxy WebSocket persisten** (Vercel Functions tidak menahan
  koneksi WebSocket; rewrite eksternal hanya terbukti untuk HTTP). Belum ada bukti teknis di repo ini, jadi opsi ini tidak dipakai.
- Bila ingin B, gateway harus komponen sendiri yang memang meneruskan header `Upgrade` (Caddy/Nginx/Cloudflare dengan WebSockets
  aktif) di depan keduanya. Tetap membutuhkan domain kustom, jadi tidak lebih murah dari A dan menambah titik kegagalan.

### Yang DITOLAK
- `SameSite=None`, cookie tanpa `Secure`, atau fallback token di `localStorage`/`sessionStorage`: melemahkan perlindungan CSRF/XSS
  (TH-03). Tidak ada kode fallback seperti itu di aplikasi dan tidak akan ditambahkan.
- `ALLOWED_ORIGINS=*` / mencerminkan Origin apa pun dengan credentials: allowlist eksak saja.
- Preview deployment Vercel (`*-git-*.vercel.app`) sebagai klien produksi: origin-nya tidak ada di allowlist dan lintas-site.
  Tes preview harus memakai realtime terpisah (lokal) atau domain preview yang juga satu site.

## Header & CSP yang terkait
- CSP web (nonce + `strict-dynamic`) menambahkan origin realtime ke `connect-src`/`img-src` dari `NEXT_PUBLIC_REALTIME_URL` (dibaca
  `proxy.ts` saat request) dan `wss://` yang diturunkan darinya. Ganti URL realtime = redeploy web (nilai juga di-bake ke bundel).
- `NEXT_PUBLIC_STORAGE_ORIGIN` = origin endpoint S3 (untuk `img-src`/`connect-src` URL bertanda tangan).
- HSTS web memakai `includeSubDomains`: pastikan *semua* subdomain domain itu melayani HTTPS sebelum mengaktifkan di domain utama.
- Realtime menambahkan `Vary: Origin` pada semua respons `/api` (mencegah respons gambar dari `<img>` dipakai ulang untuk `fetch` CORS).

## Verifikasi setelah deploy
1. `node infra/deployment/smoke.mjs https://app.<domain> https://rt.<domain>` — memeriksa HTTPS, satu site, CSP, preflight CORS,
   origin asing ditolak, atribut cookie (HttpOnly/Secure/SameSite=Strict/host-only), `wsUrl` `wss://`, upgrade WS (tanpa cookie
   ditolak, Origin asing ditolak, Origin sah + cookie → 101). Membuat satu room uji dan langsung keluar.
2. Di browser: DevTools → Application → Cookies: cookie ada di `rt.<domain>`, HttpOnly, Secure, SameSite=Strict.
3. Alur 4 peserta nyata (lihat `PRODUCTION_CHECKLIST.md`).
