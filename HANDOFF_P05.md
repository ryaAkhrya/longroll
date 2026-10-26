### HANDOFF P05 → P06

**Status fase:** READY FOR REVIEW (gate otomatis lulus; review visual SCR-10/11/12 & uji perangkat nyata belum).

#### Completed work
- **Model & engine (shared `packages/shared/src/studio/`)**
  - `types.ts`: `StudioState`, `LayoutSpec`, `LayoutSlot`, `SlotBinding` (CELL / SHOT_GROUP / FREE), `BindingStrategy`, `FrameTemplate`, `FrameRef`, `StudioPatch`.
  - `limits.ts`: safeguard DEC-042 & batas frame DEC-041/067 di satu modul.
  - `generate.ts`: generator BindingPlan untuk kedua strategi di Strip/Group/Grid + FREEFORM (Collage), 1–8 shot × 1–4 peserta; pelanggaran → `violation` + alternatif (tanpa pemotongan diam-diam); peringatan kualitas (cell kecil / > 16 foto).
  - `validate.ts`: validator bersama (NaN, ≥ 60 px, ≥ 50 % di kanvas, konsistensi binding, cakupan shot/cell).
  - `adapt.ts`: FIXED/CONTAIN/COVER/NINE_SLICE/PATTERN sebagai operasi `drawImage` dengan skala seragam; peringatan crop > 15 % & upscale > 1.25×.
  - `patch.ts`: `applyStudioPatch` (LWW per field + `overwrote`), `revertStudio` (Balikin satu langkah), `regenerateForParticipants`, `lockStudioStructure`.
  - `scene.ts`: satu definisi scene untuk pratinjau (dan export P08).
  - `frames.ts`: 7 frame bawaan parametrik orisinal (6 kategori V1 + Linen fallback), provenance di `license.source`.
- **Server**
  - `studio.update` / `studio.revert`, error `NOT_IN_STUDIO` / `MODE_LOCKED` / `STRUCTURE_LOCKED` / `INVALID_PATCH` (+ `reason`/`detail` di ack).
  - Event `studio.updated` & `frame.added`.
  - Plan dibangkitkan ulang saat peserta berubah sebelum shot 1.
  - `actor.lockStudioStructure()` disiapkan untuk P06.
  - Upload frame: presign → PUT → complete.
    - Validasi: magic bytes, dimensi & piksel dari header sebelum decode, tolak APNG/WebP animasi, sharp `limitInputPixels`.
    - Re-encode PNG (tanpa metadata), deteksi lubang alpha.
    - Kuota 20/room, 20 upload/jam/peserta.
    - Signed URL ≤ 10 menit, sweeper upload PENDING.
  - Storage: `ObjectStorage` diperluas.
    - Adapter memori/folder dengan URL HMAC (`/api/storage/…`).
    - Adapter S3-compatible (`S3_*`); produksi menolak start tanpa S3.
- **Web**
  - `StudioCanvas`: Konva bawah (latar + placeholder) → video DOM di slot (filter grup + framing pemilik) → Konva atas (overlay frame, dekor, edit slot drag/resize/snapping ≤ 6 px + garis panduan).
  - Panel Frame (SCR-09: pratinjau lokal, presence "lagi lihat", Pasang buat semua), Upload (SCR-10), Layout (SCR-11, safeguard + alternatif, kunci struktur), Kameraku (SCR-12), Filter.
  - Toast "{nama} {aksi} · Balikin".
  - Mobile: dock Timer/shutter nonaktif + Alat → sheet tanpa scrim, landscape dock kanan.
  - CSP `img-src`/`connect-src` untuk origin realtime/storage.
- **Migrasi:** `db/migrations/0004_p05_frames.sql` (`lr_frames` + GRANT DML ke `longroll_app`), diterapkan di Neon `development` saja.

