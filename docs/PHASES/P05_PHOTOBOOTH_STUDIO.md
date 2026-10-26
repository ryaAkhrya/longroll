# P05 — Photobooth Studio & Frame Engine

| Atribut | Nilai |
|---|---|
| Dokumen | `PHASES/P05_PHOTOBOOTH_STUDIO.md` |
| Versi | 1.1.0 |
| Status fase | NOT STARTED |
| Bergantung pada | P03 (feed live, grid booth SCR-08 dasar), P04 (mode terkunci, state `STUDIO`). DEC-061 tetap OPEN dan **tidak memblokir** fase ini (kedua strategi dibangun, DEC-087) |
| Dokumen wajib dibaca | [10_FRAMES_CANVAS_LAYOUT.md](../10_FRAMES_CANVAS_LAYOUT.md), [05_DESIGN_SYSTEM.md](../05_DESIGN_SYSTEM.md) §10–§12, [04_SCREEN_SPECIFICATIONS.md](../04_SCREEN_SPECIFICATIONS.md) (SCR-08..12), [09_CAMERA_CAPTURE_RETAKE.md](../09_CAMERA_CAPTURE_RETAKE.md) §4, [15_SECURITY_PRIVACY_LIFECYCLE.md](../15_SECURITY_PRIVACY_LIFECYCLE.md) §7, [18](../18_DECISIONS_AND_OPEN_QUESTIONS.md) DEC-042, DEC-061, DEC-087 |

---

## 1. Identitas & tujuan fase

P05 membangun **studio photobooth**: kanvas (Konva), mesin frame & layout, library frame bawaan, upload frame custom yang aman, dan state studio bersama. Hasil fase: setelah mode terkunci, semua peserta melihat feed live mereka ditempatkan di slot layout dengan frame aktif, bisa mengganti frame/layout bersama secara real-time, dan masing-masing bisa mengatur framing kameranya sendiri (Kameraku). Capture belum ada (P06).

## 2. Prasyarat & dependensi

| Prasyarat | Sumber |
|---|---|
| `MediaTransport` dengan track lokal & remote per peserta | P03 |
| `session.mode` terkunci, state `STUDIO` | P04 |
| Object storage + signed URL dasar | P02/P03 (13 §8) |
| DEC-061 (binding slot) | OPEN QUESTION milik pemilik produk. **Bukan prasyarat.** Fase membangun BindingPlan (DEC-087) yang mendukung strategi `PER_SHOT_GROUP` **dan** `PER_PARTICIPANT_SHOT` (+ `FREEFORM`). Agen **tidak** memilih strategi final; default sementara di konfigurasi dicatat sebagai sementara di handoff |
| DEC-042 safeguard | PROPOSED technical safeguards (shot 1–8, cell ≤ 32, grid ≤ 32 & sisi ≤ 8, output ≤ 8192 px). Jangan diturunkan tanpa persetujuan pemilik produk |
| DEC-039 (Konva) disetujui atau diganti | Pemilik produk / engineering lead |

## 3. Kondisi awal yang diharapkan

- Room dengan 4 feed live stabil (TC-RTC-001 lulus).
- Voting mengarahkan ke grid booth SCR-08 dasar dari P03 (feed live, belum ada frame/layout engine).
- Token desain 05 & komponen inti tersedia dari P01; Toggle, Slider, MobileDock, tag `Cuma kamu` dari P03; Segmented dari P04. ToolRail dan panel SCR-09..11 dibangun di fase ini.

## 4. Requirement dalam scope

