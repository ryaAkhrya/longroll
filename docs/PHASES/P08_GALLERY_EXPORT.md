# P08 — Gallery, Multi-Session & Export

| Atribut | Nilai |
|---|---|
| Dokumen | `PHASES/P08_GALLERY_EXPORT.md` |
| Versi | 1.1.0 |
| Status fase | NOT STARTED |
| Bergantung pada | P07 (editor, `session.finalize`, snapshot dokumen), P04 (voting & model sesi) |
| Dokumen wajib dibaca | [12_GALLERY_AND_EXPORT.md](../12_GALLERY_AND_EXPORT.md), [08_VOTING_AND_SESSIONS.md](../08_VOTING_AND_SESSIONS.md) §8, [14_DATA_MODEL_AND_EVENTS.md](../14_DATA_MODEL_AND_EVENTS.md) §10–§11, [04_SCREEN_SPECIFICATIONS.md](../04_SCREEN_SPECIFICATIONS.md) SCR-17..19, [06_RESPONSIVE_MOBILE_UX.md](../06_RESPONSIVE_MOBILE_UX.md) §9, [15_SECURITY_PRIVACY_LIFECYCLE.md](../15_SECURITY_PRIVACY_LIFECYCLE.md) §10–§11 |

## 1. Identitas & tujuan fase

Menutup siklus sesi: finalisasi hasil (DEC-059/060), Hasil akhir & export (SCR-17), galeri sementara room (SCR-18), ajakan sesi baru (SCR-19), unduhan per platform, dan simpan ke Google Drive pribadi (DEC-040). Setelah fase ini, alur F-01..F-19 bisa dijalankan end-to-end: **M3 — MVP fitur lengkap**.

## 2. Prasyarat & dependensi

| Prasyarat | Sumber |
|---|---|
| `session.finalize` / `session.reopen` di editor | P07 |
| Fungsi snapshot `Y.Doc` dan render scene dari snapshot | P07, DEC-039 |
| Attempt accepted full-res di storage + `asset.urls` | P06, 14 §10 |
| Model sesi, `session.create`, voting ulang | P04 |
| Google Cloud project + OAuth client (origin dev/staging terdaftar) | Disiapkan pengguna di awal P08 |
| Library zip streaming (untuk DEC-045, P2) disetujui | 13 (dependensi baru wajib disebut di handoff) |

## 3. Kondisi awal yang diharapkan

- Sesi bisa mencapai `FINAL`, tapi SCR-17/18/19 belum ada (dibangun di fase ini; v1.1 P01 tidak membuat shell layar).
- Belum ada `SessionResult`, preview hasil, atau pipeline export.
- Belum ada integrasi Google Identity Services.

## 4. Requirement dalam scope

- `SessionResult` dibuat/diperbarui saat finalisasi; klien yang memfinalisasi merender preview ≤ 1600 px dan mengunggahnya; fallback round-robin jika gagal dalam 30 detik (12 §2, DEC-060).
- Snapshot dokumen ke object storage saat `FINAL` (11 §8).
- SCR-17: pratinjau, format PNG/JPG, preset ukuran (safeguard DEC-042, sisi terpanjang ≤ 8192 px), **Unduh**, **Simpan ke Google Drive**, **Balik edit**, **Ke galeri**, **Sesi baru**.
- Render export di klien dengan skala seragam, tiling bila total > 16 juta piksel atau sisi > 4096 px, mendukung plan hingga 32 photo cell (TC-EXP-012), peringatan kualitas cell < 240 px, font & filter identik dengan pratinjau (12 §4, 10 §13).
- Unduh per platform: desktop `<a download>`, Android, iOS lewat `navigator.share({files})` + fallback (12 §5).
- Google Drive: GIS token model, scope `drive.file`, token hanya di memori tab, multipart/resumable upload, folder "LONGROLL" buatan aplikasi, revoke (12 §6).
- SCR-18 galeri sementara: banner retensi, filter `Semua`/per sesi/`Per orang` (accepted saja, DEC-047), kartu hasil dengan aksi.
- Multi-sesi: `session.create` oleh siapa pun, sesi lama `CLOSED`, ajakan SCR-19 (DEC-063), batas 20 sesi (DEC-053).
- Konfirmasi keluar ketika peserta terakhir + **Unduh semua dulu** (DEC-057).
- **Unduh semua (.zip)** (DEC-045, P2 — boleh ditunda jika memori iOS tidak memadai, dicatat di handoff).

