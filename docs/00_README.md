# LONGROLL — Dokumentasi Produk & Rencana Pengembangan

| Atribut | Nilai |
|---|---|
| Versi paket | 1.1.0 |
| Status | Siap review, **belum ada implementasi** |
| Bahasa | Bahasa Indonesia, istilah teknis tetap dalam bahasa Inggris |
| Referensi visual | `LONGROLL_FINAL_VISUAL_REVIEW.zip` (Visual Baseline V1, 17 gambar) |

LONGROLL adalah photobooth online multiplayer untuk maksimal 4 orang. Semua peserta menyalakan kamera live di satu room, memilih mode foto lewat voting, mengambil foto secara tersinkron, menerima atau mengulang foto masing-masing secara individual, lalu menghias hasilnya bersama secara real-time. Tidak ada akun dan tidak ada host. Room bersifat sementara dan datanya dihapus setelah room kedaluwarsa.

Paket ini adalah **single source of truth** untuk agen coding. Dokumen ini menjelaskan *apa* yang harus dibangun dan *bagaimana* memverifikasinya. Dokumen ini tidak berisi kode produksi.

---

## Ringkasan perubahan v1.1.0

Revisi ini memperbaiki konsistensi v1.0.0 tanpa menambah keputusan produk CONFIRMED baru dan tanpa mengubah Visual Baseline V1. Jumlah file tetap 30.

| # | Perubahan | Dokumen utama |
|---|---|---|
| 1 | **Kontradiksi 12 slot vs 4 peserta × 4–8 shot diselesaikan.** Model photo cell `(shot, peserta)` + `BindingPlan` (DEC-087). Batas diturunkan dari `MAX_SHOTS = 8` × 4 peserta = 32 cell; grid ≤ 32 (sisi ≤ 8); output ≤ 8192 px dengan export tiling. | 10 §5–§6, 14 §6.1, 02, 12 §4, 17, P05, P08 |
| 2 | **Umur maksimal room 12 jam bukan default lagi.** Room hidup selama ada peserta terhubung; batas umur hanya jika pemilik produk menyetujui (DEC-052 OPEN, konfigurasi default nonaktif). TC-ROOM-026 baru. | 02 REQ-LIFE-01, 03, 07, 13, 14, 15, 18, P02, P09 |
| 3 | **DEC-061 tetap OPEN.** Data binding mendukung komposisi grup per shot (`SHOT_GROUP`) dan foto individual per shot (`CELL`); tidak ada strategi yang dipilih sebagai final. DEC-061 tidak lagi memblokir P05, hanya rilis (P10). | 10 §5, 09 §6, 11 §13, 04, P05–P07 |
| 4 | **Voice chat (DEC-076) tetap OPEN** dan tidak memblokir P03. MVP video-only; mikrofon tidak masuk scope; `MediaTransport` sebagai titik ekstensi. TC-CAM-007 baru. | 13 §4, P03, 16, 18 |
| 5 | **P01 diperkecil.** Tidak ada 22 screen shell; fokus token, komponen inti, layout desktop/mobile, routing, landing, dan kerangka layout yang dibutuhkan P02. Layar lain dibangun fase pemiliknya. | P01, P02–P08 §3, 16 |
| 6 | **Batas shot, cell, frame, output, sesi, storage = PROPOSED technical safeguards** (DEC-041/042/053/085). Menurunkannya butuh persetujuan pemilik produk; UI tidak pernah memotong diam-diam. | 10 §6, 02 REQ-FRAME-15, 04 SCR-11/22, 18 |
| 7 | **Arsitektur MVP vs skala dipisah** (13 §15, DEC-088): satu instance realtime + snapshot Redis untuk MVP; multi-instance/lease, SFU, render server hanya saat pemicu tercapai. Token anonim pindah ke **cookie HttpOnly + SameSite=Strict + cek Origin** (DEC-082), TH-13 baru. | 13, 07, 14 §4–§5, 15, P02, P09, P10 |
| 8 | Aturan inti tetap: voting demokratis, retake individual, tanpa auto-accept, tanpa host, room self-destruct. | 02, 08, 09 |