- Renderer studio berlapis: Background, Photo, FrameOverlay, Decor (10 §1).
- Sistem koordinat base px & skala seragam (10 §4).
- Model `LayoutSpec` + `Slot` + `BindingPlan` dengan binding `CELL` / `SHOT_GROUP` / `FREE` (10 §5, DEC-087); **kedua** strategi wajib berfungsi di setiap mode Strip/Group/Grid, plus `FREEFORM` untuk Collage.
- `studio.bindingStrategy` sebagai state studio bersama, terkunci setelah shot pertama (DEC-065).
- Layout per mode (10 §3), parameter & safeguard DEC-042 (10 §6) sebagai konfigurasi terpusat; pelanggaran safeguard menampilkan alternatif, tidak memotong diam-diam.
- Edit slot (posisi/ukuran) dengan snapping (10 §7).
- Library frame bawaan **≥ 6 frame** (1 per kategori V1, DEC-066 target MVP) beserta metadata `FrameTemplate` (10 §8).
- Panel Frame (SCR-09): pratinjau lokal vs **Pasang buat semua**.
- Upload frame custom (SCR-10): presigned upload, validasi server, re-encode, deteksi lubang, kuota (DEC-041, DEC-054).
- Adaptasi frame tanpa distorsi: `FIXED`, `CONTAIN`, `COVER`, `NINE_SLICE`, `PATTERN` (10 §10).
- Panel Layout & kanvas (SCR-11) termasuk kunci struktur setelah shot pertama (DEC-065, penegakan penuh di P06).
- Panel Kameraku (SCR-12): framing pra-capture milik sendiri (DEC-049).
- Panel Filter grup (preset 05 §12) sebagai state studio bersama.
- State studio bersama: `studio.update` / `studio.updated` + toast "Diubah X · Balikin".
- Dock & bottom sheet mobile untuk studio (06 §7).

## 5. Di luar scope (eksplisit)

- Countdown, capture, upload foto, accept/retake (P06).
- Editor elemen (stiker/teks/doodle) dan dokumen Yjs (P07).
- Render export resolusi penuh & unduhan (P08). Fase ini hanya merender pratinjau di layar.
- Library 24 frame untuk rilis publik (lanjutan P07–P10, DEC-066).
- Segmentasi/hapus latar untuk Group Shot (DEC-095 DEFERRED).
- Moderasi konten frame upload (15 §9, dicatat sebagai risiko).

## 6. ID requirement terkait

REQ-FRAME-01..15, REQ-VOTE-07, REQ-CAM-08..10, REQ-CAM-12..13, REQ-MOB-03..07, REQ-UI-03..04, NFR-11, NFR-12 (persiapan). Keputusan: DEC-039, DEC-041, DEC-042, DEC-049, DEC-054, DEC-058, DEC-061 (OPEN), DEC-062, DEC-065, DEC-066, DEC-067, DEC-087.

## 7. Referensi dokumentasi

- [10_FRAMES_CANVAS_LAYOUT.md](../10_FRAMES_CANVAS_LAYOUT.md) (seluruhnya)
- [09_CAMERA_CAPTURE_RETAKE.md](../09_CAMERA_CAPTURE_RETAKE.md) §4, §4.1, §6
- [06_RESPONSIVE_MOBILE_UX.md](../06_RESPONSIVE_MOBILE_UX.md) §6–§8, §11
- [14_DATA_MODEL_AND_EVENTS.md](../14_DATA_MODEL_AND_EVENTS.md) §4 (frames), §6 (`studio.update`)
- [03_USER_FLOWS.md](../03_USER_FLOWS.md) F-09

## 8. Referensi visual yang disetujui

| Layar | File |
|---|---|
| SCR-08 desktop/mobile | `02_Desktop/04_Live_Photobooth.webp`, `03_Mobile/04_Live_Photobooth.webp` |
| SCR-09 desktop/mobile | `02_Desktop/05_Frame_Library.webp`, `03_Mobile/05_Frame_Library.webp` |
| Gaya 6 frame | `01_Design_System/Brand_Identity.webp` bagian 04 |
| SCR-10, SCR-11, SCR-12 | DERIVED (04): wajib review visual sebelum fase ditutup |

## 9. Tugas implementasi fungsional