## 5. Di luar scope (eksplisit)

- Aksi membatalkan sesi yang sedang berjalan: belum ada di brief (OPEN QUESTION [DEC-086](../18_DECISIONS_AND_OPEN_QUESTIONS.md)). Default: tidak dibuat.

- **Tidak ada** galeri, filter, section, route, atau field API untuk take gagal (REQ-GAL-07, REQ-GAL-08, DEC-092).
- Render export di server (DEC-060: klien).
- Berbagi link publik ke hasil (tidak ada di brief).
- Penghapusan file di perangkat pengguna atau di Google Drive. Sistem tidak menyentuhnya (REQ-LIFE-06).
- Hardening cleanup storage menyeluruh → P09 (cleanup dasar sudah ada sejak P02).
- Akun LONGROLL dalam bentuk apa pun; login Google hanya untuk Drive (DEC-094).

## 6. ID requirement terkait

REQ-GAL-01..08, REQ-EXP-01..05, REQ-LIFE-05, REQ-LIFE-06, REQ-LIFE-07, REQ-VOTE-08, REQ-MOB-01, REQ-MOB-04, REQ-MOB-12, NFR-07, NFR-12, DEC-040, DEC-042, DEC-045, DEC-047, DEC-053, DEC-057, DEC-059, DEC-060, DEC-063.

## 7. Referensi dokumentasi

- [12_GALLERY_AND_EXPORT.md](../12_GALLERY_AND_EXPORT.md) — seluruh dokumen.
- [08_VOTING_AND_SESSIONS.md](../08_VOTING_AND_SESSIONS.md) §8.3–§8.4 (finalisasi, sesi baru).
- [10_FRAMES_CANVAS_LAYOUT.md](../10_FRAMES_CANVAS_LAYOUT.md) §4, §10, §13 (skala, peringatan kualitas, kompatibilitas render).
- [03_USER_FLOWS.md](../03_USER_FLOWS.md) F-15, F-16, F-18.
- [15_SECURITY_PRIVACY_LIFECYCLE.md](../15_SECURITY_PRIVACY_LIFECYCLE.md) §5.2 (signed URL), §10 (Google), §11 (copy).

## 8. Referensi visual yang disetujui

| Platform | File | Catatan |
|---|---|---|
| Desktop | `02_Desktop/08_Gallery.webp` | Judul "Galeri *malam ini.*", **Unduh semua (.zip)** + **Sesi baru**, banner retensi butter, chip filter, grid kartu hasil, section **Per orang · sesi 1** |
| Mobile | `03_Mobile/08_Gallery.webp` | Masonry 2 kolom, banner ringkas, kartu "Per orang · 16 foto", bar bawah Unduh semua + Sesi baru |
| — | SCR-17, SCR-19 | `DERIVED`: tidak ada di V1; desain diturunkan dari 05 dan **harus direview visual** sebelum fase ditutup |

## 9. Tugas implementasi fungsional

