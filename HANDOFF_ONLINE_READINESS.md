# Handoff — Integrasi akhir & kesiapan online

Tanggal: 2026-10-29. **Status publik: BELUM berfungsi.** Frontend ada di `longroll.vercel.app`, tetapi service realtime **belum
ada** (variabel Vercel masih placeholder `realtime.longroll.invalid`) dan topologi domain/cookie belum bisa dipenuhi tanpa domain
kustom. Semua yang bisa diverifikasi tanpa infrastruktur eksternal sudah diverifikasi lokal; sisanya diblokir dengan alasan spesifik
di §6. Tidak ada deploy, push, atau perubahan production yang dilakukan. Tidak ada rahasia di dokumen ini.

Pembeda bukti yang dipakai di bawah: **[LOKAL]** browser nyata + server lokal · **[NEON-DEV]** database Neon `development` ·
**[PUBLIK]** deployment publik (tidak ada) · **[PERANGKAT/EKSTERNAL]** perangkat nyata/TURN/Google/S3 nyata (tidak ada).

## 1. Audit isu (dicek di kode saat ini)

| Isu | Klasifikasi | Tindakan / bukti |
|---|---|---|
| Vercel memakai `https://realtime.longroll.invalid` | CONFIGURATION ISSUE (hanya ada di env Vercel, bukan di repo) | Env harus diganti. Build produksi kini **gagal** bila placeholder/localhost/http (`deploy-check.ts`, diuji; terbukti gagal/lulus dengan `VERCEL_ENV=production`) |
| Cookie `SameSite=Strict` tidak terkirim `vercel.app` ↔ `*.railway.app` (public suffix, beda site) | CONFIGURATION/TOPOLOGI — butuh domain | Service menolak start di produksi bila web & realtime beda site (`deployCheck.ts`, 7 tes, terbukti exit 1). `DOMAIN_COOKIES.md` |
| Build Vercel gagal (spec e2e ikut dikompilasi, `ws` tak ada) | ALREADY FIXED (commit 0494898) | `tsconfig.e2e.json` terpisah; `typecheck` memeriksa keduanya |
| `tsx` hanya devDependency padahal dipakai `npm start` | CONFIRMED BUG (deploy) | Dipindah ke `dependencies` (lockfile diperbarui, `npm ci --dry-run` OK) |
| Respons storage yang di-cache dari `<img>` dipakai ulang `fetch` CORS → "Failed to fetch" | CONFIRMED BUG | `Vary: Origin` selalu pada `/api` (`applyCors`; `cors.test.ts`; ditemukan oleh tes byte-level) |
| Latensi tulis Neon p95 189 ms | CONFIRMED (round-trip) | `saveRoom` 5–9 round-trip → **1 statement atomik**; ack p95 189 → **31 ms** [NEON-DEV] |
| Tes tak stabil (fuzz `capture.test`, fuzz `editor.test`) | CONFIRMED penyebab: tes CPU-bound memakai 88% dari batas 5 dtk | Timeout eksplisit 60 dtk + alasan terukur di komentar (seed tetap, bukan acak) |
| Firefox `fullflow` gagal 3 dari 4 run saat `route()` aktif | Artefak harness: `route()` Playwright membuat `page.reload()` menggantung di Firefox | `route` hanya di Chromium; Firefox 3/3 lulus sesudahnya. Bukan cacat aplikasi |
| `studio.spec` gagal di server **dev** | UNEXPLAINED (dev-only) | Lulus pada build produksi di semua run (4 run, 2 tes per run). Penyebab pasti tidak dibuktikan |
| WebKit `crossbrowser` gagal 1 dari ±8 | UNEXPLAINED | Tidak terulang pada ≥ 6 eksekusi berikutnya |
| Bukti hash/byte retake independen | MISSING → ditambah | `multishot.spec` (§3) |
| Verifikasi 10 menit tanpa auto-accept | MISSING → ditambah, LULUS | `noauto.spec` [LOKAL] |
| Multi-shot E2E | MISSING → ditambah | Photo Strip 4 shot |
| Sheet "Alat" mobile tak bisa ditutup, kontras, nama aksesibel | ALREADY FIXED (P10-A) | Terjaga: alur mobile + axe lulus |
| Keyboard navigation | MISSING → ditambah, LULUS | `keyboard.spec` (TC-A11Y-002) |
| Screen reader (VoiceOver/TalkBack) | UNVERIFIED EXTERNAL | Perangkat |
| SCR-19 sinkron lintas-klien | ALREADY FIXED (P09) | Dibuktikan di browser (`fullflow`) |
| IDOR aset peserta lain | Tes ditambah | `security.spec` (kredensial A tak membuka apa pun di room B; leave A tak memengaruhi B) |
| Race capture/editor/gallery/cleanup | Tercakup tes P06–P09 (unit/integrasi, fuzz acak aksi 4 peserta) | Tidak ada stress-test baru; lihat §6 |
| S3 nyata, TURN, Google OAuth | UNVERIFIED EXTERNAL | §6 |
| DEC-052/056/061/073/075/082 | PRODUCT DECISION | Tidak disetujui otomatis (§5) |

