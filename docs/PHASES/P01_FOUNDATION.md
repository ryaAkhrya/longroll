# P01 — Foundation & Design System

| Atribut | Nilai |
|---|---|
| Dokumen | `PHASES/P01_FOUNDATION.md` |
| Versi | 1.1.0 |
| Status fase | NOT STARTED |
| Bergantung pada | — (fase pertama) |
| Dokumen wajib dibaca | [05_DESIGN_SYSTEM.md](../05_DESIGN_SYSTEM.md), [06_RESPONSIVE_MOBILE_UX.md](../06_RESPONSIVE_MOBILE_UX.md), [04_SCREEN_SPECIFICATIONS.md](../04_SCREEN_SPECIFICATIONS.md) §0 & SCR-01/02/03/05/21, [13_SYSTEM_ARCHITECTURE.md](../13_SYSTEM_ARCHITECTURE.md) §3 & §15, [00_README.md](../00_README.md) §4 |

> **Perubahan v1.1:** scope P01 diperkecil. P01 **tidak** lagi membangun shell statis untuk 22 layar. Fokusnya fondasi reusable, landing, navigasi, komponen inti, dan layout desktop/mobile yang dibutuhkan P02. Komponen & layar lain dibangun di fase pemilik fiturnya (§5).

## 1. Identitas & tujuan fase

P01 menyiapkan fondasi teknis dan visual LONGROLL: repositori, stack yang direkomendasikan, token desain, tipografi & brand, **komponen inti**, kerangka layout responsif (tema `light` dan `stage`), routing dasar, dan landing (SCR-01). Hasilnya adalah milestone **M0 — Fondasi**: landing sesuai `02_Desktop/01_Landing.webp` dan `03_Mobile/01_Landing.webp`, plus kerangka layout yang siap diisi logika room di P02.

P01 **tidak** membangun logika aplikasi (room, kamera, voting, capture) dan tidak membuat layar yang belum dibutuhkan P02.

## 2. Prasyarat & dependensi

| Prasyarat | Status yang dibutuhkan |
|---|---|
| Persetujuan stack frontend (DEC-038) | RECOMMENDED; agen boleh memulai dengan rekomendasi, catat di handoff bahwa masih PENDING |
| Keputusan Tailwind (DEC-078) | Pilih di awal fase; token tetap dari CSS custom properties |
| File font OFL (DEC-014) | Bricolage Grotesque (variable), Figtree (variable), Instrument Serif (Regular + Italic) untuk self-host |
| Visual Baseline V1 (DEC-011) | 17 gambar tersedia untuk perbandingan |

Tidak ada dependensi fase sebelumnya.

## 3. Kondisi awal yang diharapkan

- Repositori kosong atau belum ada kode aplikasi LONGROLL.
- Jika repositori sudah berisi kode: **periksa dulu**, jangan menimpa tanpa inspeksi, catat temuan di handoff.

## 4. Requirement dalam scope

1. **Token & tema**: warna, tipografi, spasi, radius, bayangan (05 §2–§4) termasuk koreksi kontras PROPOSED `--mute-text` & `--warn`. Tema `light` dan `stage` (REQ-UI-03) sebagai mekanisme (`[data-theme]`), belum sebagai layar stage lengkap.
2. **Brand**: LogoMark & Wordmark sebagai komponen SVG (05 §1, Lampiran A).
3. **Komponen inti** (dipakai SCR-01 dan layar P02): Button (semua varian & ukuran kecuali shutter), Input, CodeInput, Chip, Tag, Card, Banner, Toast (+ region notifikasi), Modal, BottomSheet (dasar: snap `half`/`full`, fokus), Avatar, AvatarStack, Spinner/Skeleton.
4. **Kerangka layout**: `AppShell` (light/stage), header room desktop (tanpa stepper) & header room mobile (04 §0.2), container responsif + breakpoint (06 §2), safe area (06 §5), `100dvh`.
5. **Routing dasar**: `/` (landing) dan `/r/[code]` (kerangka aplikasi room yang di P02 diisi alur create/join/lobby).
6. **Landing SCR-01** lengkap (statis), desktop & mobile.
7. **Layout statis minimum untuk P02**: kerangka form SCR-02/SCR-03, kerangka lobby SCR-05 (grid 4 slot dengan kartu kosong/avatar, panel undangan) dan SCR-21. Ini layout + komponen, **bukan** shell untuk layar lain.
8. **Fondasi aksesibilitas**: `lang="id"`, fokus terlihat, `prefers-reduced-motion`, struktur heading, region toast `aria-live`.
9. **Kontrol keamanan P01** (15 §14): header keamanan dasar, CSP awal, larangan `dangerouslySetInnerHTML` untuk data pengguna.
10. **Kerangka realtime service** (Node.js + TypeScript) dengan `GET /api/health` saja.