1. Siapa pun menekan **Selesai edit** → semua peserta melihat SCR-17 dengan banner "Diselesaikan oleh {nama}".
2. **Balik edit** oleh siapa pun mengembalikan semua ke SCR-16 sampai sesi baru dibuat.
3. Pengguna memilih PNG/JPG dan preset ukuran; **Unduh** menghasilkan file dengan nama `LONGROLL_{CODE}_sesi{n}_{YYYY-MM-DD}.{ext}`.
4. Progress render tampil untuk ukuran besar ("Nyetak versi Cetak 300 dpi… 58%").
5. Peringatan kualitas jika ada aset yang perlu diperbesar > 1.25× (NFR-12).
6. **Simpan ke Google Drive** membuka consent Google, mengunggah ke folder LONGROLL, lalu menampilkan toast dengan nama file + **Buka**.
7. Galeri menampilkan semua sesi `FINAL`/`CLOSED` urut waktu dengan aksi unduh, Drive, dan layar penuh.
8. Filter **Per orang** menampilkan hanya foto `ACCEPTED` per peserta per sesi.
9. **Sesi baru** oleh siapa pun membuat sesi `VOTING` baru; peserta lain melihat SCR-19 dengan **Ikut, ayo vote** / **Bentar** dan banner "Sesi {n} lagi vote · Gabung".
10. Saat sesi ke-20 tercapai, **Sesi baru** dinonaktifkan dengan pesan 12 §8.
11. Peserta terakhir yang keluar mendapat peringatan + **Unduh semua dulu** (DEC-057).

## 10. Tugas implementasi teknis

| Modul (PROPOSED) | Tanggung jawab |
|---|---|
| `apps/realtime/src/room/finalize.ts` | `session.finalize/reopen`, buat/update `SessionResult`, minta render (`result.render.request`), fallback round-robin 30 detik, simpan snapshot dokumen ke `rooms/{roomId}/sessions/{sessionId}/doc.bin` |
| `apps/realtime/src/room/gallery.ts` | `gallery.get` → `GalleryView` (filter attempt `ACCEPTED` saja, **tanpa field rejected**), `asset.urls` (hanya key room ini, TTL ≤ 10 menit) |
| `apps/realtime/src/room/sessions.ts` | `session.create` (tutup sesi aktif, batas 20, `session.invite`) |
| `apps/web/src/features/export/render.ts` | Bangun scene Konva offscreen dari snapshot + foto full-res; `pixelRatio` = skala export; tiling bila total > 16 juta piksel atau sisi > 4096 px; `ImageBitmap.close()` |
| `apps/web/src/features/export/encode.ts` | PNG (opsional chunk `pHYs` 300 dpi untuk preset cetak) & JPEG 0.92, tanpa EXIF |
| `apps/web/src/features/export/download.ts` | Deteksi kemampuan: `<a download>`, `navigator.canShare({files})`, fallback tab baru + instruksi |
| `apps/web/src/features/export/drive.ts` | Lazy-load GIS, `initTokenClient` scope `drive.file`, token di memori modul saja, folder LONGROLL (ID di localStorage sebagai preferensi lokal), multipart < 5 MB / resumable ≥ 5 MB, retry, revoke |
| `apps/web/src/features/export/zip.ts` | (P2, DEC-045) render per sesi berurutan + zip streaming dengan batas memori |
| `apps/web/src/features/gallery/*` | SCR-18 desktop/mobile, SCR-19, SCR-17 |

Catatan:

- Render export memakai fungsi render scene yang sama dengan editor (tidak boleh ada jalur render kedua yang hasilnya berbeda).
- Signed URL diambil ulang otomatis jika sudah kedaluwarsa saat render.
- Bucket harus mengizinkan CORS `GET` dari origin aplikasi supaya canvas tidak "tainted".

## 11. Dependensi data model & event

| Kebutuhan | Kontrak |
|---|---|
| Hasil sesi | `SessionResult` (12 §2, 14 §10) |
| Galeri | `GalleryView`, `gallery.get`, `gallery.view`, `asset.urls` (14 §10) |
| Finalisasi | `session.finalize`, `session.reopen`, `result.preview.uploaded` (14 §9) |
| Sesi baru | `session.create`, `session.invite`, `session.state` (14 §6) |
| Aset sementara | `TempAsset` kinds `result_preview`, `doc_snapshot` (14 §11) |
| Error | `SESSION_LIMIT`, `SESSION_ACTIVE_NOT_FINAL`, `READ_ONLY`, `ROOM_STORAGE_LIMIT` |

## 12. Requirement UI/UX