ID baru: DEC-087, DEC-088; TC-ROOM-026/027, TC-CAM-007, TC-FRAME-005/006/007, TC-EXP-012, TC-PERF-022, TC-SEC-022/023; TH-13; RK-11/12; EC-13/14. Tidak ada ID yang dihapus atau dinomori ulang.

---

## 1. Peta dokumentasi

| File | Tanggung jawab | Pembaca utama |
|---|---|---|
| `00_README.md` | Pintu masuk, peta dokumen, aturan pemakaian | Semua |
| `01_PRODUCT_VISION.md` | Misi, audiens, diferensiasi, batas produk | Semua |
| `02_PRODUCT_REQUIREMENTS.md` | **Registry requirement** (`REQ-*`, `NFR-*`), acceptance criteria, edge case | Semua |
| `03_USER_FLOWS.md` | Perjalanan pengguna end-to-end, diagram alur | Produk, FE |
| `04_SCREEN_SPECIFICATIONS.md` | Spesifikasi tiap layar (`SCR-*`), state, desktop & mobile | FE |
| `05_DESIGN_SYSTEM.md` | Token, tipografi, komponen, motion, aksesibilitas | FE |
| `06_RESPONSIVE_MOBILE_UX.md` | Breakpoint, safe area, gestur, keterbatasan browser mobile | FE |
| `07_ROOM_AND_MULTIPLAYER.md` | Room, identitas anonim, presence, kursor, reconnect, state machine room | FE, BE |
| `08_VOTING_AND_SESSIONS.md` | Voting mode, seri, lock mode, lifecycle sesi | FE, BE |
| `09_CAMERA_CAPTURE_RETAKE.md` | Kamera, WebRTC, countdown tersinkron, accept/retake individual | FE, BE |
| `10_FRAMES_CANVAS_LAYOUT.md` | Mesin frame, koordinat kanvas, slot, upload frame, adaptasi | FE |
| `11_COLLABORATIVE_EDITOR.md` | Model dokumen bersama, operasi edit, konflik, undo | FE, BE |
| `12_GALLERY_AND_EXPORT.md` | Galeri sementara, render export, Google Drive | FE, BE |
| `13_SYSTEM_ARCHITECTURE.md` | Arsitektur yang direkomendasikan, trade-off, deploy, biaya | BE, DevOps |
| `14_DATA_MODEL_AND_EVENTS.md` | Model data, kontrak event WebSocket & API, idempotensi | FE, BE |
| `15_SECURITY_PRIVACY_LIFECYCLE.md` | Otorisasi anonim, media, retensi, cleanup, ancaman | BE, Security |
| `16_IMPLEMENTATION_ROADMAP.md` | Urutan P01–P10, milestone, gate | Semua |
| `17_QA_TEST_PLAN.md` | Strategi tes, skenario `TC-*`, PASS/FAIL | QA, FE, BE |
| `18_DECISIONS_AND_OPEN_QUESTIONS.md` | Register keputusan `DEC-*` | Semua |
| `PHASES/00_PHASE_OVERVIEW.md` | Ringkasan dependensi fase | Semua |
| `PHASES/P01…P10` | Spesifikasi kerja per fase (24 bagian wajib) | Agen coding |

## 2. Urutan membaca

**Pertama kali (siapa pun):** 00 → 01 → 02 → 18 → 03 → 16 → `PHASES/00_PHASE_OVERVIEW.md`.

**Sebelum mengerjakan sebuah fase:** baca file fase itu dulu, lalu dokumen yang terdaftar di tabel berikut.