1. Masuk studio: feed live semua peserta tampil di slot sesuai layout default mode; panel "Hasil sementara" menampilkan pratinjau output dengan frame aktif.
2. Panel Frame: chip kategori & pencarian; mengetuk thumbnail hanya mengubah pratinjau lokal + mengirim presence "lagi lihat X"; **Pasang buat semua** mengubah frame semua peserta ≤ 1 detik + toast di klien lain.
3. Upload frame: pilih PNG/WebP → progres → "Ngecek file…" → pratinjau dengan "n lubang ketemu" → pilih mode adaptasi → **Pasang buat semua**. Error spesifik 10 §9.
4. Panel Layout: ganti susunan (strip vertikal/horizontal, grid, custom), jumlah shot, rasio slot, preset output, jarak, radius, warna latar; drag/resize slot di pratinjau.
5. Panel Kameraku (`Cuma kamu`): zoom, geser, kecerahan, kehangatan, cermin, ganti kamera, reset. Hasilnya terlihat di feed sendiri dan feed yang dilihat orang lain di slot.
6. Panel Filter: pilih preset grup (Asli, Hangat, Sejuk, Pudar, Film, Mono); tersinkron.
7. Setiap perubahan bersama memunculkan toast "{nama} {aksi} · Balikin" di klien lain; **Balikin** mengembalikan nilai sebelumnya (satu langkah).
8. Mobile: fullscreen feed edge-to-edge, overlay atas (kode, mode + progres, tombol fokus), dock (Timer non-aktif sampai P06, shutter non-aktif, **Alat**), sheet kontekstual per panel.

## 10. Tugas implementasi teknis

| Area | Tugas | Lokasi (PROPOSED) |
|---|---|---|
| Model | Tipe `StudioState`, `LayoutSpec`, `LayoutSlot`, `BindingStrategy`, `SlotBinding = {kind:'CELL', shotIndex, participantSlot} \| {kind:'SHOT_GROUP', shotIndex, arrangement} \| {kind:'FREE'}` (14 §6.1) | `shared/src/studio.ts` |
| Layout | Generator `generatePlan(mode, strategy, shotCount, participantSlots, template)` untuk 1–8 shot × 1–4 peserta dan **kedua** strategi; strategi aktif dibaca dari `studio.bindingStrategy` (bukan flag build). Default strategi per mode berasal dari konfigurasi dan berstatus sementara sampai DEC-061 dijawab | `shared/src/layout/generate.ts` |
| Safeguard | Konstanta `MAX_SHOTS`, `MAX_CELLS`, `MAX_GRID_SIDE`, `MAX_OUTPUT_PX`, `MIN_CELL_PX_WARN` di satu modul konfigurasi; dipakai validator, UI, dan export | `shared/src/limits.ts` |
| Validasi | Validator patch studio: safeguard DEC-042, konsistensi binding (14 §6.1), slot ≥ 50% dalam kanvas, minimum 60×60 base px, NaN ditolak | `shared/src/layout/validate.ts` (dipakai server & klien) |
| Renderer | Komponen `StudioCanvas` (react-konva) berlapis; feed `<video>` diposisikan absolut di atas slot (09 §6); slot `fit: cover` + `focal` | `web/src/features/studio/canvas/` |
| Frame | Loader `FrameTemplate` bawaan (aset statis build) + custom (signed URL) | `web/src/features/frames/` |
| Adaptasi | Fungsi murni `computeFrameTransform(template, canvas, mode)` → skala seragam + offset; nine-slice dengan tile; slot ikut transform | `shared/src/frames/adapt.ts` |
| Server upload | `POST /frames` (presign, batas ukuran & content-type), `POST /frames/{id}/complete`: magic bytes, `sharp` dengan `limitInputPixels`, dimensi, tolak animasi, re-encode, analisis alpha → slot, simpan metadata, broadcast `frame.added` | `realtime/src/frames/` |
| Kuota | 20 frame/room, 20 upload/jam/peserta (DEC-067) | Rate limiter |
| Studio sync | Handler `studio.update` (LWW per field, `baseVersion`), `studio.updated`, penolakan `MODE_LOCKED`/`STRUCTURE_LOCKED`/`INVALID_PATCH` | `realtime/src/room/handlers/studio.ts` |
| Undo studio | Simpan nilai sebelumnya per patch untuk **Balikin** satu langkah | Actor |
| Kameraku | `presence.set {cameraPresentation}` hanya untuk diri sendiri; transform tampilan diterapkan ke video (CSS transform/crop) | `web/src/features/camera/presentation.ts` |
| Filter | Implementasi preset yang sama untuk pratinjau & export (`ctx.filter`, fallback worker per-piksel) | `shared/src/filters/` |
| Aset frame bawaan | 6 frame: Seoul Strip, Editorial, Film 400, Scrapbook, Lilac Dream, Mosaic, dengan `license.source` terisi | `web/public/frames/` |