- Banner retensi galeri memakai copy 12 §1 apa adanya. Copy ini akurat dan tidak menyiratkan file unduhan/Drive ikut terhapus.
- Copy dilarang (15 §11): "Gak ada yang disimpan di server", "end-to-end encrypted", "semua jejak hilang".
- SCR-17 satu aksi utama: **Unduh** (primary XL). Drive adalah tombol sekunder.
- Error Drive memakai teks 12 §6 (popup diblokir, consent ditolak, Drive penuh, token kedaluwarsa).
- Kartu galeri: latar tint per mode, `srcset` 400/800/1600.
- Tidak ada elemen UI yang menampilkan atau menyebut attempt yang ditolak di galeri.

## 13. Pertimbangan desktop & mobile

| Aspek | Desktop | Mobile |
|---|---|---|
| SCR-17 | 2 kolom: hasil + panel 420 px | Hasil di atas + bottom sheet 330 px |
| Unduh | `<a download>` + toast "Tersimpan di Unduhan" | Android: download/share; iOS: share sheet → "Simpan Gambar"; fallback tab baru + "Tekan lama → Simpan ke Foto" |
| Drive | Popup dari klik | Popup harus dipicu langsung dari tap (06 §9) |
| Galeri | Grid 4 kolom, aksi saat hover | Masonry 2 kolom, tap → layar penuh + sheet aksi |
| Sesi baru | Modal SCR-19 | Bottom sheet SCR-19 |
| Memori export | Ukuran besar aman | Tiling; fallback "Ukuran ini kebesaran buat perangkatmu. Coba 'Asli'?" (RK-04) |
| Unduh semua (.zip) | Didukung | Batasi; di iOS lewat share sheet ke Files; boleh dinonaktifkan dengan pesan jika memori tidak cukup |

## 14. Pertimbangan keamanan & privasi

- Token Google hanya di memori tab; tidak pernah dikirim ke backend LONGROLL (TC-EXP-022). Tidak disimpan di localStorage.
- Scope hanya `https://www.googleapis.com/auth/drive.file` (DEC-040). Tombol "Putuskan Google Drive" memanggil revoke.
- Signed URL galeri berumur ≤ 10 menit, hanya untuk key `rooms/{roomId}/` milik token peminta (TC-SEC-018).
- `GalleryView` di server difilter berdasarkan `ACCEPTED`; filter UI saja tidak cukup (TC-GAL-005).
- Preview hasil yang diunggah klien divalidasi: content-type WebP, ≤ 1 MB, `HEAD` setelah upload (15 §7).
- File export tanpa EXIF lokasi/perangkat.
- Log tidak memuat signed URL, nama, atau token (NFR-09).

## 15. Checklist tugas detail

- [ ] `session.finalize` → `SessionResult` + permintaan render + snapshot dokumen ke storage.
- [ ] Fallback render round-robin bila preview tidak terunggah dalam 30 detik.
- [ ] `session.reopen` (Balik edit) dan pembaruan entri galeri saat finalisasi ulang.
- [ ] Pipeline render export (scene sama, skala seragam, tiling, font ready, filter identik).
- [ ] Encode PNG/JPEG + penamaan file.
- [ ] Peringatan kualitas > 1.25×.
- [ ] Download desktop/Android/iOS + fallback.
- [ ] Integrasi Drive (token memori, folder app, multipart/resumable, error handling, revoke).
- [ ] `gallery.get` server-side filter accepted; `asset.urls` terbatas room.
- [ ] SCR-18 desktop & mobile sesuai V1 tanpa filter take gagal.
- [ ] SCR-17 & SCR-19 (DERIVED) + review visual.
- [ ] `session.create` + `session.invite` + banner gabung + batas 20 sesi.
- [ ] Konfirmasi keluar peserta terakhir (DEC-057).
- [ ] (P2) Unduh semua (.zip).
- [ ] Tes golden image export.

## 16. Checkpoint integrasi

| Checkpoint | Isi |
|---|---|
| **IC-5** | Editor → finalisasi → galeri → export (unduh + Drive) → sesi baru → voting, dengan 4 peserta |
| Internal P08-a | Room expired setelah P08 tetap terhapus bersih termasuk `result_preview` dan `doc_snapshot` (TC-SEC-030) |

