### Handoff P10-A (QA akhir & regresi browser) → sisa P10

Tanggal uji: 2026-10-29. Lingkungan: Windows 10, Node 22, Chrome 156 (channel), Firefox & WebKit bawaan Playwright 1.64 (WebKit 27.2), **build produksi** web (`next build` + `next start`, CSP nonce nyata, tanpa `unsafe-eval`) + service realtime lokal. Kamera = perangkat PALSU (`--use-fake-device-for-media-stream` / pref Firefox), bukan kamera nyata. Neon: project `hidden-glade-82216110`, branch `development` saja; `production` tidak disentuh. Tidak ada rahasia, DSN, atau token di dokumen ini.

## 1. Keamanan kredensial (P0)

| Pemeriksaan | Hasil |
|---|---|
| Kredensial storage yang tampil di output tool pada P09 (`longroll-dev-storage`, scope `storage:write`, branch development) | `list_credentials` → **`revoked_at` terisi (2026-10-28T23:20:03Z)**. Sudah dicabut 34 detik setelah dibuat. |
| Kredensial customer aktif di branch `development` | **Tidak ada.** Dua kredensial "Default …" milik branch lain (dibuat Neon saat project dibuat) tidak disentuh. |
| Penyebutan kredensial di repo | `grep` pola `nak_/nsk_` + ID kredensial: hanya satu fixture tes (`guard.test.ts`) yang memuat ID kredensial nyata (sudah dicabut). **Diganti nilai palsu** (`nak_live_0000…`). Tes tetap lulus. |
| `.env` | `apps/realtime/.env` hanya berisi `DATABASE_URL` dan `LONGROLL_TEST_DATABASE_URL`; tidak ada `S3_*`. Tidak dipakai ulang, tidak dicetak. |

**Status: tidak SECURITY BLOCKED.** Tindakan manual yang tersisa (jika ingin tetap ekstra hati-hati): tidak ada. Catatan: rahasia itu pernah tampil di transkrip sesi P09; karena sudah dicabut, nilainya tak berguna lagi. Jangan membuat kredensial baru lewat tool yang menampilkan rahasia di chat; buat lewat Neon Console dan tempel hanya ke `.env` (lihat `infra/storage/README.md`).

## 2. Cara menjalankan (semua dari `apps/web`)

```
# sekali: NEXT_PUBLIC_REALTIME_URL=http://localhost:4000 npm run build -w @longroll/web
npx playwright test -c playwright.p10.config.ts --project=chromium-desktop --project=chromium-mobile
npx playwright test -c playwright.p10.config.ts --project=firefox-desktop
P10_WEBKIT=1 npx playwright test -c playwright.p10.config.ts --project=webkit-desktop   # lihat §6 (2 flag khusus WebKit)
P10_LEGACY=1 npx playwright test -c playwright.p10.config.ts --project=chromium-desktop voting regression studio
P10_NEON=1 …                  # store = Neon development (hanya bila DB dipastikan kosong; lihat §8)
P10_SELF_REALTIME=1 … restart # spec restart: proses realtime dikelola spec, Neon development
```
Default: store & storage memori (hermetik). `playwright.config.ts` lama (server dev) tetap ada untuk spec yang butuh hook dev (`__lrMedia`, kursor lobby).

## 3. Hasil browser E2E