## 11. Dependensi data model & event

- `Session.studio: StudioState` (14 §6), `FrameTemplate` (10 §8), `CameraPresentation` (14 §3), `TempAsset kind:'frame'` (14 §11).
- HTTP: `POST /api/rooms/{code}/frames`, `POST /api/rooms/{code}/frames/{frameId}/complete` (14 §4).
- WS: `studio.update`, `studio.updated`, `presence.set`, `presence.update`, `asset.urls`; event `frame.added` (10 §9).
- Error: `MODE_LOCKED`, `STRUCTURE_LOCKED`, `INVALID_PATCH`, `FRAME_TOO_LARGE`, `FRAME_UNSUPPORTED`, `FRAME_DIMENSIONS`, `FRAME_DECODE_FAILED`, `FRAME_QUOTA`, `FORBIDDEN_NOT_OWNER`.

## 12. Requirement UI/UX

- Tema `stage` (05 §2.2). Rail kiri desktop **Frame, Layout, Kamera, Filter** dengan label.
- Tag lingkup wajib di setiap panel: `Bareng` (Frame, Layout, Filter) dan `Cuma kamu` (Kameraku). Kalimat bantu Kameraku dari 04 SCR-12.
- Thumbnail frame 150 px desktop / 112 px mobile, state terpilih sesuai 05 §12, avatar peserta yang sedang melihat.
- Kontrol struktur yang terkunci: disabled + tooltip "Dikunci setelah shot pertama".
- Peringatan kualitas frame saat upscaling > 1.25× (10 §10).
- Feed tidak boleh tertutup panel di mobile; sheet `half` tanpa scrim.

## 13. Pertimbangan desktop & mobile

| Aspek | Desktop | Mobile |
|---|---|---|
| Panel | Drawer kanan 380–400 px | Bottom sheet kontekstual (peek/half/full) |
| Edit slot | Drag + handle 8 arah, `Shift` jaga rasio | Tap slot → sheet numerik + drag/pinch |
| Framing Kameraku | Drag & scroll di pratinjau | Drag 1 jari, pinch |
| Orientasi | — | Landscape: dock kanan (DEC-058) |
| Performa | Aset ≤ 2× DPR | Sama; target ≥ 24 fps feed (NFR-11) |

## 14. Pertimbangan keamanan & privasi

Sesuai 15 §14 baris P05:

- Validasi upload frame di server (magic bytes, decode aman, batas piksel, dimensi, tolak SVG/animasi), **re-encode** dan buang metadata. Validasi klien hanya UX.
- Bucket privat; frame custom diakses via signed URL TTL ≤ 10 menit; key di bawah `rooms/{roomId}/frames/`.
- Frame custom room-scoped dan ikut terhapus bersama room (DEC-054). Pastikan terdaftar di indeks aset room untuk cleanup.
- `cameraPresentation` hanya bisa ditulis pemiliknya (REQ-CAM-13, TC-SEC-012).
- Nama file upload dirender sebagai teks.

## 15. Checklist tugas detail

