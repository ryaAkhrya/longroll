# P07 — Collaborative Photo Editor

| Atribut | Nilai |
|---|---|
| Dokumen | `PHASES/P07_COLLABORATIVE_EDITOR.md` |
| Versi | 1.1.0 |
| Status fase | NOT STARTED |
| Bergantung pada | P06 (foto accepted per shot, transisi sesi ke `EDITING`) |
| Dokumen wajib dibaca | [11_COLLABORATIVE_EDITOR.md](../11_COLLABORATIVE_EDITOR.md), [14_DATA_MODEL_AND_EVENTS.md](../14_DATA_MODEL_AND_EVENTS.md) §9, [04_SCREEN_SPECIFICATIONS.md](../04_SCREEN_SPECIFICATIONS.md) SCR-16, [06_RESPONSIVE_MOBILE_UX.md](../06_RESPONSIVE_MOBILE_UX.md) §7–§8, [05_DESIGN_SYSTEM.md](../05_DESIGN_SYSTEM.md) §11–§12 |

## 1. Identitas & tujuan fase

Membangun editor foto kolaboratif real-time (SCR-16). Semua peserta bisa mengedit hasil sesi secara bersamaan tanpa kunci eksklusif. State bersama tetap konsisten (CRDT Yjs, DEC-031) dan setiap perubahan bisa dipulihkan lewat undo pribadi serta riwayat bersama "Balikin" (DEC-032).

Milestone yang ditopang: bagian pertama **M3 — MVP fitur lengkap** ([16_IMPLEMENTATION_ROADMAP.md](../16_IMPLEMENTATION_ROADMAP.md) §5).

## 2. Prasyarat & dependensi

| Prasyarat | Sumber |
|---|---|
| Sesi bisa mencapai `EDITING` setelah shot terakhir `DONE` | P06, 09 §10 |
| Attempt `ACCEPTED` punya preview (≤ 1600 px untuk editor) dan full-res di storage | P06, DEC-035 |
| Renderer Konva + model layout/frame/binding dari studio | P05, DEC-039, 10 §1 |
| WebSocket room dengan envelope, `seq`, ack, resume | P02, 14 §5 |
| Kursor desktop (`cursor.move`) sudah ada untuk voting/studio | P02, DEC-071 |
| BindingPlan terkunci per sesi (DEC-087). DEC-061 **tidak** perlu dijawab: seed membaca plan apa pun strateginya | P05, 11 §13 |
| Set aset stiker sementara dengan lisensi jelas tersedia (DEC-055 boleh belum final, lihat §23) | 18 |

## 3. Kondisi awal yang diharapkan

- Sesi berpindah ke `EDITING` setelah shot terakhir `DONE`, tapi layar SCR-16 belum ada (dibangun di fase ini; v1.1 P01 tidak membuat shell layar).
- Belum ada `Y.Doc`, belum ada event `editor.*` di server.
- Tombol **Selesai edit** belum terhubung (transisi `FINAL` dikerjakan bersama P08; P07 hanya mengirim `session.finalize` dan menerima `session.state`).

## 4. Requirement dalam scope

- Dokumen bersama per sesi sesuai 11 §2 (`meta`, `elements`, `history`, `z` fractional index).
- Tipe elemen `photo`, `sticker`, `text`, `doodle` (11 §3). `shape` P2 opsional.
- Operasi: pilih, geser, resize, rotasi, crop & zoom foto, filter (global & per foto), stiker, teks, coret, layer (z), hapus, duplikat, ganti frame (11 §4).
- Edit simultan tanpa lock, konvergensi CRDT, deteksi "kalah" dengan toast **Balikin** (11 §5).
- Soft-lock visual via awareness (DEC-033).
- Undo/redo pribadi (Yjs UndoManager) dan riwayat bersama dengan Balikin oleh siapa pun (DEC-032).
- Presence editor: kursor + label aksi (desktop), outline + avatar (mobile), transient drag & draft doodle (11 §6).
- Sinkronisasi, persistensi snapshot ke Redis, reconnect via state vector (11 §8).
- Validasi skema update di server (11 §8, 14 §8.2).
- UI desktop & mobile SCR-16, gestur mobile, sheet kontekstual, panel Layer aksesibel.