## 17. Edge case

| Kasus | Perilaku |
|---|---|
| Dua orang finalisasi bersamaan | Idempoten, satu `SessionResult` |
| Klien finalisasi putus sebelum upload preview | Fallback round-robin; kartu galeri menampilkan "Lagi nyiapin pratinjau…" |
| Balik edit setelah sebagian peserta sudah unduh | Diizinkan; file yang sudah diunduh tidak berubah |
| Sesi baru saat peserta lain masih di SCR-17 | Mereka menerima SCR-19; "Bentar" tetap di layar |
| Peserta di galeri tanpa koneksi | Kartu memakai preview yang sudah termuat; aksi export menunggu koneksi untuk signed URL |
| Peserta yang foto-nya ada di hasil sudah `LEFT` | Nama dari snapshot `participantNameAtCapture` |
| Room kedaluwarsa saat export berjalan | Render berbasis aset yang sudah diunduh boleh selesai; aksi baru menampilkan SCR-21 |
| Sesi ke-21 | `SESSION_LIMIT` + pesan 12 §8 |

## 18. Skenario kegagalan

| Kegagalan | Penanganan |
|---|---|
| Kehabisan memori saat render | Tangkap error → tawarkan preset lebih kecil |
| Signed URL kedaluwarsa di tengah render | Minta ulang `asset.urls`, lanjutkan |
| Canvas tainted (CORS salah) | Error jelas di log dev; konfigurasi CORS bucket diperiksa (checklist) |
| Popup Drive diblokir | Pesan 12 §6 |
| `storageQuotaExceeded` | Pesan Drive penuh + **Unduh** |
| Token kedaluwarsa (401) | Minta token ulang lewat tombol **Lanjut** (butuh gesture) |
| Upload resumable terputus | Lanjut dari offset, maks. 3× |
| Web Share tidak tersedia di iOS | Fallback tab baru + instruksi |

## 19. Acceptance criteria

| # | Kriteria | Tes |
|---|---|---|
| AC-1 | Finalisasi menghasilkan entri galeri dengan preview | TC-GAL-001 |
| AC-2 | 3 sesi tampil urut di galeri | TC-GAL-002 |
| AC-3 | Attempt `REJECTED` tidak pernah ada di `gallery.view`, termasuk Per orang | TC-GAL-005 |
| AC-4 | Tidak ada filter/route/field take gagal | TC-GAL-006 |
| AC-5 | Unduh berhasil di desktop, Android, iOS | TC-EXP-001 |
| AC-6 | Format & ekstensi benar | TC-EXP-002 |
| AC-7 | Dimensi preset benar, sumber full-res, peringatan bila upscaling > 1.25× | TC-EXP-010 |
| AC-8 | Render export = render referensi (golden image) | TC-EXP-011 |
| AC-9 | Simpan ke Drive berhasil; error Drive tertangani | TC-EXP-020, TC-EXP-021 |
| AC-10 | Token Google tidak pernah dikirim ke backend LONGROLL | TC-EXP-022 |
| AC-11 | Dua sesi berbeda mode dalam satu room + unduh semua hasil | TC-E2E-002 |
| AC-12 | Sesi baru dimulai dari voting; mode lama tidak terbawa | TC-VOTE-009 |
| AC-13 | Data `result_preview` & `doc_snapshot` terhapus saat room expired | TC-SEC-030 |
| AC-14 | Export plan 32 cell (kedua strategi binding) berhasil via tiling tanpa cell hilang | TC-EXP-012 |
| AC-15 | Pesan batas sesi disampaikan sebagai safeguard teknis (DEC-053) | Review copy SCR-22 |

## 20. Checklist pengujian