| Fase | Wajib dibaca sebelum mulai |
|---|---|
| P01 Foundation & Design System | 05, 06, 04 (§0, SCR-01..03, SCR-05, SCR-21), 13 §3 & §15 |
| P02 Room & Multiplayer | 07, 14 §2–§5, 15 §2–§4, 13 §15, 04 (SCR-01..05) |
| P03 Live Camera & WebRTC | 09 §1–§6, 13 §4–§5, 15 §5, 06 §8 |
| P04 Voting & Sessions | 08, 14 §6, 04 (SCR-06, SCR-07, SCR-19) |
| P05 Studio & Frame Engine | 10, 05 §10–§12, 04 (SCR-08..12), 14 §6.1, 18 DEC-042/DEC-061/DEC-087 |
| P06 Capture & Retake | 09 §7–§12, 14 §7–§8, 04 (SCR-13..15) |
| P07 Collaborative Editor | 11, 14 §9, 04 (SCR-16), 06 §7 |
| P08 Gallery & Export | 12, 14 §10, 04 (SCR-17..19) |
| P09 Security & Reliability | 15, 13 §9–§10 & §15, 17 §6 |
| P10 QA & Release | 17, 16 §6, semua checklist fase |

## 3. Hierarki sumber kebenaran

Jika ada konflik, ikuti urutan ini (yang atas menang):

1. **Requirement CONFIRMED** di `02_PRODUCT_REQUIREMENTS.md` dan keputusan CONFIRMED di `18`.
2. **Visual Baseline V1** (17 gambar) untuk tampilan: warna, tipografi, layout, komponen.
3. **Dokumen spesifikasi area** (03–15).
4. **Keputusan PROPOSED/RECOMMENDED** di `18`.
5. Artefak desain lama (iterasi sebelum V1): hanya sebagai referensi cakupan layar sekunder. **Tidak boleh** meng-override V1.

Aturan khusus:

- Requirement produk **mengalahkan** teks atau perilaku insidental di mockup. Contoh: angka timer "0:18" di mockup voting bukan requirement (DEC-046).
- Jika dua dokumen spesifikasi bertentangan, **jangan memilih sendiri**. Catat sebagai `OPEN QUESTION` baru di `18`, lalu tanya pemilik produk.

## 4. Cara agen coding memakai dokumen ini

1. **Satu fase dalam satu waktu.** Baca file fase dan dokumen wajib sebelum mengubah kode.
2. **Cek status keputusan.** Sebelum mengimplementasikan perilaku yang berlabel PROPOSED/OPEN, cek `18`. Implementasikan default PROPOSED sebagai konfigurasi yang mudah diganti.
3. **Pakai ID.** Commit message, komentar PR, dan laporan handoff merujuk `REQ-*`, `SCR-*`, `TC-*`, dan `DEC-*`.
4. **Jangan memperluas scope diam-diam.** Fitur di luar fase berjalan → catat sebagai usulan, jangan dikerjakan.
5. **Tidak boleh ada mock permanen.** Placeholder boleh selama fase berjalan, tapi Definition of Done fase melarang mock yang menggantikan fungsi nyata (misalnya kamera palsu setelah P03).
6. **Tidak ada sistem akun atau host**, dalam bentuk apa pun, termasuk "owner room" tersembunyi.
7. **Desktop dan mobile dikerjakan bersama** di setiap fase yang menyentuh UI.
8. **Keamanan sejak awal.** Kontrol keamanan yang relevan diterapkan di fase tempat fiturnya dibangun; P09 adalah hardening, bukan titik awal.

### 4.1 Aturan workflow agen (wajib)

- **Jangan** commit, push, merge, atau deploy secara otomatis.
- **Jangan** menjalankan perubahan database/storage yang destruktif tanpa instruksi eksplisit.
- **Jangan** menjalankan typecheck, lint, build, atau operasi Git penuh tanpa instruksi eksplisit pengguna. Tuliskan perintah verifikasi yang disarankan untuk dijalankan atau diizinkan pengguna.
- **Jangan pernah mengarang hasil tes.** Fase hanya boleh ditandai selesai setelah acceptance criteria benar-benar diverifikasi.
- Periksa kode yang ada sebelum mengubahnya. Utamakan perubahan yang terarah. Hindari refactor yang tidak terkait dan dependensi yang tidak perlu.