| Suite | Chromium desktop | Chromium mobile (390×844, touch) | Firefox | WebKit |
|---|---|---|---|---|
| `fullflow` — **satu alur 4 peserta P02→P08** (§4) | LULUS (run akhir + 3 run sebelumnya setelah perbaikan B-01; 78–105 dtk) | LULUS (75–98 dtk) | LULUS (2,6 mnt, kamera palsu) | tidak dijalankan (WebKit Windows tak punya kamera palsu) |
| `security` (CSP, header, injeksi, cookie, CORS, WS Origin, otorisasi, enumerasi, storage palsu) | LULUS | LULUS | LULUS | LULUS |
| `landing` (5 viewport 320–1920, routing, axe, reduced motion, keyboard) | LULUS | LULUS (keyboard dilewati) | LULUS | LULUS (keyboard dilewati: Safari tak Tab ke tautan secara default) |
| `crossbrowser` (3 peserta tanpa kamera, presence, reload, keluar) | LULUS | LULUS (setelah tes diperbaiki: menu mobile) | LULUS | LULUS ×3 berulang; **1 dari 5 eksekusi gagal** (klik "Masuk tanpa kamera" tak pernah "stable" 20 dtk), tak terulang |
| `restart` (kill -9 realtime saat VOTING & STUDIO, Neon dev) | LULUS (§7) | — | — | — |
| Spec lama P01–P05 pada build produksi (`voting`, `regression`, `studio` ×2) | 4 LULUS | — | — | — |
| `camera`, `room` (butuh hook dev) pada server dev | 2 LULUS | — | — | — |

Total otomatis terakhir: Chromium 46 lulus + 3 dilewati (+1 perbaikan tes → lulus), Firefox 24 lulus, WebKit 21 lulus + 1 dilewati (+3 ulangan `crossbrowser` lulus), legacy 4 lulus.

**Tidak stabil / tidak terselesaikan (jujur):**
- `studio.spec` "4 peserta" pada **server dev** gagal 2× di langkah berbeda (toast "Nadia pasang Film 400"; pratinjau awal), timeout 5 dtk. Pada build produksi lulus 2× (+1 di run akhir). Dugaan: kompilasi on-demand `next dev`; penyebab pasti tidak dibuktikan.
- `packages/shared` `editor.test.ts` TC-EDIT-020 (fuzz berbenih tetap) gagal **sekali** pada satu `npm test`; 7 eksekusi berikutnya (3 file, 3 suite penuh, 1 `npm test` penuh) lulus. Pesan galat tidak tertangkap. Kemungkinan batas waktu di bawah beban; tidak direproduksi.
- WebKit `crossbrowser` 1 dari 5 (di atas).

## 4. Alur penuh 4 peserta (`e2e/p10/fullflow.spec.ts`) — yang dibuktikan

Bikin room → 3 gabung (lobby "4 dari 4") → 3 feed WebRTC remote per klien (media palsu) dan **tanpa `audio` di `getUserMedia`** → vote (Photo Grid) → studio → Frame Scrapbook "Pasang buat semua" tersinkron → capture shot 1 (C menekan, semua klien masuk review) → **Ulang/Pakai independen**: A, B, C menerima, D memilih Ulang; status A/B/C tetap `ACCEPTED`, D mengambil take ke-2 dan baru bisa "Pakai ini" setelah foto siap (tidak ada auto-accept dalam alur ini) → editor kolaboratif: stiker A+B bersamaan (4 klien konvergen ke jumlah elemen sama), Undo A hanya membatalkan miliknya, **reload C** dan **offline→online D** memulihkan state → "Selesai" → layar hasil: pratinjau termuat (`naturalWidth>0`) → **Unduh: file PNG sah (magic `89504E47…`, >20 KB, nama `.png`)** → galeri: 1 kartu sesi, semua gambar termuat → Sesi baru: peserta lain menerima SCR-19 dan **status peserta lain tampil lintas-klien** ("Ikut" untuk Nadia & Raka di layar Sasa) — menutup isu P08 → semua keluar → grace → **room bubar (SCR-21), data terhapus** (memori dan Neon dev).

Setiap peserta diawasi: **nol pelanggaran CSP** (event `securitypolicyviolation` + pesan konsol) dan **nol error konsol/halaman** selain probe 401 yang dirancang (`POST /session` sebelum punya cookie, hanya endpoint itu).

Yang **tidak** dibuktikan di sini: hash file antar-retake (TC-CAP-010 penuh), peserta diam ≥10 menit (TC-CAP-015), skew capture (TC-CAP-001), pengambilan beberapa shot (Photo Grid = 1 shot), mode lain selain Photo Grid, ekspor Drive, frame custom di alur ini (frame upload diuji spec lama `studio`).

