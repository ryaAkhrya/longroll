### Handoff P07 → P08

**Status:** gate non-browser lulus (typecheck, lint, unit, integrasi + Neon dev, build). **Browser E2E TIDAK dijalankan (diminta) → AC yang butuh browser/perangkat = NOT VERIFIED.** Render kanvas Konva dan gestur sentuh belum pernah dijalankan di browser.

#### Implemented
- **Shared `editor/`:** `schema.ts` (batas: 200 elemen, update ≤256 KB, dokumen ≤2 MB, riwayat 200, doodle ≤2000 titik; katalog 16 stiker SVG orisinal — DEC-055 tetap SEMENTARA, lisensi di metadata), `doc.ts` (operasi = 1 transaksi + entri riwayat bersama, z fractional-indexing, `Y.Text` untuk teks, Balikin per entri dengan cek `after` vs state sekarang, UndoManager hanya origin sendiri, RDP + encode doodle, `seedDocument` dari foto accepted + BindingPlan (CELL / SHOT_GROUP / FREE, kedua strategi), `snapshotDoc` untuk P08), `validate.ts` (skema, rentang angka, key asing ditolak, katalog stiker, `photo` hanya untuk attempt accepted milik peserta, imutabilitas foto sumber/kanvas, batas jumlah & ukuran, **update dengan celah dependensi ditolak** — tanpa ini isi menggantung bisa lolos validasi).
- **Server:** `EditorHub` per room actor (`Y.Doc` per sesi): `editor.sync` (state vector dua langkah), `editor.update` (validasi di probe → terapkan → relay), `editor.awareness` (volatile, identitas dari server, ≤4 KB, tak disimpan), `editor.reset` (pengirim ditolak → state penuh), seed deterministik saat sesi `EDITING` (clientID tetap → seed ganda tidak menduplikasi), snapshot PostgreSQL ≤ 1× / 5 detik hanya bila berubah, flush saat FINAL, `session.finalize` / `session.reopen` (siapa pun, idempoten), `READ_ONLY` di luar EDITING, `DOC_TOO_LARGE`. WS: `editor.*` boleh sampai 400 KB, tipe lain tetap 64 KB.
- **P06 tambahan untuk editor:** varian `edit.jpg` (≤1600 px) dibuat server saat full diverifikasi (`/attempts/{id}/url?part=edit`); ikut purge, kuota, cleanup room.
- **Web:** `EditorSession` (sync, antrean offline lewat state vector, reset, awareness 20 Hz, deteksi konflik), `EditorCanvas` (Konva: Background → foto → frame overlay + dekor → stiker/teks/coret → kursor/outline/coretan live; commit saat dilepas; Transformer; rotasi snap 0/90 ±4°; pinch/rotate 2 jari; zoom tampilan), panel Stiker/Teks/Coret/Filter/Frame/Layer(keyboard)/Riwayat/Properti (zoom+geser crop, teks via `Y.Text`), Undo/Redo + pintasan (`Ctrl/Cmd+Z`, `Shift+Z`, `Ctrl/Cmd+D`, `Delete`, `[`, `]`), toast konflik + Balikin, konfirmasi Selesai & Balikin, banner offline, dock lipat + sheet kontekstual mobile. Editor di-lazy-load.
- **Migrasi:** `0006_p07_editor_docs.sql` (`lr_editor_docs`, SELECT/INSERT/UPDATE untuk `longroll_app`) diterapkan di `development` (project `hidden-glade-82216110`, branch `br-quiet-dust-azdjpq7u`), production tidak disentuh.

#### Tests
| Tes | Hasil |
|---|---|
| Shared (21 baru): seed semua mode/strategi, ops/riwayat/Balikin/undo pribadi, konvergensi (konflik geser, hapus vs edit, teks), **fuzz 4 klien × 500 operasi × 3 seed + partisi/urutan acak**, validasi server (TC-EDIT-022), batas ukuran | 86 total |
| Realtime unit (14 baru): seed saat EDITING, relay, throttle snapshot, offline-merge, restart, update ditolak + reset, AC-8 foto REJECTED/palsu/tukar sumber, update celah, READ_ONLY/finalize/reopen, awareness, integritas data P06 | 108 total |
| Integrasi WS+HTTP (3 baru) + Neon dev (1 baru, termasuk CHECK ukuran & cascade) | 29 total |
| Web unit (11 baru): ConflictTracker, EditorSession (sync/offline/reset/readonly/konflik/StrictMode), Layer keyboard, Riwayat, Properti | 42 total |
| Typecheck / lint / build | lulus |

#### NOT VERIFIED
- AC-1 (≤500 ms p95 di jaringan nyata; hanya loopback), AC-9 (gestur mobile tanpa scroll halaman), AC-11 (axe), TC-PERF-021 (≥30 fps HP), usability TC-UX-010, E2E 4 konteks, review visual terhadap `07_Editor.webp`, hasil render frame/overlay di Konva.
- Kursor remote hanya desktop (REQ-ROOM-11); label aksi kursor ("nempel stroberi") belum otomatis — hanya nama peserta + tool.

#### Keputusan
DEC-031 Yjs dipakai; DEC-032 undo pribadi + Balikin bersama; DEC-033 soft-lock via awareness; DEC-055 set stiker sementara (belum final, orisinal); DEC-059 Selesai edit oleh siapa pun. Stiker/teks/doodle selalu di atas frame; foto selalu di bawah frame (layer dikelompokkan, bukan satu z global). Foto sumber tidak bisa diganti/digandakan; boleh disembunyikan/dihapus/di-Balikin.

#### Untuk P08
`session.finalize` → `FINAL` berfungsi; `actor.editor.snapshot(sessionId)` mengembalikan `Y.encodeStateAsUpdate`; `docFromSnapshot` + `listElements` + `readMeta` membangun scene ulang; foto resolusi penuh via `/attempts/{id}/url?part=full` (dibuka untuk semua peserta setelah shot DONE).