## 5. Di luar scope (eksplisit)

- Hasil akhir, galeri, render export, unduh, Drive → **P08**.
- Snapshot dokumen ke object storage saat `FINAL` → disiapkan di P07 sebagai fungsi, dipicu dan diuji di P08 (DEC-060).
- Perubahan mode atau struktur layout (jumlah shot/binding) → terkunci (REQ-VOTE-06, DEC-065).
- Segmentasi/hapus latar (DEC-095), animasi/GIF (DEC-096).
- Peran host atau kunci eksklusif elemen dalam bentuk apa pun (REQ-EDIT-13, DEC-090).
- Moderasi konten teks/stiker.

## 6. ID requirement terkait

REQ-EDIT-01..14, REQ-ROOM-10, REQ-ROOM-11, REQ-MOB-04, REQ-MOB-06, REQ-MOB-07, REQ-FRAME-04 (collage), REQ-UI-01, NFR-01, NFR-04, NFR-06, DEC-031, DEC-032, DEC-033, DEC-039, DEC-049, DEC-055, DEC-059, DEC-071.

## 7. Referensi dokumentasi

- [11_COLLABORATIVE_EDITOR.md](../11_COLLABORATIVE_EDITOR.md) — seluruh dokumen.
- [14_DATA_MODEL_AND_EVENTS.md](../14_DATA_MODEL_AND_EVENTS.md) §8 (idempotensi, validasi), §9 (event editor).
- [10_FRAMES_CANVAS_LAYOUT.md](../10_FRAMES_CANVAS_LAYOUT.md) §4 (koordinat), §11 (transform), §13 (kompatibilitas render).
- [03_USER_FLOWS.md](../03_USER_FLOWS.md) F-14, F-17.
- [15_SECURITY_PRIVACY_LIFECYCLE.md](../15_SECURITY_PRIVACY_LIFECYCLE.md) §6, §14 (kontrol P07).
- [17_QA_TEST_PLAN.md](../17_QA_TEST_PLAN.md) §6.6.

## 8. Referensi visual yang disetujui

| Platform | File | Catatan |
|---|---|---|
| Desktop | `02_Desktop/07_Editor.webp` | Rail kiri 76 px, kanvas di `--sunk`, panel kanan 300 px (Stiker + Riwayat), toast konflik kiri atas, kontrol zoom bawah tengah, kursor berlabel aksi |
| Mobile | `03_Mobile/07_Editor.webp` | Kanvas fullscreen, overlay atas (Undo/Redo/avatar/Selesai), dock alat lipat, sheet teks (Serif/Tegas/Bulat + swatch) |
| Sistem | `01_Design_System/Brand_Identity.webp` | Toast "Balikin", chip status |

Stiker emoji di mockup bersifat placeholder visual. Aset final mengikuti DEC-055.

## 9. Tugas implementasi fungsional

1. Saat sesi masuk `EDITING`, semua peserta otomatis pindah ke SCR-16 dengan kanvas berisi foto accepted sesuai binding (11 §13).
2. Peserta bisa menambah stiker (klik/drag di desktop, tap di mobile → muncul di tengah viewport).
3. Peserta bisa menambah dan mengedit teks dengan 3 gaya (Serif, Tegas, Bulat) dan warna; double-click/double-tap untuk mengedit isi.
4. Peserta bisa mencoret dengan warna dan ketebalan; coretan live terlihat oleh peserta lain sebelum stroke selesai.
5. Peserta bisa memindah, mengubah ukuran, dan memutar elemen apa pun, termasuk foto.
6. Peserta bisa crop dan zoom foto di dalam slot, mengganti filter global atau per foto.
7. Peserta bisa mengubah urutan layer, menyembunyikan, menduplikasi, dan menghapus elemen.
8. Peserta bisa mengganti frame dari panel Frame (state `meta.frameRef`).
9. Undo/Redo hanya membatalkan operasi milik sendiri.
10. Panel Riwayat menampilkan langkah semua peserta; siapa pun bisa **Balikin** langkah mana pun dengan aturan konfirmasi 11 §7.2.
11. Penulis yang "kalah" dalam konflik menerima toast dengan **Balikin**; penghapusan saat sedang diedit menghasilkan toast yang bisa memulihkan elemen.
12. **Selesai edit** (desktop header, mobile overlay) mengirim `session.finalize` dengan konfirmasi ringan "Selesai buat semua?" (DEC-059).