## 5. Bug ditemukan & diperbaiki

| ID | Tingkat | Temuan | Perbaikan | Tes regresi |
|---|---|---|---|---|
| B-01 | **Kritis** | Masuk editor crash di **semua browser** ("Ada yang error"): `Cannot read properties of undefined (reading 'style.bgColor')`. Dokumen editor menyimpan `meta.layout` tanpa `fieldVersions`, `buildScene` membacanya. Bug sejak P07; lolos tes unit karena tes memakai `StudioState` lengkap. | `render/model.ts`: `parseLayoutJson` (default `fieldVersions: {}`), dipakai juga `editor/useEditor.ts`; `shared/editor/doc.ts` kini menyimpan `fieldVersions` saat seed. Dokumen lama tetap terbaca. | `render/__tests__/model.test.ts` (2) + alur penuh |
| B-02 | Tinggi (mobile) | Tombol **Tutup**/Escape/geser-bawah pada sheet "Alat" tidak menutup (`open(null)` menimpa `setToolsOpen(false)` dengan nilai lama `true`). | `StudioContainer.tsx`: urutan `open(null)` lalu `setToolsOpen(false)`. | alur penuh mobile |
| B-03 | Sedang | `/dev/components` di build produksi menjawab **200** (halaman not-found tapi status 200, karena `notFound()` terlambat setelah shell `loading.tsx`). | `proxy.ts`: di produksi, `/dev*` di-rewrite ke route tak ada sebelum streaming → 404 sungguhan. | `security.spec` + `csp.test.ts` (+2) |
| B-04 | Sedang (WCAG AA) | axe: kontras banner galat 4,31:1; stepper tahap berikutnya 2,16:1 (terang) / 3,23:1 (stage); nama tombol kode room tidak memuat teks yang terlihat; tombol timer mobile (`5s` vs "Timer 5 detik"). | Token baru `--err-ink` (#A82F2E, 5,4:1; ditandai PROPOSED seperti koreksi kontras lain); stepper memakai `--mute-text` bukan `opacity .45`; spasi di pill kode; label `Timer 5s, ketuk untuk ganti`. **Perubahan visual kecil, bukan redesain** — perlu persetujuan reviewer visual (TC-UX-011). | axe di 11 layar |
| B-05 | Rendah | Fixture tes memuat ID kredensial nyata (sudah dicabut). | Diganti nilai palsu. | `guard.test.ts` |
| T-01 | Tes | Spec lama mobile mencari "Timer N detik"; helper `createRoom/joinRoom` rentan terhadap teks yang diisi sebelum hidrasi (WebKit: value-tracker React). | Regex diperbarui; helper kosongkan lalu isi ulang sampai tombol aktif. | — |

Risiko kecil yang dicatat, tidak diubah: di Safari/WebKit teks nama yang diketik **sebelum hidrasi** bisa tak tercatat React (tombol tetap nonaktif sampai ketikan berikutnya). Dalam praktik jendela hidrasi ~ratusan ms.

## 6. CSP (TC-SEC-020/021) — diverifikasi di browser

- Header produksi tiap dokumen (`/`, `/r/ABCDEF`, 404): `script-src 'self' 'nonce-…' 'strict-dynamic'` tanpa `unsafe-inline`/`unsafe-eval`; `style-src` elemen bernonce (hanya `style-src-attr 'unsafe-inline'` untuk prop `style` React — risiko diterima P09); `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`; `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, HSTS. **Setiap `<script>` di HTML membawa nonce yang sama dengan header; nonce berbeda tiap request.**
- Browser nyata (Chromium, Firefox, WebKit): hidrasi & interaksi bekerja; WebRTC, Konva/kanvas editor, unggah foto capture (blob/img), unggah frame custom (spec lama), pratinjau/unduh hasil: **0 pelanggaran** (Chromium desktop+mobile dan Firefox pada alur penuh).
- Penegakan terbukti: handler inline lewat `innerHTML` tidak jalan; `eval` dan `new Function` → `EvalError`; `javascript:` URL tidak jalan; pelanggaran `script-src` tercatat.
- **Catatan desain:** `'strict-dynamic'` sengaja mengizinkan `<script>` yang dibuat lewat DOM oleh skrip tepercaya (itu sebabnya GIS bisa dimuat). Penjaga utamanya adalah tidak adanya sink HTML mentah: `grep` `dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|document.write` di `src` = nol. Trusted Types tidak dipasang (di luar scope).
- Worker: tidak ada `new Worker` di kode (komponen `PreviewWorker` hanya nama). Tidak perlu `worker-src`.
- **Tidak diverifikasi:** jalur Google Identity Services (CSP `googleEnabled` hanya aktif bila `NEXT_PUBLIC_GOOGLE_CLIENT_ID` diset; tidak ada client ID).
- Dua koreksi lingkungan lokal (bukan celah produksi): WebKit meng-upgrade subresource `http://localhost` ke https akibat `upgrade-insecure-requests` → flag baru `CSP_UPGRADE_INSECURE_REQUESTS=false` (default tetap menyala di produksi; hanya run WebKit lokal yang mematikan); WebKit menolak cookie `Secure` di http://localhost → `COOKIE_SECURE=false` hanya untuk run WebKit. Atribut `Secure` diperiksa pada Chromium/Firefox dan pada header `Set-Cookie`.

Regresi keamanan di browser/HTTP: header + nonce; katalog dev 404; XSS nama (ditolak UI **dan** API 400, tak dieksekusi); cookie `HttpOnly; SameSite=Strict; Path=/; Max-Age; Secure`, token tak ada di storage/URL/DOM/body; CORS (Origin asing 403, preflight asing tanpa ACAO, origin sah dengan credentials); WS upgrade dengan Origin asing / tanpa cookie ditolak; `session/leave/attempt url/frames` tanpa kredensial ditolak; `GET /preview` kode tak ada = kode lain (tidak membocorkan perbedaan); URL storage palsu GET/PUT ditolak; `/health` tanpa rahasia. `npm audit`: **0 kerentanan**.

## 7. Reliabilitas & performa (terukur, bukan mock)

**Latensi tulis Neon (p95 189 ms pada P09) — penyebab ditemukan.** `npm run latency:db -w @longroll/realtime` (satu koneksi, ~160 statement kecil pada baris probe di `lr_rate_limits`, dihapus lagi; hasil verifikasi: 0 baris probe tersisa), dari mesin dev → Neon `aws-ap-southeast-1`:

| Pengukuran (n=40) | p50 | p95 |
|---|---|---|
| `SELECT 1` (RTT jaringan) | 20,3 ms | 21,5 ms |
| 1 tulis durable (autocommit) | 21,0 ms | 21,6 ms |
| Transaksi 5 round-trip (pola `saveRoom`: BEGIN + 3 statement + COMMIT) | **101,9 ms** | 104,0 ms |
| Pekerjaan yang sama dalam 1 statement (CTE) | 21,9 ms | 25,6 ms |

Kesimpulan: **latensi didominasi (jumlah round-trip × jarak jaringan)**; commit durable ≈ +0 ms dan eksekusi SQL ≈ 0. `db.transaction()` mengirim BEGIN, tiap statement, dan COMMIT secara berurutan; satu `saveRoom` biasanya 6–9 round-trip → 120–190 ms pada RTT 20 ms (cocok dengan p95 189 ms). Dengan service di region yang sama dengan Neon (RTT ~1–3 ms) perkiraan 10–30 ms — **belum diukur dari region produksi** (NOT VERIFIED). Tidak saya ubah: menulis ulang jalur persistensi menjadi satu statement per simpan memberi ≈5× lebih cepat tetapi menyentuh seluruh P02–P08; direkomendasikan sebagai pekerjaan terpisah **hanya bila** pengukuran in-region masih > 150 ms. Wajib: tempatkan service realtime di `ap-southeast-1`.

**Restart (browser nyata + Neon dev, kill -9 pohon proses):** saat VOTING (2 dari 3 sudah memilih): proses naik 2,3 dtk, klien pulih dengan suara utuh **2,3 dtk** setelah proses naik (target ≤ 10 dtk); saat STUDIO (frame Scrapbook terpasang): pulih **2,5 dtk**, frame utuh di semua klien. Room kemudian diakhiri lewat UI dan **terbukti bubar** (grace 40 dtk) tanpa sisa di Neon (`lr_rooms/participants/sessions/editor_docs/events` = 0; 15 tombstone kode = perilaku normal 24 jam).

**Beban:** hanya alur 4 peserta di atas (memori dan 1× Neon, 1.9 mnt, store=postgres). Tidak ada uji beban tambahan di Neon Free (sesuai batas). Hasil beban P09 (100 room × 4 koneksi, in-process) tetap berlaku sebagai indikatif.

Tidak diuji di sini: kegagalan storage di browser (dicakup tes integrasi P09: retry/verifikasi cleanup), pool exhaustion (P09), skew capture, fps ponsel, TURN.

## 8. Storage

- Bucket privat `longroll-dev` (branch development) ada; `list_storage_buckets` mengonfirmasi `access_level: private`. Tidak ada kredensial aktif → **S3 nyata = BLOCKED** (dan seluruh `s3.storage.test.ts` = 2 tes dilewati). Tidak ada pengganti memori yang diklaim siap produksi.
- Diuji terisolasi: adaptor memori/FS, signer lokal (PUT sekali pakai), cleanup + verifikasi + sweeper (tes P09 lulus ulang), unggah/unduh foto & frame lewat storage lokal di browser (alur penuh).
- Langkah manual untuk membuka blokir: `infra/storage/README.md` (kredensial `storage:write` dari Neon Console → `apps/realtime/.env` → `put-bucket-cors` → `LONGROLL_TEST_S3=1 … s3.storage.test.ts`). Lifecycle bucket Neon **tidak dijalankan** oleh penyedia (sweeper harian = satu-satunya backstop); `DeleteObject` = soft delete; enkripsi at-rest tidak bisa diverifikasi.

## 9. Room `QEZWVM` — update penting

`QEZWVM` **sudah tidak ada** di Neon dev. Bukan karena perintah hapus dari saya, tetapi efek samping: saat saya menjalankan E2E dengan store Neon (`P10_NEON=1`, grace 6 dtk), service memanggil `recover()`, memulihkan 1 room lama (id `01a185f1-…`, kosong) dan **siklus hidup normal aplikasi** membuatnya kedaluwarsa dan dibersihkan (`cleanup.done`, 0 objek). Itu hampir pasti `QEZWVM` (satu-satunya room di DB; semua tabel kosong sesudahnya). Karena sidik jarinya cocok dengan data uji saya sendiri (peserta "Nadia", sesi VOTING, nol objek), saya menilainya data uji sekali pakai — tetapi **asal-usulnya tak pernah dibuktikan** dan saya seharusnya mencegahnya (kegagalan kehati-hatian saya). Dicatat di memori proyek agar tidak terulang: jangan menyalakan service/`recover()` terhadap Neon dev bila ada room yang harus dipertahankan.

## 10. Aksesibilitas

- **TC-A11Y-001 (axe-core 4.14, WCAG 2.0/2.1 A+AA, serious/critical):** 0 pelanggaran di **landing, bikin room, kode tak ada, 404** dan di alur penuh pada **lobby, voting, studio, review, editor, hasil, galeri** — Chromium desktop dan mobile. (Awalnya 4 jenis pelanggaran serious; lihat B-04.) Minor/moderate tidak ditinjau. axe-core dipakai dari `node_modules` (dependensi transitif; belum dideklarasikan di `package.json`).
- **TC-A11Y-004:** `prefers-reduced-motion` → tidak ada animasi tak terbatas yang berjalan di landing (LULUS). Layar lain belum.
- **TC-A11Y-002 (keyboard-only seluruh alur):** hanya Tab→CTA→Enter di landing (Chromium/Firefox). Alur penuh dengan keyboard **NOT RUN**.
- **TC-A11Y-003 (VoiceOver/TalkBack):** NOT RUN (perangkat).

## 11. Sisa pemblokir rilis / NOT VERIFIED

1. Perangkat nyata K1–K4 (iOS Safari, Android Chrome), kamera nyata, izin kamera iOS, fps, skew capture, getUserMedia di WebKit.
2. TURN nyata (TC-SEC-019, `rtc_relay_ratio`, NAT ketat, Wi-Fi↔seluler).
3. Google OAuth/Drive live (tanpa client ID); jalur CSP GIS.
4. S3/Neon Object Storage nyata (§8); TC-SEC-032 (lifecycle) tidak tersedia di penyedia.
5. Latensi tulis Neon dari region produksi (§7); staging/produksi + domain cookie (DEC-082) + HTTPS (`Secure`/`SameSite=Strict` lintas `app.`/`rt.`).
6. TC-CAP-010 (hash file), TC-CAP-015 (diam ≥10 mnt), TC-GAL-005/006 lewat UI, mode selain Photo Grid, multi-shot, ZIP (ditunda), TC-UX-010/011 (usability & persetujuan visual — termasuk perubahan kontras B-04), TC-PERF-020/022, TC-A11Y-002/003.
7. Keputusan produk terbuka: DEC-052, DEC-056, DEC-073, DEC-075 (lihat HANDOFF_P09 §6); pager `alarm.*`; dashboard metrik; rencana rollback & estimasi biaya per 1.000 sesi (butir 9–10 scope P10) belum dibuat.
8. Uji lintas-browser lengkap: WebKit tanpa media/capture/editor (tak ada kamera palsu); Firefox penuh dengan kamera palsu; Edge tidak diuji.
9. Satu tes sempat gagal tak terduga (§3: shared fuzz ×1, WebKit crossbrowser ×1, studio dev ×2) — belum ada akar masalah terbukti.

## 12. File baru/diubah (P10-A)

- Tes/konfigurasi: `apps/web/playwright.p10.config.ts`, `apps/web/e2e/p10/{kit,fullflow,security,landing,crossbrowser,restart}.spec|ts`, `apps/web/e2e/helpers.ts` (hidrasi-tahan), `apps/web/e2e/studio.spec.ts` (label timer), `apps/web/src/render/__tests__/model.test.ts`, `apps/web/src/security/__tests__/csp.test.ts` (+3), `apps/realtime/scripts/db-latency.ts` + skrip `latency:db`, `guard.test.ts` (fixture).
- Perbaikan: `apps/web/src/render/model.ts`, `editor/useEditor.ts`, `packages/shared/src/editor/doc.ts`, `studio/StudioContainer.tsx`, `proxy.ts`, `security/csp.ts`, `styles/tokens.css`, `ui/Banner.module.css`, `session/SessionStepper.module.css`, `layout/CopyCodeButton.tsx`.
- Docs: `README.md` (status), `HANDOFF_P10.md`.
- Neon: **tidak ada migrasi**; 0001–0007 utuh; role `longroll_app` tidak diubah. Perintah git read-only (`log`, `diff --stat`, `status`) sempat saya jalankan untuk melihat riwayat — tidak ada commit/push/perubahan.

## 13. Gate akhir (setelah semua perubahan)

Typecheck 0 error · Lint 0 masalah · Unit: realtime 139, web 97, shared 99 (semua lulus) · Integrasi: 57 lulus + 2 dilewati (S3 nyata), 12 file lulus, 6 di antaranya Neon dev · Build produksi lulus · `npm audit` 0.