## 5. Di luar scope (eksplisit)

| Tidak dikerjakan di P01 | Dibangun di |
|---|---|
| Logika create/join, token, WebSocket, presence, `RemoteCursor` | P02 |
| Kamera, WebRTC, `CameraTile` dengan state kamera, layar SCR-04 | P03 |
| Tema stage lengkap, grid booth SCR-08 dasar, MobileDock, Toggle, Slider, panel SCR-12 Kameraku | P03 |
| Segmented, SessionStepper, voting SCR-06/07/19 | P04 |
| ToolRail, panel SCR-09..11, frame engine & BindingPlan di SCR-08 | P05 |
| Shutter, SCR-13..15 | P06 |
| Editor SCR-16 | P07 |
| SCR-17/18, export, Drive | P08 |
| SCR-20 overlay (dasar di P02/P03), SCR-22 varian lanjutan | Fase pemilik fitur |
| Redis/object storage nyata (cukup `.env.example`) | P02 |
| Katalog komponen yang mencakup komponen fase lain | — |
| Sistem akun dalam bentuk apa pun (DEC-094 REJECTED) | — |
| Deploy produksi | P10 |

Aturan: komponen dibuat **saat pertama kali dibutuhkan** oleh layar di fasenya, dengan mengikuti spesifikasi 05. Hindari abstraksi spekulatif.

## 6. ID requirement terkait

REQ-UI-01, REQ-UI-02, REQ-UI-03 (mekanisme tema), REQ-MOB-01, REQ-MOB-02, REQ-MOB-09, NFR-04, NFR-05. Keputusan: DEC-011, DEC-014, DEC-038, DEC-050, DEC-058, DEC-078.

## 7. Referensi dokumentasi

- [05_DESIGN_SYSTEM.md](../05_DESIGN_SYSTEM.md): token & spesifikasi komponen.
- [06_RESPONSIVE_MOBILE_UX.md](../06_RESPONSIVE_MOBILE_UX.md): breakpoint, safe area, sheet, target sentuh.
- [04_SCREEN_SPECIFICATIONS.md](../04_SCREEN_SPECIFICATIONS.md): SCR-01, SCR-02, SCR-03, SCR-05, SCR-21, chrome room §0.2.
- [13_SYSTEM_ARCHITECTURE.md](../13_SYSTEM_ARCHITECTURE.md) §3, §14, §15 (MVP vs skala).
- [15_SECURITY_PRIVACY_LIFECYCLE.md](../15_SECURITY_PRIVACY_LIFECYCLE.md) §6.
- [18_DECISIONS_AND_OPEN_QUESTIONS.md](../18_DECISIONS_AND_OPEN_QUESTIONS.md).

## 8. Referensi visual yang disetujui

| Referensi | Dipakai untuk |
|---|---|
| `01_Design_System/Brand_Identity.webp` | Logo, warna, tipografi, komponen inti |
| `02_Desktop/01_Landing.webp`, `03_Mobile/01_Landing.webp` | Landing (harus cocok) |
| `02_Desktop/02_Lobby.webp`, `03_Mobile/02_Lobby.webp` | Kerangka lobby (grid & panel undangan) |

SCR-02, SCR-03, dan SCR-21 berstatus `DERIVED` (04 §0). Tampilannya diturunkan dari design system dan harus direview sebelum P02 ditutup.

## 9. Tugas implementasi fungsional

1. **Landing SCR-01**: nav, hero (booth window contoh + strip miring), section Frame (6 gaya statis), Cara kerja (4 kartu), CTA penutup tema stage, footer.
2. **Input kode di landing**: menormalkan huruf besar dan memfilter karakter di luar alfabet DEC-022 (validasi UI saja; tombol Gabung belum memanggil API).
3. **Copy landing akurat** (15 §11): "Room sementara: foto dan datanya dihapus setelah room kedaluwarsa." Dilarang memakai copy DEC-093.
4. **Kerangka `/r/[code]`**: menampilkan layout SCR-02/03/05/21 dengan data contoh lewat parameter dev (misal `?preview=lobby`, hanya aktif di dev).
5. **Halaman katalog** (PROPOSED: `/dev/components`, hanya dev): menampilkan **komponen inti P01** saja, di tema light & stage, desktop & mobile.

## 10. Tugas implementasi teknis