#### Technical decisions
- **DEC-061: OPEN.** Default SEMENTARA di `STUDIO_MODE_DEFAULTS`: Strip & Group = `PER_SHOT_GROUP`, Grid = `PER_PARTICIPANT_SHOT`, Collage = `FREEFORM`. Kedua strategi tersedia di Layout ("Foto bareng per shot" / "Foto per orang") sampai shot 1; tidak ada strategi yang di-hardcode.
- **DEC-087:** binding sebagai data.
- **DEC-042:** angka tidak diturunkan.
- **DEC-065:** struktur (shot, strategi, susunan, rasio, output, slot) terkunci via `structureLocked`.
- **DEC-039:** Konva dipakai.
- **DEC-062:** BLEND = tumpang tindih 12 % + masker, tanpa segmentasi.
- Frame bawaan **parametrik** (bukan raster), jadi tidak ada aset statis yang bisa gagal; Linen = fallback.
- Penyimpangan endpoint: signed URL baca lewat `GET /api/rooms/{code}/frames/{id}/url` (bukan WS `asset.urls`).
- **Object storage:** Neon Object Storage aktif di branch dev tetapi belum ada bucket/kredensial. Membuatnya = membuat kredensial cloud baru, jadi tidak dilakukan otomatis. Dev/E2E memakai storage memori; adapter S3 belum diverifikasi terhadap bucket nyata.

#### Tests performed

| Tes | Hasil |
|---|---|
| Unit shared: TC-FRAME-005 (semua mode × strategi × susunan × 1–8 shot × 1–4 peserta), TC-FRAME-006, TC-FRAME-007, TC-FRAME-020/021 (rasio sumbu identik), 9-slice tanpa celah, validator, patch/LWW/Balikin, scene | 58 lulus |
| Unit realtime: studio actor (sinkron identik, MODE_LOCKED/INVALID_PATCH/STRUCTURE_LOCKED, LWW bersamaan, regenerasi saat join/leave, restart), TC-SEC-012; pipeline frame (valid + 4 lubang, metadata dibuang, WebP, SVG/JPEG menyamar, bomb 30000² ditolak dari header < 2 s, APNG/WebP animasi, dimensi, rusak, > 10 MB) | 68 lulus |
| Integrasi HTTP/WS: upload end-to-end + `frame.added` + signed URL/token palsu, 413 presign & body > deklarasi, SVG/bomb, Content-Type salah, kuota & rate limit, FIXED berlubang + room bubar → objek & baris bersih; PostgreSQL Neon dev: studio + `lr_frames` simpan/muat/cascade | 22/22 |
| E2E Chrome 4 konteks, **kamera palsu Chromium**: feed live di slot, pratinjau lokal tidak mengubah klien lain, presence "lagi lihat", Pasang buat semua (≤ 1 s di 2 klien yang diukur), toast + Balikin, filter, shot/strategi/safeguard 9 shot + alternatif, upload frame 4 lubang → alasan "butuh 8" + "Pakai 4 shot", > 10 MB, reload; mobile 390 px dock + sheet | lulus |

| Regresi terintegrasi P01–P05 (`e2e/regression.spec.ts`) + seluruh suite E2E (camera, room, voting, studio, regression) | 8/8 (7,5 menit); data Neon dev setelahnya 0 room/peserta/sesi/frame/event |

#### Tests NOT yet performed
- AC-P05-9 / TC-PERF-020: ≥ 24 fps di HP menengah.
- Gestur pinch/drag di iOS/Android.
- Safari/Firefox.
- Axe-core panel stage.
- Adapter S3 terhadap bucket nyata.
- Review visual manusia SCR-10/11/12 (DERIVED).

#### Known issues
- E2E 4 konteks berat di satu mesin (banyak `<video>`); durasi 1,5–4 menit.
- Pratinjau strategi per orang 32 cell = 32 elemen video.
- Header panel di sheet mobile (Bareng/Upload) perlu dicek visual di perangkat.

#### Outstanding risks
- DEC-061 belum dijawab.
- Storage produksi (bucket + kredensial) belum ada.
- Moderasi konten frame upload (15 §9).

#### Readiness for P06
**YA** — struktur bisa dikunci (`lockStudioStructure`), BindingPlan + `bindingStrategy` per sesi tersedia, `cameraPresentation` siap diterapkan pada frame penuh, slot scene siap menampilkan foto accepted.