## 2. Perubahan kode/konfigurasi
- **Deploy:** `railway.json`; `apps/realtime/package.json` (`tsx` → dependencies) + `package-lock.json`; `HOST` opsional; `.env.example`.
- **Guard produksi:** `apps/realtime/src/deployCheck.ts` (+test) dipanggil `index.ts`; `apps/web/src/security/deploy-check.ts` (+test) dipanggil `next.config.ts`.
- **Keamanan:** `Vary: Origin` selalu (`http/util.ts`, `cors.test.ts`). CSP nonce + `strict-dynamic` tidak berubah. Tidak ada fallback token di storage browser.
- **Neon:** `store/postgres.ts` — `saveRoom` memakai `buildSaveRoomSql` (CTE tunggal; CTE room = gerbang revisi → `StaleRevisionError` tetap; peserta/sesi/frame via `jsonb_populate_recordset` dengan `ON CONFLICT … WHERE room_id =` yang sama; event + pangkas; dedupe id). Tidak ada migrasi baru; 0001–0007 utuh; role `longroll_app` terverifikasi (bukan superuser, tanpa CREATE). `scripts/db-latency.ts`.
- **Tes:** `apps/web/e2e/p10/*` (fullflow, security, landing, crossbrowser, multishot, noauto, keyboard, webrtc, restart, kit), `playwright.p10.config.ts`, `tsconfig.e2e.json`.
- **Docs:** `infra/deployment/{VERCEL,REALTIME_HOSTING,DOMAIN_COOKIES,PRODUCTION_CHECKLIST}.md`, `infra/deployment/smoke.mjs`, README.

## 3. Hasil verifikasi

### Gate otomatis [LOKAL]/[NEON-DEV]
Typecheck 0 error (3 workspace + `tsconfig.e2e`) · Lint 0 · Unit: realtime 149, web 100, shared 99 · Integrasi 57 lulus + 2 dilewati (S3 nyata), 6 file Neon-dev lulus
termasuk satu-statement `saveRoom` & pemulihan restart · Build produksi lulus (+ simulasi `VERCEL_ENV=production`: placeholder gagal, https sah lulus) · `npm audit` 0.