| Tugas | Detail (PROPOSED) |
|---|---|
| Monorepo | `apps/web` (Next.js App Router + TS), `apps/realtime` (Node.js + TS), `packages/shared` (tipe & konstanta bersama, termasuk safeguard DEC-042/DEC-043 sebagai konfigurasi terpusat, bukan angka yang tersebar) |
| Token | `apps/web/src/styles/tokens.css` berisi custom properties 05 §16; tema stage via `[data-theme="stage"]` |
| Font | Self-host di `apps/web/public/fonts/`, `@font-face` dengan `font-display: swap`; preload Bricolage & Figtree; Instrument Serif lazy |
| Komponen | `components/ui/*` (komponen inti §4.3), `components/brand/*` (LogoMark, Wordmark), `components/layout/*` (AppShell, RoomHeader, MobileRoomHeader, Container) |
| Ikon | Lucide dengan `strokeWidth={1.75}` (05 §14) |
| Konfigurasi | `.env.example` berisi nama variabel 13 §10 tanpa nilai rahasia |
| Header keamanan | Di `next.config` / middleware: CSP awal (15 §6), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()` (mikrofon dinonaktifkan selama DEC-076 OPEN) |
| Realtime skeleton | `apps/realtime`: server HTTP + `GET /api/health` → `{ ok: true }`; belum ada WebSocket |
| Tes | Vitest untuk komponen; Playwright untuk screenshot landing; axe-core |

## 11. Dependensi data model & event

Tidak ada event. Tipe statis contoh boleh mengikuti bentuk `RoomView`/`ParticipantView` dari [14_DATA_MODEL_AND_EVENTS.md](../14_DATA_MODEL_AND_EVENTS.md) §2–§3 agar layout lobby bisa langsung dipakai di P02. Konstanta `PlayerColor` (P1..P4) dan token warna pemain diambil dari 05 §2.3.

## 12. Requirement UI/UX

- Nilai V1 dipakai persis (05 §0). Penyimpangan hanya untuk koreksi aksesibilitas PROPOSED (05 §2.5) dan dicatat di handoff.
- Satu tombol primary Plum per layar (05 §5).
- Warna pemain tidak dipakai untuk tombol aksi (05 §2.3).
- State interaksi PROPOSED (hover, active, focus-visible, disabled, loading) diimplementasikan di semua tombol.
- Motion token 05 §13, dengan varian reduced-motion.

## 13. Pertimbangan desktop & mobile

- Landing dan kerangka layout P02 dikerjakan **bersamaan** di 390 px dan 1280 px; cek juga `xs` < 360 dan `md` tablet (06 §2).
- Viewport meta dengan `viewport-fit=cover`; padding safe area di header, sheet, dan CTA bawah (06 §5).
- Target sentuh ≥ 44×44 pada `pointer: coarse` (06 §4).
- BottomSheet dasar dengan perilaku fokus 06 §6.
- Input font ≥ 16 px.

## 14. Pertimbangan keamanan & privasi

- CSP awal dan header keamanan aktif sejak P01 (15 §14).
- Tidak ada `dangerouslySetInnerHTML` untuk data pengguna; tambahkan aturan lint yang melarangnya.
- Gambar contoh di landing: aset berlisensi jelas atau ilustrasi netral, bukan foto orang tanpa izin (catatan penyimpangan SCR-01 di 04).
- Tidak ada analitik (DEC-056 masih OPEN).

## 15. Checklist tugas detail

- [ ] Inisialisasi monorepo & struktur folder (PROPOSED §10); catat versi Node/pnpm.
- [ ] Putuskan Tailwind ya/tidak (DEC-078) dan catat.
- [ ] Self-host 3 keluarga font + uji `font-stretch: 75%` Bricolage di Chrome, Safari, Firefox.
- [ ] `tokens.css` lengkap (05 §16) + mekanisme tema stage.
- [ ] LogoMark (geometri Lampiran A) & Wordmark (lockup 05 §1.1).
- [ ] Komponen inti §4.3 + state interaksi.
- [ ] AppShell, RoomHeader desktop, MobileRoomHeader.
- [ ] Landing SCR-01 desktop & mobile.
- [ ] Kerangka layout SCR-02/03/05/21 (data contoh, mode dev).
- [ ] Katalog komponen inti (dev).
- [ ] Header keamanan & CSP awal.
- [ ] Realtime service skeleton + health check.
- [ ] Tes komponen, screenshot landing, axe-core.
- [ ] Isi handoff §24.

## 16. Checkpoint integrasi

- `apps/web` dan `apps/realtime` bisa dijalankan bersamaan secara lokal; web membaca URL realtime dari env.
- Paket `shared` bisa diimpor dari kedua app.
- Persiapan IC-1 (P02): kerangka lobby & store klien (14 §3) siap diisi data nyata.

## 17. Edge case

- Font gagal dimuat → fallback `system-ui` tanpa layout rusak (cek tinggi baris display condensed).
- Browser tanpa dukungan `font-stretch` variable → judul tetap terbaca.
- Lebar 320 px → tidak ada scroll horizontal.
- Zoom browser 200% → konten tetap bisa diakses (06 §13).
- Landscape HP pada landing → tetap 1 kolom (06 §11).

## 18. Skenario kegagalan

| Kegagalan | Perilaku yang diharapkan |
|---|---|
| File font 404 | Fallback font, tidak ada FOIT berkepanjangan |
| Gambar contoh gagal dimuat | Ruang gambar tetap, tidak ada layout shift |
| Realtime service mati | Landing tetap jalan (P01 belum bergantung pada realtime) |
| CSP memblokir aset sendiri | Terdeteksi di console saat review; perbaiki sebelum DoD |

## 19. Acceptance criteria

| # | Kriteria | Verifikasi |
|---|---|---|
| AC-1 | Landing desktop & mobile disetujui reviewer terhadap V1 | TC-UX-011 (bagian landing) |
| AC-2 | 0 pelanggaran axe serious/critical di landing & katalog | TC-A11Y-001 |
| AC-3 | Kontras teks kecil ≥ 4.5:1 memakai `--mute-text` | TC-A11Y-001 + cek manual 05 §2.5 |
| AC-4 | Kontrol interaktif ≥ 44×44 di `pointer: coarse` | TC-MOB-003 |
| AC-5 | `prefers-reduced-motion` mematikan animasi non-esensial | TC-A11Y-004 |
| AC-6 | Header keamanan & CSP terpasang | TC-SEC-021 |
| AC-7 | JS awal landing ≤ 200 KB gzip (target, diukur) | TC-PERF-010 |
| AC-8 | Tidak ada scroll horizontal di 320/390/1280 px | Screenshot Playwright |
| AC-9 | Kerangka lobby SCR-05 memakai komponen inti tanpa komponen dari fase lain | Review kode |

## 20. Checklist pengujian

- [ ] Unit komponen (Vitest): Button, CodeInput (normalisasi & filter), BottomSheet (fokus), Toast (aria-live).
- [ ] Screenshot Playwright landing 390 & 1280.
- [ ] axe-core landing + katalog (light & stage).
- [ ] Cek manual safe area di satu iPhone ber-notch (D).
- [ ] Lighthouse landing (emulasi 4G).

Perintah verifikasi yang disarankan (**dijalankan oleh pengguna atau atas izin eksplisit**, 00 §4.1): `pnpm install`, `pnpm --filter web dev`, `pnpm test`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm lint`. Agen **tidak** menjalankan typecheck/lint/build penuh atau operasi Git tanpa instruksi, dan **tidak** commit/push/deploy otomatis. Hasil tes tidak boleh dikarang.