- [ ] Tipe model studio & binding (A dan B) + validator bersama
- [ ] Generator layout default per mode untuk 1–4 peserta & 1–8 shot
- [ ] `StudioCanvas` berlapis + video overlay di slot
- [ ] `computeFrameTransform` + unit test (rasio sumbu identik)
- [ ] Mode adaptasi FIXED/CONTAIN/COVER/NINE_SLICE/PATTERN
- [ ] 6 frame bawaan + metadata + lisensi
- [ ] Panel Frame (pratinjau lokal, presence "lagi lihat", Pasang buat semua)
- [ ] Upload frame end-to-end + kuota + error
- [ ] Panel Layout & kanvas + edit slot + snapping
- [ ] Panel Kameraku + `cameraPresentation`
- [ ] Panel Filter grup
- [ ] Handler `studio.update` + LWW + toast + Balikin satu langkah
- [ ] Kunci struktur (siap dipicu P06) dan penolakan `STRUCTURE_LOCKED`
- [ ] Mobile: fullscreen feed, overlay, dock, sheet, landscape
- [ ] Indeks aset frame untuk cleanup
- [ ] Review visual SCR-08..12
- [ ] Generator BindingPlan untuk kedua strategi + Freeform, diuji 1–8 shot × 1–4 peserta (TC-FRAME-005)
- [ ] Pesan safeguard + alternatif (TC-FRAME-006)
- [ ] `bindingStrategy` tersinkron & terkunci setelah shot 1 (TC-FRAME-007)
- [ ] Status DEC-061 dicatat di handoff (OPEN / dijawab); tidak ada strategi yang dihapus atau di-hardcode
- [ ] Tes §20 + handoff §24

## 16. Checkpoint integrasi

- **IC-3:** voting → studio → perubahan frame/layout tersinkron di 4 klien → feed live tampil di slot yang benar.
- Upload frame dari satu klien terlihat di 3 klien lain dan tercatat di indeks aset room.
- Room di-expire setelah upload frame: objek frame ikut terhapus (bagian TC-SEC-030).

## 17. Edge case

| Kasus | Perilaku |
|---|---|
| Peserta ke-4 join saat `STUDIO` sebelum shot 1 | BindingPlan dibangkitkan ulang sesuai strategi aktif (07 §7.2) |
| 8 shot × 4 peserta pada strategi foto per orang | 32 cell; plan panjang/grid dibuat otomatis; peringatan kualitas jika cell terlalu kecil (10 §6) |
| Pengaturan melewati safeguard | Banner alasan + alternatif; nilai tidak dipotong diam-diam (TC-FRAME-006) |
| Dua orang mengganti frame bersamaan | LWW; keduanya melihat toast (07 §13) |
| Frame rasio 1:3 di output 1:1 | `CONTAIN` + warna latar, tanpa stretch (TC-FRAME-020) |
| Frame tanpa lubang transparan | Slot dari layout dipakai; overlay di atas foto |
| Frame upload > 15% terpotong di `COVER` | Peringatan |
| Feed peserta mati | Slot menampilkan state kartu kamera (05 §10) |
| Peserta tanpa kamera (DEC-068) | Slot "tanpa kamera" |
| Kuota frame tercapai | `FRAME_QUOTA` |

## 18. Skenario kegagalan

| Kegagalan | Penanganan |
|---|---|
| Upload frame terputus | Upload ulang; presign baru jika kedaluwarsa |
| Decoder gagal / bomb | `FRAME_DECODE_FAILED`, tanpa lonjakan memori (TC-SEC-017) |
| Aset frame bawaan gagal dimuat | Fallback frame "Linen/putih polos" + log error |
| `studio.update` ditolak | Rollback optimistis + toast |
| Signed URL kedaluwarsa saat pratinjau | Minta ulang via `asset.urls` |

## 19. Acceptance criteria

| ID | Kriteria | Test |
|---|---|---|
| AC-P05-1 | "Pasang buat semua" tersinkron ≤ 1 detik + toast | TC-FRAME-001 |
| AC-P05-2 | Pratinjau lokal tidak mengubah klien lain | TC-FRAME-002 |
| AC-P05-3 | Jumlah shot bisa diubah sebelum shot 1; mekanisme penolakan setelah shot 1 siap | TC-FRAME-003, TC-FRAME-004 (diverifikasi penuh di P06) |
| AC-P05-4 | Upload PNG valid diterima, re-encode, lubang terdeteksi | TC-FRAME-010 |
| AC-P05-5 | File > 10 MB ditolak dengan pesan | TC-FRAME-011 |
| AC-P05-6 | Adaptasi tanpa skala non-uniform | TC-FRAME-020, TC-FRAME-021 |
| AC-P05-7 | SVG menyamar & decompression bomb ditolak | TC-SEC-016, TC-SEC-017 |
| AC-P05-8 | Tidak bisa menulis `cameraPresentation` orang lain | TC-SEC-012 |
| AC-P05-9 | Feed ≥ 24 fps di HP menengah dengan studio aktif | TC-PERF-020 |
| AC-P05-10 | ≥ 6 frame bawaan dari 6 kategori tersedia | Review manual (DEC-066) |
| AC-P05-11 | BindingPlan valid untuk **kedua** strategi di semua mode, 1–8 shot × 1–4 peserta; status DEC-061 tercatat (tidak harus CONFIRMED) | TC-FRAME-005 |
| AC-P05-12 | Safeguard menampilkan alternatif tanpa pemotongan diam-diam | TC-FRAME-006 |
| AC-P05-13 | `bindingStrategy` tersinkron dan terkunci setelah shot 1 | TC-FRAME-007 |