## 10. Tugas implementasi teknis

| Modul (PROPOSED) | Tanggung jawab |
|---|---|
| `apps/web/src/features/editor/doc/schema.ts` | Tipe dokumen 11 §2–§3, konstanta batas (200 elemen, 256 KB update, 2 MB dokumen) |
| `apps/web/src/features/editor/doc/ops.ts` | Fungsi transaksi: `addSticker`, `addText`, `commitTransform`, `setCrop`, `setFilter`, `setZ`, `deleteElement`, `duplicate`, `commitDoodle` — semua dengan origin lokal |
| `apps/web/src/features/editor/doc/history.ts` | Penulisan `HistoryEntry` (gabung per elemen per 2 detik, FIFO 200), `revert(entryId)` dengan cek `after` vs state saat ini |
| `apps/web/src/features/editor/sync/provider.ts` | Bridge Yjs ↔ WebSocket room (`editor.sync`, `editor.update`, `editor.awareness`), antrean offline, resync via state vector |
| `apps/web/src/features/editor/conflict.ts` | `lastLocalWrite` 10 detik, deteksi update remote yang menimpa, agregasi toast (maks. 1/3 detik per elemen) |
| `apps/web/src/features/editor/canvas/*` | Komponen react-konva: layer statis (cache), layer elemen, layer overlay (kursor, soft-lock, transient) |
| `apps/web/src/features/editor/tools/*` | Alat Stiker, Teks, Coret (RDP simplification ≤ 2000 titik), Filter, Frame, Layer |
| `apps/web/src/features/editor/gestures.ts` | Pointer Events: drag, pinch, rotate (snap 0/90 ±4°), mode Coret (1 jari gambar, 2 jari pan/zoom) |
| `apps/realtime/src/room/editor.ts` | `Y.Doc` per sesi di actor, terapkan & relay update, validasi skema, snapshot Redis tiap 5 detik bila berubah, tolak update saat `CLOSED` (`READ_ONLY`) |
| `apps/realtime/src/room/editor-seed.ts` | Membuat elemen `photo` awal dari `acceptedAttemptId` + `Shot.slotOf` + BindingPlan saat masuk `EDITING` (`CELL`, `SHOT_GROUP`, `FREE`; 11 §13) |

Catatan teknis:

- Drag, resize, rotasi: posisi transient via awareness ≤ 20 Hz; **commit satu transaksi** saat pointer dilepas.
- `z` memakai fractional index (misal library `fractional-indexing`). Jangan memindah elemen di `Y.Array`.
- Teks: `content` sebagai `Y.Text`; render memakai font yang sudah termuat (`document.fonts.ready`).
- Doodle: titik di-encode (misal delta + base64) saat commit; immutable setelahnya.
- Editor di-lazy-load (Konva + Yjs) agar anggaran JS rute room tidak terlampaui (13 §14).
- Server memvalidasi: tipe elemen yang dikenal, angka finite dan dalam rentang, `assetId` ada di katalog, `attemptId` milik sesi ini dan `ACCEPTED` (TC-EDIT-022).

## 11. Dependensi data model & event

| Kebutuhan | Kontrak |
|---|---|
| Event editor | `editor.sync`, `editor.update`, `editor.awareness`, `session.finalize`, `session.reopen` (14 §9) |
| Model dokumen | 11 §2, §3; `HistoryEntry` 11 §7.2 |
| Attempt accepted | `Attempt`, `ShotParticipantState.acceptedAttemptId` (14 §7) |
| Error | `DOC_TOO_LARGE`, `READ_ONLY`, `INVALID_PATCH`, `SERVICE_UNAVAILABLE` (14 §8.3) |
| Signed URL foto | `asset.urls` (14 §10) |
| Reconnect | 14 §13 + state vector Yjs |

## 12. Requirement UI/UX

