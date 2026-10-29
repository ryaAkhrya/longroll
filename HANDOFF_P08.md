### Handoff P08 → P09

**Status:** gate non-browser lulus (typecheck, lint, unit, integrasi + Neon dev, build). **Playwright / browser E2E / uji visual TIDAK dijalankan (diminta) → semua AC yang butuh browser, canvas nyata, atau perangkat = NOT VERIFIED.** Google OAuth belum ada → "Simpan ke Google Drive" TIDAK pernah dijalankan terhadap Google (hanya terhadap tiruan).

#### Implemented
- **Hasil sesi (server):** `session.finalize` membuat `SessionResult` (versi, accepted saja, snapshot nama/warna, `dateMs`), menulis snapshot dokumen ke storage (`rooms/{roomId}/sessions/{sid}/doc.bin`), dan meminta render pratinjau ke finalizer; tanpa respons 30 detik → round-robin ke peserta lain (`result.render.request`). `result.preview.prepare/uploaded` (PUT signed, WebP ≤1 MB ≤1600 px, verifikasi sha256/ukuran/format/dimensi, versi basi → `TOO_LATE`). `gallery.get` (hanya ACCEPTED; signed URL ≤10 menit; memicu render bila pratinjau hilang). `asset.urls` (≤50 key, hanya key yang dikenal state — attempt ditolak / room lain / path acak diabaikan). `editor.sync` kini juga membaca sesi `CLOSED` yang punya hasil (read-only) agar galeri bisa export ulang. Sesi baru oleh siapa pun (lama → CLOSED), batas 20 sesi. Migrasi `0007_p08_results.sql` (`lr_sessions.result jsonb`) diterapkan di Neon `development`.
- **Satu jalur render (shared `render/`):** `drawElementBody/drawElement/drawBackground/drawFrameLayers/drawDocument` (Canvas2D murni). Kanvas editor Konva memanggil fungsi yang sama (`sceneFunc`) untuk badan elemen, latar, dan lapisan frame; export memanggil `drawDocument`. Konva hanya memberi transform grup, hit-test, Transformer. `plan.ts`: preset Asli / Cetak 300 dpi (2×) / Story 1080×1920 (contain), batas 8192 px (Cetak diturunkan bila perlu), tiling (> 16 juta px atau sisi > 4096), peringatan kualitas (sel < 240 px, upscale > 1,25×), nama file `LONGROLL_{CODE}_sesi{n}_{YYYY-MM-DD}.{ext}`, PNG `pHYs`.
- **Web export (`apps/web/src/export/`):** `render.ts` (tunggu `document.fonts.ready`, foto varian `edit` ≤1600 atau `full` hanya bila sel butuh, `ImageBitmap.close()`, JPEG 0,92 tanpa EXIF, PNG 300 dpi lewat `addPngDpi`), `pngStream.ts` (PNG bertahap via `CompressionStream` untuk output ber-tile; tidak ada canvas/buffer penuh), `download.ts` (anchor / `navigator.share` iOS / tab baru), `drive.ts` (GIS token model, scope `drive.file`, token hanya di memori tab, folder "LONGROLL", multipart < 5 MB / resumable ≥ 5 MB potongan 2 MB, retry ≤3×, 401 → Lanjut, kuota, popup, consent ditolak, revoke), `session.ts`/`useExport.ts`/`usePreview.ts`.
- **UI:** SCR-17 `ResultScreen` + `ExportPanel` (format, preset, peringatan, progres, Unduh utama, Drive sekunder, banner "Diselesaikan oleh …", Balik edit / Ke galeri / Sesi baru), SCR-18 `GalleryScreen` (copy retensi persis, chip Semua / Sesi n / Per orang, **tanpa UI take gagal**, "Unduh semua (.zip)" tampil nonaktif "Segera hadir" — DEC-045 P2 ditunda), SCR-19 `InviteDialog` (modal desktop / sheet mobile; "Ikut, ayo vote" / "Bentar"; banner "Sesi n lagi vote · Gabung" di hasil lama), `PreviewWorker` (render + unggah pratinjau WebP), `LeaveDialog` "Unduh semua dulu" untuk peserta terakhir (DEC-057), pesan batas 20 sesi.