- [ ] Unit: filter accepted di `GalleryView`, penamaan file, kalkulasi skala & tiling, deteksi platform download.
- [ ] Unit: golden image untuk 6 gaya frame V1 (TC-EXP-011).
- [ ] Integrasi: finalize → storage → gallery → asset.urls (TTL & scope room).
- [ ] E2E: TC-GAL-001, -002, -005, -006, TC-VOTE-009, TC-E2E-002.
- [ ] Perangkat nyata: TC-EXP-001 (iOS Safari, Android Chrome, desktop), render Cetak 300 dpi di iPhone.
- [ ] Manual: TC-EXP-020, TC-EXP-021 dengan akun uji Google.
- [ ] Otomatis: TC-EXP-022 (inspeksi request).
- [ ] Otomatis + perangkat: TC-EXP-012 (32 cell) di desktop & HP menengah.
- [ ] TC-SEC-030 diulang dengan data P08.

Perintah verifikasi yang disarankan (dijalankan pengguna atau atas izin eksplisitnya): `pnpm test --filter export`, `pnpm test:integration --filter realtime`, `pnpm test:e2e gallery`. Agen tidak menjalankan typecheck/lint/build penuh, commit, push, atau deploy tanpa instruksi pengguna, dan tidak pernah mengarang hasil tes.

## 21. Definition of Done

- [ ] Item §15 selesai dengan bukti.
- [ ] AC-1..AC-15 terverifikasi; tes D/M tercatat lengkap.
- [ ] SCR-17 dan SCR-19 (DERIVED) disetujui reviewer visual; SCR-18 sesuai `08_Gallery.webp` desktop & mobile.
- [ ] Tidak ada copy yang menyiratkan file unduhan/Drive ikut terhapus.
- [ ] Status OAuth Google (origin, consent screen, kebutuhan verifikasi) tercatat di handoff (RK-08).
- [ ] Jika DEC-045 ditunda, alasan dicatat.
- [ ] Handoff §24 terisi.

## 22. Deliverable

- Finalisasi & `SessionResult` di server, snapshot dokumen ke storage.
- Pipeline render export + download per platform.
- Integrasi Google Drive (`drive.file`).
- SCR-17, SCR-18, SCR-19 desktop & mobile.
- Multi-sesi lengkap dengan ajakan.
- Tes unit/integrasi/E2E + catatan tes perangkat & manual.

## 23. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| RK-04 memori render iOS | Tiling, preset, fallback ukuran |
| RK-08 verifikasi aplikasi Google | Daftarkan OAuth sejak awal P08; Drive adalah P1, bukan blocker MVP internal |
| Hasil export berbeda dari pratinjau | Satu fungsi render + golden image |
| CORS bucket salah → canvas tainted | Checklist konfigurasi + tes integrasi |
| Galeri bocor attempt rejected | Filter di server + TC-GAL-005 |
| Copy retensi menyesatkan | Audit copy terhadap 15 §11 (diulang di P09) |

## 24. Handoff ke fase berikutnya

P09 membutuhkan inventaris lengkap semua jenis aset yang kini tersimpan (attempt, frame, preview hasil, snapshot dokumen) untuk verifikasi cleanup dan audit.

```text
## Handoff P08 → P09
Tanggal / agen:
Status fase: READY FOR REVIEW | DONE

### Pekerjaan selesai
- ...

### Komponen/file yang diubah
- ...

### Keputusan teknis penting (rujuk DEC-xxx; tandai yang masih PROPOSED)
- DEC-040 / DEC-045 / DEC-047 / DEC-059 / DEC-060 / DEC-063: ...

### Tes yang sudah dijalankan (ID, hasil, bukti, perangkat)
- TC-GAL-... / TC-EXP-...: PASS/FAIL — bukti: ...

### Tes yang BELUM dijalankan (dan alasannya)
- ...

### Masalah yang diketahui
- ...

### Risiko yang masih terbuka
- Status OAuth Google: ...

### Inventaris aset tersimpan per room (untuk P09)
- rooms/{roomId}/attempts/... , frames/... , sessions/{id}/preview.webp , sessions/{id}/doc.bin

### Kesiapan untuk P09
- [ ] Alur F-01..F-19 bisa dijalankan end-to-end
- [ ] Semua jenis aset terdaftar di indeks aset room (14 §11)
```