- Satu aksi utama per layar: **Selesai edit** (primary plum di desktop, `btn sm pri` di overlay mobile).
- Tool aktif di rail: latar `--lav`, teks `--plum` (05 §9).
- Tag `Bareng` di judul panel alat (semua alat editor bersifat bersama).
- Toast konflik: latar `--ink`, avatar pengubah, teks spesifik ("Raka mindahin teks yang barusan kamu atur"), tombol **Balikin** (05 §8, 8 detik karena ada aksi).
- Soft-lock: outline 1.5 px warna pemain + handle sudut putih ber-stroke warna pemain + avatar 18 px (05 §11).
- Kursor desktop dengan label aksi ("Raka · nempel stroberi"); kursor `aria-hidden`.
- Riwayat: "siapa aja bisa balikin", baris avatar + nama + aksi + waktu relatif.
- Copy Bahasa Indonesia santai; tidak ada teks yang menyiratkan ada host atau pemilik dokumen.

## 13. Pertimbangan desktop & mobile

| Aspek | Desktop | Mobile |
|---|---|---|
| Layout | Rail 76 px + kanvas + panel 300 px | Kanvas fullscreen, overlay atas, dock lipat |
| Pemilihan alat | Rail kiri | Dock mengambang (Stiker, Teks, Coret, Filter, Layer, chevron) |
| Properti elemen | Panel kanan / menu konteks | Sheet kontekstual sesuai tipe elemen (06 §6) |
| Presence | Kursor + label | Outline + avatar mini, tanpa kursor (REQ-ROOM-11) |
| Gestur | Mouse + shortcut (`Ctrl/Cmd+Z`, `Shift+Z`, `Ctrl/Cmd+D`, `Delete`, `[`/`]`) | Drag, pinch, rotate, double-tap, long-press menu (06 §8) |
| Keyboard virtual | — | Sheet teks naik via `visualViewport`; elemen teks tetap terlihat (06 §10) |
| Zoom tampilan | Kontrol `− 100% +` | Pinch di area kosong; tidak mengubah koordinat dokumen |
| Target performa | 60 fps drag | ≥ 30 fps drag HP menengah (TC-PERF-021) |

## 14. Pertimbangan keamanan & privasi

- Validasi skema update di server; update tidak valid ditolak dan klien mengirim ulang state penuh (15 §14 kontrol P07).
- Batas ukuran update 256 KB dan dokumen 2 MB (`DOC_TOO_LARGE`).
- Teks pengguna selalu dirender sebagai teks di canvas/DOM, tanpa HTML (TH-03, TC-SEC-020).
- `attemptId` di elemen `photo` harus milik room & sesi ini dan `ACCEPTED`; foto `REJECTED` tidak pernah masuk dokumen.
- Awareness tidak dipersist; dibuang saat peserta putus.
- Log server tidak memuat isi teks editor, nama, atau signed URL (NFR-09).
- Stiker: hanya aset dengan lisensi yang tercatat (DEC-055); simpan sumber/atribusi di metadata katalog.

## 15. Checklist tugas detail

- [ ] Skema dokumen & konstanta batas sesuai 11 §2–§4.
- [ ] Seed elemen `photo` dari foto accepted + BindingPlan (DEC-087) saat `EDITING` dimulai; diuji untuk kedua strategi dan Freeform.
- [ ] Bridge sync Yjs ↔ WebSocket dengan resync state vector dan antrean offline.
- [ ] Actor server: `Y.Doc` per sesi, relay, validasi skema, snapshot Redis 5 detik, `READ_ONLY` setelah `CLOSED`.
- [ ] Fungsi snapshot `encodeStateAsUpdate` untuk dipakai P08 saat `FINAL` (belum dipicu di P07).
- [ ] Alat Stiker (katalog + kategori chip), Teks (3 gaya + warna + ukuran), Coret (warna, ketebalan, RDP), Filter (6 preset 05 §12), Frame, Layer.
- [ ] Transform commit-on-release, transient via awareness ≤ 20 Hz.
- [ ] `z` fractional index + sort `z` lalu `elementId`.
- [ ] Undo/Redo pribadi (UndoManager, `captureTimeout` 500 ms, 100 langkah).
- [ ] Riwayat bersama + Balikin + konfirmasi bila elemen sudah diubah orang lain.
- [ ] Deteksi "kalah" + toast gabungan.
- [ ] Soft-lock (selection & dragging di awareness).
- [ ] Kursor editor dengan label aksi (desktop saja).
- [ ] Gestur mobile + mode Coret + sheet kontekstual + dock lipat.
- [ ] Panel Layer yang bisa dinavigasi keyboard (panah ±4 / Shift ±20, `[`/`]`, `Delete`).
- [ ] Banner "Editanmu disimpan dulu di perangkat" saat sinkronisasi terputus.
- [ ] Lazy-load bundle editor.
- [ ] Tes unit konvergensi + fuzz (TC-EDIT-020), tes E2E 4 konteks.