## 5. Terminologi

| Istilah | Definisi |
|---|---|
| **Room** | Ruang sementara berkode unik, maksimal 4 peserta. Wadah semua sesi. |
| **Peserta (participant)** | Orang yang bergabung ke room dengan display name. Diidentifikasi secara teknis oleh `participantId` + token room. |
| **Slot peserta** | Posisi P1–P4 di room yang menentukan warna. |
| **Sesi (session)** | Satu siklus foto: voting → studio → capture → editor → hasil. Satu room bisa punya banyak sesi. |
| **Mode** | Salah satu dari Photo Strip, Group Shot, Photo Grid, Freeform Collage. Dipilih lewat voting, terkunci per sesi. |
| **Studio** | Workspace photobooth sebelum dan selama capture (SCR-08). Berisi feed live, frame, layout. |
| **Shot** | Satu momen capture tersinkron dalam sesi (misal shot 2 dari 4). |
| **Attempt** | Satu foto yang diambil seorang peserta untuk satu shot. Retake menghasilkan attempt baru. |
| **Accept / "Pakai ini"** | Peserta menetapkan attempt miliknya sebagai foto final untuk shot itu. |
| **Retake / "Ulang"** | Peserta menolak attempt miliknya dan mengambil attempt baru, tanpa mempengaruhi peserta lain. |
| **Layout** | Susunan slot foto di kanvas output. |
| **Slot foto** | Area di layout yang menampung satu foto/feed. Berbeda dari slot peserta. |
| **Frame** | Desain dekoratif (latar, border, ornamen) yang membungkus layout. |
| **Dokumen editor** | State bersama editor (elemen, layer, transform) yang disinkronkan via CRDT. |
| **Galeri sementara** | Kumpulan hasil sesi selesai di room. Ikut hilang saat room dihancurkan. |
| **Grace period** | Waktu tunggu setelah room kosong sebelum room dihancurkan. |
| **Hold slot** | Waktu slot peserta yang putus ditahan saat room masih aktif. |
| **Stage** | Tema visual gelap untuk workspace photobooth. |
| **Lokal / "Cuma kamu"** | Pengaturan yang hanya bisa diubah pemilik perangkat. |
| **Bersama / "Bareng"** | Pengaturan yang bisa diubah semua peserta dan tersinkron. |

## 6. Konvensi versi dokumen

- Setiap dokumen punya tabel atribut dengan `Versi` (SemVer).
  - **MAJOR**: perubahan requirement CONFIRMED atau perubahan kontrak data yang tidak kompatibel.
  - **MINOR**: penambahan bagian, requirement PROPOSED baru, atau keputusan baru.
  - **PATCH**: perbaikan redaksi, link, atau typo.
- Perubahan requirement **selalu** disertai pembaruan `18` di perubahan yang sama.
- ID (`REQ`, `SCR`, `TC`, `DEC`) tidak pernah dipakai ulang atau dinomori ulang.

## 7. Protokol penyelesaian fase

Sebuah fase dianggap **SELESAI** hanya jika:

1. Semua item "Detailed task checklist" di file fase dicentang **dengan bukti** (file/komponen yang diubah, tes yang dijalankan).
2. Semua acceptance criteria fase terverifikasi. Tes yang butuh perangkat nyata dicatat siapa yang menjalankan, di perangkat apa, dan kapan.
3. Tidak ada OPEN QUESTION berstatus 🔴 untuk fase itu yang belum dijawab.
4. Template handoff (bagian 24 di setiap file fase) diisi lengkap, termasuk **tes yang belum dijalankan** dan **masalah yang diketahui**.
5. Pemilik produk (atau reviewer yang ditunjuk) menyetujui handoff.

Status fase dicatat di bagian atas file fase: `NOT STARTED` → `IN PROGRESS` → `READY FOR REVIEW` → `DONE`.