### Browser E2E (build produksi, kamera palsu)
| Suite | Hasil |
|---|---|
| Chromium desktop + mobile (semua spec p10) | 53 lulus, 9 dilewati per-proyek (spec desktop-saja/gated) |
| `multishot` + `security` (run ulang setelah perubahan akhir) | 15 lulus |
| Spec lama P01–P05 pada build produksi | 4 lulus |
| Firefox (semua spec) | 24 lulus; `fullflow` 3/3 setelah perbaikan harness |
| WebKit (tanpa kamera) | 23 lulus, 1 dilewati |
| Alur penuh di Neon dev (store=postgres) | lulus, room bubar, DB kosong sesudahnya |
| Restart kill -9 saat VOTING & STUDIO (Neon dev) | lulus: proses naik 2,1 dtk, klien pulih **2,2 dtk** (voting) dan **2,4 dtk** (studio); setelah `saveRoom` satu-statement |
| TC-CAP-015 diam 10 menit | lulus: 11 pemeriksaan / 667 dtk, tidak ada auto-accept, semua tetap tersambung, keputusan manual tetap jalan |
| Keyboard-only (TC-A11Y-002) | lulus: landing → bikin room → kamera → vote (panah+Spasi) → shutter → Pakai → editor (Stiker) → selesai → unduh PNG; fokus terlihat di tiap berhenti |
| WebRTC: izin kamera ditolak, tab background/foreground, jaringan klien putus 8 dtk lalu pulih, reload | lulus (3 feed remote pulih tanpa error halaman) |

Delapan belas langkah alur yang diminta (§11 tugas) dicakup oleh `fullflow` + `multishot`: buka → bikin room → 4 peserta → kamera → vote
→ studio (frame/layout) → **4 shot** → Ulang/Pakai independen → foto yang diterima **identik byte** → edit kolaboratif (Yjs, undo)
→ reconnect satu klien → finalisasi → unduh PNG → galeri → sesi baru (SCR-19) → keluar → kedaluwarsa & cleanup.

**Bukti byte-level independensi retake** (`multishot.spec`, 4 browser dengan video kamera palsu y4m **deterministik berbeda** per peserta):
- foto Nadia/Raka/Sasa tidak berubah byte-nya, di layar pemilik maupun di layar tiga peserta lain, setelah Bimo mengulang;
- semua penonton melihat byte yang sama untuk foto yang sama; take lama Bimo tetap terlihat (ditandai diulang) dengan byte identik;
  take baru Bimo berbeda;
- galeri "Per orang" = **tepat** multiset foto yang diterima (16 foto); take yang diulang tidak ada;
- PNG hasil: dimensi = label ukuran (Asli 600×1776; Cetak 300 dpi 1200×3552 = 2× tepat; Story 1080×1920), signature PNG sah, **byte-identik
  antar-klien** (A vs C, 467 KB). Catatan kualitas: sumber foto kamera palsu 320×240; kualitas dengan kamera nyata tidak diverifikasi.

### Keamanan [LOKAL]
Header+nonce (semua `<script>` bernonce sama dengan header), eval/inline/`javascript:` diblokir, XSS nama ditolak UI+API, cookie
`HttpOnly; SameSite=Strict; Path=/; Max-Age; Secure; tanpa Domain`, token tak bocor ke body/storage/DOM, CORS allowlist eksak
(+`Vary`), WS Origin asing/tanpa cookie ditolak, IDOR antar-room, URL storage palsu, enumerasi seragam, `/dev/*` 404, health tanpa rahasia.
Server E2E memakai `TRUST_PROXY=1` dengan X-Forwarded-For unik per peserta (batas buat-room 10/jam/IP tetap utuh dan terbukti saat suite melampauinya).

### Aksesibilitas
axe-core (WCAG A/AA, serious/critical) 0 pelanggaran di 11 layar (desktop+mobile); reduced-motion di landing; keyboard-only alur penuh.
VoiceOver/TalkBack: **NOT RUN**. Minor/moderate axe tidak ditinjau.