## 21. Definition of Done

- Semua checklist §15 tercentang dengan bukti (path file/komponen).
- AC-1..AC-9 terverifikasi; tes yang belum dijalankan tercatat di handoff.
- Tidak ada logika aplikasi atau komponen fase lain (§5).
- Tidak ada aset contoh tanpa lisensi jelas.
- Handoff §24 diisi dan disetujui reviewer → M0 tercapai.

## 22. Deliverable

- Monorepo dengan `apps/web`, `apps/realtime`, `packages/shared`.
- `tokens.css`, font self-host, komponen inti, brand, dan layout.
- Landing SCR-01; kerangka layout SCR-02/03/05/21.
- Katalog komponen inti (dev).
- Header keamanan & CSP awal.
- `.env.example`, README pengembangan singkat.

## 23. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Rendering `font-stretch` berbeda antar browser | Uji di Chrome, Safari, Firefox; dokumentasikan perbedaan |
| Komponen diabstraksikan terlalu dini | Hanya komponen inti §4.3; sisanya dibuat di fase pemiliknya |
| CSP terlalu ketat untuk Next.js (inline script) | Pakai nonce/hash, catat konfigurasi di handoff |
| Layout DERIVED dianggap sudah disetujui | Tandai "DERIVED — belum disetujui visual" di mode dev |

## 24. Handoff ke fase berikutnya

Template (isi semua bagian; tulis "tidak ada" jika kosong):

```markdown
### Handoff P01 → P02
- Status fase: READY FOR REVIEW / DONE
- Pekerjaan selesai: …
- Komponen/file yang diubah atau dibuat: …
- Keputusan teknis (sertakan status DEC: PROPOSED/CONFIRMED): DEC-038 …, DEC-078 …
- Tes yang dijalankan (ID, tanggal, lingkungan, hasil + bukti): …
- Tes yang BELUM dijalankan dan alasannya: …
- Masalah yang diketahui: …
- Risiko yang masih terbuka: …
- Penyimpangan dari V1 (dengan alasan): …
- Kesiapan untuk P02 (ya/tidak + syarat): …
```