## 20. Checklist pengujian

- [ ] Unit: generator layout, validator, `computeFrameTransform`, nine-slice, filter (golden pixel kecil)
- [ ] Integrasi: pipeline upload frame dengan minio + sharp (valid, besar, SVG, bomb, animasi)
- [ ] Unit/E2E binding: TC-FRAME-005..007
- [ ] E2E 4 konteks: TC-FRAME-001..004, 010, 011
- [ ] Manual perangkat: sheet frame/layout, gestur Kameraku (iOS & Android)
- [ ] Axe-core panel stage
- [ ] Review visual SCR-08..12

Perintah verifikasi yang disarankan (dijalankan oleh/atas izin pengguna): `pnpm test --filter shared`, `pnpm test:integration -- frames`, `pnpm test:e2e -- studio`. Agen tidak menjalankan typecheck/lint/build/git penuh, commit, push, atau deploy tanpa instruksi eksplisit, dan tidak mengarang hasil tes.

## 21. Definition of Done

- Checklist §15 lengkap dengan bukti; AC-P05-1..13 terverifikasi dengan status nyata.
- Kedua strategi binding berfungsi dan dites; DEC-061 boleh tetap OPEN (statusnya dicatat di handoff dan 18).
- Tidak ada feed palsu: semua slot memakai track asli dari P03.
- Frame bawaan punya sumber lisensi tercatat.
- Satu jalur render dipakai untuk pratinjau (siap dipakai export P08).

## 22. Deliverable

- Mesin layout/frame + renderer studio.
- 6 frame bawaan + metadata.
- Pipeline upload frame server.
- UI SCR-08..12 desktop & mobile.
- Tes unit/integrasi/E2E + laporan review visual.
- Handoff P05.

## 23. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| RK-03 DEC-061 terlambat | BindingPlan berbasis data (DEC-087); kedua strategi didukung & dites; jawaban DEC-061 cukup mengubah default/visibilitas kontrol |
| Plan 32 cell berat di HP | Ukur TC-PERF-022 lebih awal; render pratinjau per layer & cache |
| RK-01 beban HP (video + kanvas) | Video di DOM, kanvas hanya frame; cache layer statis |
| Distorsi frame custom | Fungsi transform murni + TC-FRAME-020 |
| Lisensi frame bawaan | Hanya aset buatan sendiri / lisensi jelas, dicatat di metadata |
| Konten tidak pantas di frame upload | Room-scoped; catat di P09 |

## 24. Handoff ke fase berikutnya

```text
HANDOFF P05 → P06
Completed work:
Modified components / files:
Technical decisions (status DEC-061 OPEN/dijawab + default sementara yang dipakai, DEC-087, DEC-042, DEC-065, DEC-039 dll.):
Tests performed (ID, hasil, bukti, perangkat):
Tests NOT yet performed:
Known issues:
Outstanding risks:
Readiness for P06 (YA/TIDAK + alasan):
```

P06 membutuhkan: BindingPlan yang terkunci per sesi bersama `bindingStrategy` (apa pun strategi aktifnya), API untuk mengunci struktur (DEC-065), `cameraPresentation` yang bisa diterapkan pada frame resolusi penuh (09 §4.1), dan slot yang bisa menampilkan foto accepted untuk shot yang selesai.