## 16. Checkpoint integrasi

| Checkpoint | Isi |
|---|---|
| Internal P07-a | Capture (P06) → `EDITING` → elemen foto muncul identik di 4 klien |
| Internal P07-b | Putus-sambung di tengah edit → dokumen konvergen tanpa kehilangan operasi yang sudah di-ack |
| Persiapan IC-5 | `session.finalize` terkirim dan semua klien menerima `session.state FINAL` (layar SCR-17 dikerjakan P08) |

## 17. Edge case

| Kasus | Perilaku |
|---|---|
| Dua orang menggeser elemen sama | Konvergen; yang kalah dapat toast (EC-08) |
| Hapus vs edit bersamaan | Hapus menang; toast Balikin memulihkan dari `before` di history |
| Dua orang mengetik di teks sama | `Y.Text` menggabungkan; outline kedua warna |
| Balikin entri yang elemennya sudah diubah lagi | Dialog konfirmasi 11 §7.2 |
| Peserta yang foto accepted-nya ada di kanvas sudah `LEFT` | Foto tetap, label nama dari snapshot attempt |
| Peserta join terlambat saat `EDITING` | Ikut mengedit (DEC-030) |
| Dokumen mendekati 200 elemen | Pesan "Kanvasnya udah penuh banget" dan aksi tambah ditolak |
| Font belum termuat | Render teks menunggu `document.fonts.ready` |
| `Selesai edit` ditekan dua orang bersamaan | Idempoten; satu transisi `FINAL` |

## 18. Skenario kegagalan

| Kegagalan | Penanganan |
|---|---|
| WebSocket putus | Operasi lokal tetap jalan dan diantre; banner offline; resync saat kembali |
| Server menolak update (skema) | Klien kirim ulang state penuh via sync; log error tanpa isi dokumen |
| Redis tidak tersedia | Relay tetap jalan; snapshot ditunda; alarm (13 §13) |
| Instance actor mati | Auto-restart lalu muat ulang dari snapshot Redis terakhir (DEC-088); klien resync, operasi lokal yang belum ter-snapshot dikirim ulang dari klien |
| Gambar foto gagal dimuat | Placeholder netral + **Coba lagi** (minta ulang signed URL) |
| Memori rendah di HP | Turunkan resolusi preview foto di editor; cache layer statis |

## 19. Acceptance criteria

| # | Kriteria | Tes |
|---|---|---|
| AC-1 | Stiker yang ditambah satu peserta tampil di 3 klien lain ≤ 500 ms (p95, jaringan normal) | TC-EDIT-001 |
| AC-2 | Semua operasi (move, resize, rotate, crop, zoom, filter, teks, doodle, layer) tersinkron dan bertahan setelah reload | TC-EDIT-002 |
| AC-3 | Geser bersamaan menghasilkan state identik di semua klien + toast ke penulis yang kalah | TC-EDIT-010 |
| AC-4 | Hapus vs edit: elemen terhapus dan bisa dipulihkan lewat Balikin | TC-EDIT-011 |
| AC-5 | Undo hanya membatalkan operasi sendiri | TC-EDIT-012 |
| AC-6 | Balikin oleh peserta lain mengembalikan properti dan menambah entri baru | TC-EDIT-013 |
| AC-7 | Fuzz 4 klien × 500 operasi + putus-sambung konvergen | TC-EDIT-020 |
| AC-8 | Update dengan `attemptId` non-accepted ditolak | TC-EDIT-022 |
| AC-9 | Gestur mobile bekerja tanpa scroll halaman | TC-EDIT-021 |
| AC-10 | Tidak ada aksi editor yang terbatas pada pembuat room | TC-ROOM-010 |
| AC-11 | 0 pelanggaran axe serious/critical di SCR-16; panel Layer bisa dipakai keyboard | TC-A11Y-001, TC-A11Y-002 |