#### Tests
| Tes | Hasil |
|---|---|
| Shared (13 baru, `render.test.ts`): operasi gambar via konteks perekam (urutan transform, clip sebelum drawImage, rasio crop, flip/filter, stiker/teks/doodle, urutan layer, tile), preset/ukuran/tiling/peringatan/nama file, pHYs + CRC | 99 total |
| Realtime unit (`results.test.ts`, 9): finalisasi, idempoten, render round-robin, verifikasi pratinjau, versi basi, multi-sesi, 20 sesi, galeri tanpa attempt ditolak, asset.urls, sync sesi CLOSED | 117 total |
| Integrasi memori (2) + Neon dev (1): finalisasi → muat ulang → sesi baru → galeri → room bubar bersih | 32 total (9 file, termasuk 4 file Neon) |
| Web (21 baru): encoder PNG streaming vs dekoder zlib (piksel identik), tiling 2×2 lintas kolom/baris (4100×3950), JPEG+tiling ditolak, foto gagal, varian foto; Drive (15: consent/popup/GIS/kedaluwarsa/revoke/folder/multipart/resumable/retry/401/kuota/abort); download per platform; ExportPanel; Galeri (copy retensi, tanpa take gagal, filter, zip nonaktif, placeholder, galat); Invite; LeaveDialog | 78 total |
| Typecheck / lint / build produksi | lulus |

#### NOT VERIFIED (butuh browser / perangkat / akun)
- Semua AC visual & piksel: golden image render vs `07_Editor`/frame, kesetaraan editor ↔ export per piksel, filter CSS `ctx.filter` di Safari (tidak didukung di iOS < 18 → filter bisa tidak ikut pada export iOS lama), font tertanam, hasil `toBlob` PNG/JPEG/WebP nyata, batas canvas iOS, memori 32 cell di perangkat, `navigator.share` iOS, `<a download>` Android, kecepatan (NFR export ≤ 5 s desktop).
- Google Drive terhadap Google nyata (popup GIS, consent, folder, resumable, kuota, revoke). Alur diuji hanya dengan tiruan.
- Pratinjau server dari klien nyata (PUT WebP ke storage S3 sungguhan), CORS bucket untuk `fetch` foto export.
- Undangan sesi baru lintas 2+ tab, banner Gabung, tata letak SCR-17/18/19 di mobile, aksesibilitas (axe, fokus dialog, kontras).
- Status "Ikut/Bentar" milik peserta lain (via `presence.activity`) di SCR-19 **belum dibuat**: pilihan hanya lokal; "Bentar" tidak menghentikan voting sesi baru (server tak menunggu peserta yang belum ikut).

#### Setup Google Drive (manual; saya tidak membuat proyek Google Cloud)
1. Google Cloud Console → proyek baru → **APIs & Services → Library → Google Drive API → Enable**.
2. **OAuth consent screen**: External, nama app "LONGROLL", scope **hanya** `.../auth/drive.file` (non-sensitif untuk file buatan app; verifikasi aplikasi umumnya tidak wajib, cek saat P10), tambahkan test users selama status Testing.
3. **Credentials → Create OAuth client ID → Web application**. *Authorized JavaScript origins*: origin produksi (`https://…`) dan `http://localhost:3000`. **Tidak perlu redirect URI, tidak ada client secret** (token model).
4. Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID=<client id>` di `apps/web/.env.local` / env Vercel (nilai publik). Tanpa ini tombol Drive nonaktif dengan penjelasan. CSP otomatis mengizinkan `accounts.google.com` & `www.googleapis.com` hanya bila variabel terisi (`next.config.ts`).
5. Uji manual: Unduh dulu (jalur tanpa Google), lalu Drive: consent → file muncul di folder "LONGROLL" → "Putuskan Google Drive".

#### Catatan
- Peringatan build "Yjs was already imported" saat prerender: hanya satu salinan `yjs@13.6.33` terpasang (`npm ls`); berasal dari bundling server Next (CJS+ESM), tidak memengaruhi runtime klien. Pantau saat P09.
- Neon `development`: setelah regresi tersisa 1 room aktif (`QEZWVM`, 1 peserta, dibuat sebelum regresi ini dijalankan; bukan dari suite ini) — tidak dihapus karena asalnya tak terverifikasi; akan hilang lewat kedaluwarsa normal bila ada service realtime berjalan.
- Storage objek Neon belum dibuat (tidak otomatis); dev/tes memakai memori/fs. Adapter S3 (`S3_*`) belum diuji terhadap bucket nyata.
- Tanggal dekor frame memakai `SessionResult.dateMs` (= `lockedAtMs ?? createdAtMs`, sama dengan editor).
- Untuk P09: lihat semua NOT VERIFIED di atas; semua E2E spec (`apps/web/e2e`) belum mencakup P08.