## 4. Neon
- Round-trip: RTT 20 ms; transaksi 5 RT 102 ms vs 1 statement 22 ms. `saveRoom` kini 1 RT. Beban 5 room × 4 peserta, 20 dtk (dibatasi, aman Neon Free): relay p95 3 ms, **ack p95 31 ms (sebelumnya 189)**, 0 ack gagal, 0 putus.
- Konsistensi dipertahankan: gerbang revisi satu statement (revisi basi tidak menulis apa pun; tes unit + `postgres.concurrency` pada Neon), upsert tetap dibatasi `room_id`, event dedupe `ON CONFLICT DO NOTHING`, indeks unik warna aktif tetap menjaga ≤ 4 peserta.
- Dari region produksi belum diukur (jalankan `npm run latency:db -w @longroll/realtime` di host realtime). Production branch tidak disentuh; migrasi di production harus diterapkan manual.
- Efek samping yang perlu diingat: `recover()` saat boot menghapus room kosong yang sudah lewat batas (perilaku normal).

## 5. Keputusan produk (tidak disetujui otomatis)
DEC-052 tetap tanpa batas umur room; DEC-056 analitik tetap MATI; DEC-061 bawaan binding mode tidak diubah; DEC-073 TURN tetap dapat dikonfigurasi (belum ada penyedia); DEC-075 tidak ada klaim jaminan enkripsi/penghapusan fisik penyedia storage; DEC-082 hanya menentukan topologi yang valid — domain butuh persetujuan.

## 6. Blokir yang tersisa & tindakan manual tepat
1. **Domain kustom** (pemilik produk): daftarkan/setujui `<domain>`; `app.<domain>` → Vercel, `rt.<domain>` → Railway. Tanpa ini aplikasi publik tidak dapat berfungsi (cookie Strict lintas-site). Opsi gateway same-origin juga butuh domain; proxy WebSocket via rewrite Vercel **tidak** terbukti.
2. **Vercel env:** ganti `NEXT_PUBLIC_REALTIME_URL` ke `https://rt.<domain>` (+ `NEXT_PUBLIC_STORAGE_ORIGIN`), Root Directory `apps/web`, "Include source files outside Root Directory" ON, lalu redeploy.
3. **Railway** (otorisasi pemilik): buat service dari repo (root `/`), Singapore, 1 replika, isi variabel `REALTIME_HOSTING.md`, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=15`, custom domain `rt.<domain>`.
4. **Neon production:** terapkan migrasi 0001–0007 (role owner), buat role `longroll_app`, DSN pooled ke Railway.
5. **Object storage:** buat kredensial `storage:write` lewat Neon Console (bukan lewat chat/tool otomatis, supaya rahasia tidak tercetak), isi `S3_*`, atur CORS dari `infra/storage/cors.json`, jalankan `s3.storage.test.ts` (`LONGROLL_TEST_S3=1`). **S3 nyata = NOT VERIFIED**; saya sengaja tidak membuat kredensial karena output tool menampilkan rahasia.
6. **TURN:** sediakan penyedia/coturn (`infra/turn/`), set `TURN_URLS` + `TURN_SHARED_SECRET`. NAT ketat **NOT VERIFIED**; tanpa TURN, sebagian peserta tidak akan tersambung.
7. **Google Drive (opsional):** langkah Cloud Console di `PRODUCTION_CHECKLIST.md` §5; `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Drive nyata **NOT VERIFIED**.
8. Setelah 1–6: `node infra/deployment/smoke.mjs https://app.<domain> https://rt.<domain>` lalu alur 4 peserta di perangkat/jaringan nyata (Chrome desktop, Safari iOS, Chrome Android).
9. Belum ada: pager `alarm.*`, rencana rollback tertulis, estimasi biaya per 1.000 sesi, uji perangkat nyata (kamera, fps, skew), VoiceOver/TalkBack, uji beban dari region produksi.

## 7. Cara menjalankan ulang
Lihat `HANDOFF_P10.md` §2. Tambahan: `P10_LONG=1 … noauto` (11 mnt), `… keyboard`, `… multishot`, `… webrtc` (semua `--project=chromium-desktop`). Spec memakai `X-Forwarded-For` unik per peserta (Chromium) karena server E2E `TRUST_PROXY=1`.