## 20. Checklist pengujian

- [ ] Unit: ops, history/revert, conflict detection, fractional index, validasi skema server.
- [ ] Unit: fuzz konvergensi (simulasi beberapa `Y.Doc` dengan urutan update acak).
- [ ] Integrasi: actor + Redis snapshot + resume.
- [ ] E2E Playwright 4 konteks: TC-EDIT-001, -002, -010..013, -022.
- [ ] Perangkat nyata: TC-EDIT-021, TC-PERF-021 (iOS Safari + Android Chrome).
- [ ] Aksesibilitas: TC-A11Y-001, -002 untuk SCR-16.
- [ ] Usability awal TC-UX-010 (boleh dijalankan ulang di P10).

Perintah verifikasi yang disarankan (dijalankan pengguna atau atas izin eksplisitnya): `pnpm test --filter editor`, `pnpm test:integration --filter realtime`, `pnpm test:e2e editor`. Agen **tidak** menjalankan typecheck/lint/build penuh, commit, push, atau deploy tanpa instruksi pengguna, dan tidak pernah mengarang hasil tes.

## 21. Definition of Done

- [ ] Semua item §15 selesai dengan bukti (file/komponen yang diubah).
- [ ] AC-1..AC-11 terverifikasi; tes D/M dicatat siapa, perangkat, tanggal.
- [ ] Tidak ada mock: foto berasal dari attempt accepted nyata, sinkronisasi lewat server nyata.
- [ ] Desktop dan mobile SCR-16 direview terhadap `07_Editor.webp` (desktop & mobile).
- [ ] Status DEC-055 dicatat di handoff (final atau masih sementara).
- [ ] Handoff §24 terisi lengkap.

## 22. Deliverable

- Modul editor klien (dokumen, sync, kanvas, alat, gestur, konflik, riwayat).
- Modul editor di room actor (Y.Doc per sesi, validasi, snapshot).
- SCR-16 desktop & mobile sesuai V1.
- Katalog stiker sementara + metadata lisensi.
- Tes unit, integrasi, E2E, dan catatan tes perangkat.

## 23. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| RK-07 konflik membingungkan pemula | Toast spesifik + Balikin, soft-lock, uji TC-UX-010 lebih awal |
| RK-09 lisensi stiker belum final | Pakai set sementara berlisensi jelas; DEC-055 harus final sebelum rilis publik |
| Performa kanvas di HP | Cache layer statis, preview foto ≤ 1600 px, lazy-load |
| Ukuran dokumen membengkak (doodle) | RDP, batas titik, batas dokumen 2 MB |
| Revert dari history merusak elemen yang sudah berubah | Cek `after` vs state saat ini + konfirmasi |
| RK-03 default binding (DEC-061) berubah | Seed elemen foto dibaca dari BindingPlan, bukan hardcode; tes mencakup kedua strategi |

## 24. Handoff ke fase berikutnya

P08 membutuhkan: transisi `FINAL` yang andal, fungsi snapshot dokumen, dan scene yang bisa dirender ulang dari snapshot + foto asli.

```text
## Handoff P07 → P08
Tanggal / agen:
Status fase: READY FOR REVIEW | DONE

### Pekerjaan selesai
- ...

### Komponen/file yang diubah
- ...

### Keputusan teknis penting (rujuk DEC-xxx; tandai yang masih PROPOSED)
- DEC-031 / DEC-032 / DEC-033 / DEC-055: ...

### Tes yang sudah dijalankan (ID, hasil, bukti, perangkat)
- TC-EDIT-...: PASS/FAIL — bukti: ...

### Tes yang BELUM dijalankan (dan alasannya)
- ...

### Masalah yang diketahui
- ...

### Risiko yang masih terbuka
- ...

### Kesiapan untuk P08
- [ ] session.finalize & session.state FINAL berfungsi
- [ ] Fungsi snapshot dokumen tersedia
- [ ] Render scene dari snapshot konsisten dengan tampilan editor
```
