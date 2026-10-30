# LONGROLL — Laporan QA Phase 3 + 4 (lokal, menunggu review owner)

Status: **semua perubahan hanya ada di working tree lokal.** Tidak ada commit, push, deploy, perubahan produksi, perubahan DB produksi, kredensial, DNS, atau konfigurasi TURN. HEAD tetap `8cc3461`.

Tanggal uji: 2026-10-30. Lingkungan: Windows 10, Chrome stabil (Playwright `channel: chrome`), Firefox 1555 dan WebKit 2370 bawaan Playwright, build produksi lokal (`next start`), realtime lokal dengan store memori (tanpa Neon).

## 1. Ringkasan eksekutif

- Phase 3 selesai: penyesuaian foto non-destruktif (9 kontrol + 6 preset filter + reset), katalog frame 7 → **25**, susunan layout 6 → **10**, stiker 16 → **27**, UX galeri frame dan studio kreatif, tersinkron real-time lewat Yjs.
- Phase 4 selesai: regresi fungsional, QA responsif 15 viewport (termasuk 667×375 dan 844×390 landscape), lintas browser Chromium/Firefox/WebKit, pengukuran performa, aksesibilitas (axe + keyboard), dan klasifikasi kegagalan lama terhadap baseline HEAD.
- Preview editor = hasil export: keduanya melewati satu jalur render (`drawDocument`) yang sama; paritas diuji lewat tes unit dan E2E (luminans editor vs export).
- Temuan penting selama QA yang sudah diperbaiki: panel studio/editor terpotong di layar 768 px; sheet landscape terlalu pendek; **WebKit tidak punya `ctx.filter` sehingga preset filter tidak tampil** (ditambah fallback piksel).
- Hasil otomatis akhir: unit 425 lulus; Playwright P10 Chromium desktop+mobile 59 lulus / 0 gagal; matriks responsif + phase3 24 lulus; WebKit lulus penuh; Firefox satu spec flaky yang juga flaky di baseline.

## 1b. Putaran QA terarah (setelah penerimaan lokal)

| # | Permintaan | Status |
|---|---|---|
| 1 | Filter saat capture di Safari/WebKit | **Diperbaiki**, diverifikasi di Chromium/Firefox (paritas); WebKit Playwright, bukan Safari asli |
| 2 | Toast menutupi kartu vote (mobile kecil/landscape) | **Diperbaiki**, 5 viewport kecil bersih |
| 3 | `TC-EDIT-020` kadang tidak konvergen | **Akar masalah ditemukan dan diperbaiki**; 0 divergensi dalam 450 iterasi fuzz + 3 tes regresi |
| 4 | Regresi Vote → Capture → Review → Edit → Export, 2–4 peserta | **Lulus** (2, 3, 4 peserta) |
| 5 | Tinjauan screenshot semua kategori frame dan layout | Selesai; satu frame mirip (Mosaic) didesain ulang |
| 6 | Performa akhir | Angka Phase 4 (§7) dipakai; **tidak diukur ulang** (§7), keterbatasan Safari/perangkat nyata di §9 |
| 7 | Laporan | Dokumen ini |

### 1b.1 Filter capture (Safari/WebKit)
- Sebab: `captureFrame.drawFrame` membakar filter presentasi kamera (hangat/terang, DEC-064) lewat `ctx.filter`, yang tidak ada di WebKit → di Safari foto yang diambil tidak berfilter, padahal preview berfilter.
- Perbaikan tanpa mesin baru: `drawFrame` memakai `supportsCtxFilter()` (deteksi fungsional yang sama dengan editor) dan bila tidak didukung memanggil `applyCssFilter` (fallback W3C yang sama dipakai preset editor/export). `draw.ts` menerima `DrawResources.pixelFilters` agar filter foto non-preset di editor/export juga lewat fallback itu saat `ctx.filter` tak ada.
- Paritas `ctx.filter` native vs `applyCssFilter` (gradien sintetis, 5 filter presentasi + semua preset): selisih maksimum ≤ 3/255 di Chromium dan Firefox.
- Tes: 6 tes `applyCssFilter` (shared), 3 tes `drawFrame` (web; jalur native tidak membaca piksel, jalur fallback menerapkan filter yang sama, tanpa filter tanpa pekerjaan tambahan).
- Belum terbukti di Safari iOS/macOS asli.

### 1b.2 Toast menutupi kartu vote
- Sebab: toast `fixed` di bawah header pada <1024 px menimpa konten; selain itu posisi scroll terbawa dari view sebelumnya sehingga lane tidak terlihat.
- Perbaikan: variabel CSS `--toast-lane` (tinggi toast, via `ResizeObserver`) + `<ToastLane />` yang menyisihkan ruang di lobby dan voting, scroll ke atas saat pindah view, toast pasif ditutup saat `wheel`/`touchmove` (toast peringatan/beraksi tidak). 2 tes UI baru.
- Hasil: tidak ada overlap toast–kartu di m320, m375, m667 landscape, m844 landscape, dan m360 (matriks responsif dengan detektor sadar-modal).

### 1b.3 `TC-EDIT-020` (non-konvergen)
- Akar masalah (dua cacat di `packages/shared/src/editor/doc.ts`):
  1. `pushHistory` menggabungkan entri berurutan (peserta + elemen sama dalam `historyMergeMs`) tetapi `before` hasil gabungan kehilangan kunci yang hanya ada di entri belakang; `revertEntry` lalu menulis `before[k] ?? null`, sehingga undo menulis `z = null`. Server `validateDoc` menolak `z` bukan string (SCHEMA) → replika berbeda.
  2. Urutan elemen memakai komparator yang tidak transitif bila `z` bukan string (indeks pecahan berupa string), sehingga urutan bergantung replika.
- Perbaikan minimal: gabung `before` dengan `{...e.before, ...last.before}`; `revertEntry` melewati kunci yang tidak ada di `before` dan hanya mencatat kunci yang benar-benar diterapkan; `listElements` memperlakukan `z` non-string sebagai `""`. Perilaku kolaborasi normal tidak berubah (tes lama tetap lulus).
- Kondisi pemicu: dua+ perubahan cepat pada elemen yang sama oleh satu peserta (mis. geser lalu ubah urutan) diikuti undo. Sebelum: ±2–4 per 180 iterasi fuzz; sesudah: **0 per 450**.
- 3 tes regresi `TC-EDIT-020b` (merge+revert mempertahankan `z`; entri lama tanpa kunci dilewati; urutan deterministik dengan `z` non-string).

### 1b.4 Regresi 2/3/4 peserta (`e2e/p10/regress-n.spec.ts`, build produksi, kamera palsu)
Alur: buat room → gabung → vote Photo Strip → capture + review sampai editor → satu peserta menambah stiker, peserta lain preset Hangat + eksposur → semua melihat hasil sama → Selesai → export. 2, 3, dan 4 peserta **lulus**; tanpa page error; selisih luma editor vs PNG export ≈ 0,6% (batas 5%).

### 1b.5 Tinjauan visual frame dan layout
- Semua kategori diperiksa pada 4 mode (strip/grid/group/collage) dan 4 sheet layout (10 susunan): tidak ada yang terpotong atau tumpang tindih.
- Frame bersifat parametrik (variasi warna/dekor/proporsi); Seoul, Mono Press, dan Linen sengaja minimalis sehingga mirip secara sengaja. **Mosaic** terlalu mirip frame lain → didesain ulang (latar grid, ubin bergaris putih, `adapt: "PATTERN"`).
- Konsistensi skala (preview kecil vs besar diperkecil; `data/scale-parity.json`, 93 figur): MAE rata-rata per mode 1,3–2,2/255, maks 4,5/255 (Group Shot · Gallery Wall); semua > 3 adalah frame dengan elemen miring/bayangan (Polaroid, Instax, Scrapbook, Gallery Wall, Sunset Stripe) yang wajar berbeda karena antialiasing tepi miring; tidak ada figur kosong/terpotong. **Status: terverifikasi sebagian** — hasil berasal dari satu run lengkap; run ulang terakhir macet (±95 menit tanpa kemajuan) dan dihentikan, sehingga tidak ada konfirmasi kedua. Pratinjau Konva di studio adalah renderer terpisah dan hanya diperiksa visual.
- Bukti: `frame-lab/` diperbarui (`frames-*`, `layouts-*`, `mosaic-*`).

## 2. Fitur baru

**Penyesuaian foto** (panel "Atur"; `packages/shared/src/render/adjust.ts`)
- Eksposur, kecerahan, kontras, saturasi, highlight, shadow, suhu, tint, grain; preset Asli/Hangat/Sejuk/Pudar/Film/Mono; tombol Reset.
- Lingkup: "Semua foto" (global, `meta.globalAdjust`) atau "Foto terpilih" (per foto, `adjust`, menggantikan global).
- Non-destruktif: foto asli tak diubah; nilai disimpan di dokumen Yjs hanya untuk kunci non-nol.
- Slider memakai draft lokal dan di-commit **sekali** saat dilepas → satu entri undo.
- Navigasi keyboard tab Dasar/Cahaya/Warna/Efek (panah, Home/End, roving tabindex).

**Frame, layout, stiker**
- 25 frame parametrik (lihat §3), kategori + pencarian + filter per mode, thumbnail dimuat malas.
- 4 susunan baru: Strip zig-zag, Majalah, Fitur (hero), Masonry; grup HERO pada generator.
- Kartu slot (polaroid/bayangan/stroke) kini digambar di jalur render bersama sehingga export sama dengan preview studio.
- 11 stiker baru, stiker bunga diperbaiki.

**Kolaborasi**: `setGlobalAdjust` / `setPhotoAdjust` melewati validasi bersama; konflik ditangani Yjs seperti elemen lain.

## 3. Jumlah frame dan layout

| Kategori | Jumlah |
|---|---|
| Korean | 1 |
| Minimal | 2 |
| Monokrom | 2 |
| Retro | 5 |
| Polaroid | 3 |
| Scrapbook | 1 |
| Editorial | 2 |
| Pastel | 2 |
| Date night (couple) | 2 |
| Sahabat | 2 |
| Musiman | 2 |
| Grid | 1 |
| **Total** | **25** (sebelumnya 7) |

Ketersediaan per mode: Photo Strip 24, Group Shot 22, Photo Grid 25, Freeform Collage 22.

Susunan layout (10): Strip vertikal, Strip horizontal, **Strip zig-zag**, Grid, Mosaik, **Majalah**, Lebar, **Fitur**, Sebar, **Masonry** (+ Custom). Tebal = baru. Semua frame × susunan × jumlah peserta diuji geometri di `creative.test.ts` (tanpa slot tumpang tindih, di dalam kanvas, batas ukuran output).

Stiker: 27 (sebelumnya 16).

Bukti visual: `frame-lab/` (frames-*.png, layouts-*.png, stickers.png).

## 4. Perubahan arsitektur

- `render/adjust.ts` (shared, murni): `applyAdjust` per piksel dengan LUT nada; `applyCssFilter` (fallback `ctx.filter`).
- `render/draw.ts`: `drawDocument` menerima `pixelScale` dan `adjusted(req)`; foto dengan adjust/preset dirender ke kanvas offscreen **berukuran piksel tujuan** lalu digambar. Satu fungsi dipakai editor Konva dan export penuh.
- `apps/web/src/render/adjustImage.ts`: cache LRU kanvas (satu entri per foto/ukuran), pengujian fungsional `supportsCtxFilter`.
- Skema/validasi dokumen: kunci `adjust`, `meta.globalAdjust`, arrangement baru, `HERO`.
- Studio: `generate.ts` (arrangement baru + `MAX_GRID_SIDE`), `scene.ts` (dekor parametrik), `frames.ts` (katalog).
- Alat dev `/dev/frames` (FrameLab) untuk inspeksi visual dan uji lintas browser.

**Catatan deploy (untuk owner):** validasi bersama berubah (kunci `adjust`, arrangement, `HERO`). Realtime dan web harus di-deploy **bersamaan**; web baru dengan realtime lama akan ditolak untuk dokumen yang memakai fitur baru.

## 5. Hasil tes

| Suite | Hasil |
|---|---|
| Typecheck semua workspace | bersih |
| ESLint | bersih |
| Build produksi web | berhasil |
| Unit shared | 155 lulus (dijalankan ulang setelah perubahan terakhir) |
| Unit web | 121 lulus (dijalankan ulang setelah perubahan terakhir) |
| Unit realtime | 157 lulus (run sebelumnya; paket realtime tidak diubah) |
| Typecheck + ESLint (ulang) | bersih |
| Playwright P10 (Chromium desktop + mobile, build produksi) | 59 lulus, 0 gagal, 57 skip (spec bergerbang env atau satu-proyek); ditambah `regress-n` 2/3/4 peserta lulus |
| Phase 3 E2E + matriks UI QA final (desktop) | 24 lulus (editor 2 peserta: adjust sinkron, preview==export, axe, keyboard) |
| Legacy P01–P05 (`P10_LEGACY=1`) | 6 lulus, 2 gagal — **keduanya gagal identik di baseline HEAD** (§8) |
| Firefox + WebKit (`P10_WEBKIT=1`) | 47 lulus, 1 gagal (artefak flag, §6), 1 skip |

**Catatan build:** perubahan terakhir (restyle Mosaic di `frames.ts`, data frame saja) dibuat setelah build produksi yang dipakai suite Playwright; build **tidak** dibangun ulang dan suite E2E **tidak** diulang setelahnya. Tes geometri `creative` (semua frame × susunan) dan seluruh unit tes dijalankan ulang dan lulus. Owner disarankan menjalankan build + P10 sekali lagi sebelum produksi.

Tidak dijalankan: spec `restart` (butuh `P10_SELF_REALTIME=1` + Neon development; dihindari karena `recover()` pernah menghapus room dev), `noauto` 10 menit (`P10_LONG=1`), tes integrasi realtime yang butuh DB.

## 6. QA responsif dan lintas browser

**Responsif** — 15 viewport × alur penuh (landing → buat room → lobby → vote → studio → review → editor → hasil), detektor otomatis (overlap kontrol/teks, terpotong, keluar layar, scroll horizontal) + inspeksi screenshot:
d1280×720, d1366×768, d1440×900, d1920×1080, t768×1024, t820×1180, t1024×768, m320×568, m360×800, m375×667, m390×844, m412×922, m430×932, m667×375 landscape, m844×390 landscape. Alur dalam (panel Frame/Layout/Atur/Stiker) di 320, 390, 844×390, 820, 1366.

- Bersih: semua desktop dan tablet, m360, m390, m412, m430.
- Temuan toast di m320, m375, m667, m844 (toast melayang di atas kartu vote) **sudah diperbaiki** di putaran terarah (§1b.2).
- Diperbaiki: panel studio Layout terpotong di 1366×768 (regresi Phase 1, kini bergulir di dalam panel); sheet landscape 844×390 hanya ±175 px (kini 88dvh); preset filter mobile menutupi slider (kini baris horizontal).

**Lintas browser** (Playwright; **bukan** Safari iOS asli, **bukan** perangkat nyata)
- Lab kanvas bersama pada Chromium, Firefox, WebKit (6 kasus: netral, eksposur+kontras, preset Mono, preset Hangat+adjust, grain, kolase): selisih luma rata-rata antar engine ≤ 0.8/255, tanpa error halaman (`data/cross-browser-lab.json`, `cross-browser/`).
- WebKit tidak mendukung `ctx.filter` (terukur). Sebelum perbaikan, preset tidak tampil di WebKit; sekarang jalur piksel `applyCssFilter` dipakai, dan chroma preset Mono identik dengan Chromium (1.8 vs 1.8).
- WebKit: butuh `P10_WEBKIT=1` (CSP `upgrade-insecure-requests` menaikkan `http://localhost` ke https). Tanpa flag, 6 tes WebKit gagal karena konfigurasi, bukan produk. Dengan flag lulus penuh.
- Firefox: satu tes `cookie kredensial` gagal bila dijalankan dengan `P10_WEBKIT=1` (flag mematikan cookie Secure); itu artefak flag, lulus tanpa flag.
- Firefox `fullflow` flaky (§8).
- Kamera: Firefox memakai kamera palsu; WebKit di Windows tidak punya kamera palsu, jadi alur kamera hanya diuji di Chromium.

## 7. Performa sebelum/sesudah

Bundel JS yang diunduh (gzip), produksi saat ini vs build lokal baru, alur landing → lobby → editor:

| | Sebelum | Sesudah | Selisih |
|---|---|---|---|
| Landing | 196.643 B | 205.120 B | +4,3% |
| Lobby (tambahan) | 185.761 B | 185.894 B | +0,1% |
| Editor (tambahan) | 14.468 B | 15.240 B | +5,3% |
| **Total** | **396.872 B** | **406.254 B** | **+2,4%** |

Catatan: "sebelum" diukur dari situs produksi, "sesudah" dari build lokal; konfigurasi CDN/kompresi dapat sedikit berbeda.

Jalur penyesuaian (Chromium desktop, build produksi, 4 foto, 60 perubahan slider; `data/perf-adjust.json`):
- Latensi slider → kanvas: rata-rata 76 ms, p50 70 ms, p95 120 ms, maks 137 ms.
- Biaya per foto: rata-rata 1,15 ms, p95 2,1 ms (±35 ribu piksel), 0 long task.
- Heap setelah 60 perubahan + GC: +1,4 MB; cache kanvas 32 entri, ≈1,04 juta piksel (dibatasi).
- Export: netral 395 ms (Asli) / 392 ms (Cetak); dengan adjust 387 ms (Asli) / 1018 ms (Cetak, resolusi penuh).
- Tidak ada baseline "sebelum" untuk latensi slider karena fiturnya baru; jalur render foto tanpa adjust tidak berubah selain kartu slot yang kini digambar.

Semua angka diukur di mesin pengembangan, bukan HP nyata; di HP akan lebih lambat.

**Pemeriksaan performa final:** pengukuran bundel dan jalur adjust di atas **tidak diulang** pada putaran terarah. Perubahan sesudahnya kecil untuk performa: fallback filter piksel hanya aktif bila `ctx.filter` tidak berfungsi (Safari/WebKit) — jalur Chromium/Firefox tidak membaca piksel (dibuktikan tes `drawFrame`); `ToastLane` memakai satu `ResizeObserver`. Biaya fallback piksel di Safari **belum diukur** (O(piksel) per capture dan per foto berpreset di editor). Angka sebelum/sesudah tetap valid untuk jalur yang diukur, namun bukan jaminan atas perubahan terbaru.

## 8. Bug ditemukan dan diperbaiki, serta klasifikasi kegagalan

Diperbaiki:
1. Validasi menolak `HERO`, dan Masonry 2 kolom melampaui batas output (tes generator).
2. Panel studio Layout terpotong di 768 px (regresi Phase 1) — `overflow-y:auto` pada panel studio dan editor.
3. Sheet landscape pendek menutupi isi dan sebagian kontrol — tinggi sheet pada landscape ≤ 500 px.
4. Preset filter mobile menenggelamkan slider — baris horizontal ringkas.
5. WebKit tanpa `ctx.filter` — fallback piksel + deteksi fungsional (bukan sekadar `"filter" in ctx`) + penjaga SSR agar hasil deteksi tidak ter-cache salah.
6. Tab "Atur" tanpa navigasi keyboard pola ARIA — ditambahkan dan diuji.
7. Beberapa false positive detektor QA (carousel chip, header sticky, dialog modal) dipersempit; detektor lama tidak dilemahkan untuk kasus yang bisa dilihat pengguna.

Klasifikasi objektif terhadap baseline HEAD (`git archive` HEAD, dibangun dan dijalankan terpisah di folder sementara yang sudah dihapus):

| Kegagalan | Baseline HEAD | Pohon modifikasi | Klasifikasi |
|---|---|---|---|
| legacy `camera.spec` TC-RTC-001 (`status` undefined) | gagal | gagal | **pra-ada**, bukan regresi |
| legacy `room.spec` (teks "Nadia" di `aria-hidden`) | gagal | gagal | **pra-ada**, bukan regresi |
| Firefox `fullflow` (timeout `page.reload` / locator editor) | 1 dari 3 gagal, `page.reload` timeout | 3 dari 7 gagal pada beberapa run, lalu 3 dari 3 lulus | **flaky pra-ada** (tanda kegagalan sama di baseline); sampel kecil, tidak bisa membuktikan laju identik |
| `TC-EDIT-020` fuzz kadang tidak konvergen | 1/15 | 0/450 setelah perbaikan | **pra-ada; diperbaiki** (§1b.3) |
| Toast menimpa kartu vote di layar kecil | ada | tidak ada | **pra-ada; diperbaiki** (§1b.2) |

## 9. Keterbatasan tersisa

- Belum ada uji di Safari iOS/Android/perangkat nyata; WebKit Playwright (Windows) bukan Safari. Fallback filter diverifikasi pada WebKit tersebut, bukan pada Safari asli.
- Filter saat capture kini memakai fallback piksel bersama di Safari (§1b.1), tetapi hanya terverifikasi lewat tes unit, paritas di Chromium/Firefox, dan WebKit Playwright; **belum di Safari iOS/macOS asli**. Tidak ada WebKit dengan kamera palsu di Windows, sehingga alur capture-kamera di WebKit tidak diuji end-to-end. Biaya CPU fallback di perangkat seluler belum diukur.
- Firefox `fullflow` flaky pra-ada, akar masalah belum diselidiki. `TC-EDIT-020` sudah diperbaiki (§1b.3); kolaborasi dengan data historis tidak diuji di database nyata.
- Konsistensi skala frame: terverifikasi sebagian (§1b.5).
- Build produksi tidak dibangun ulang setelah restyle Mosaic (§5).
- Spec `restart`, `noauto`, dan integrasi realtime berbasis DB tidak dijalankan pada sesi ini.
- WebRTC tidak diubah; spec WebRTC lulus pada run penuh, tetapi tetap di jaringan lokal tanpa TURN.
- Pengukuran performa dari satu mesin pengembangan dengan kamera palsu.
- Keputusan produk DEC-052/056/061/073/075/082 tidak diputuskan di sini.

## 10. Screenshot akhir

- Desktop 1366×768: `screenshots/desktop-1366x768/` (landing, studio, galeri frame, layout, editor, Atur, Frame, Stiker, hasil).
- Mobile 390×844: `screenshots/mobile-390x844/` (set yang sama).
- Landscape 844×390 dan mobile kecil 320×568: `screenshots/mobile-landscape-844x390/`, `screenshots/mobile-320x568/`.
- Lintas browser: `cross-browser/` (netral, eksposur, Mono, Hangat+adjust × Chromium/Firefox/WebKit).

## 11. Berkas

**Ditambah (belum ter-track):** `packages/shared/src/render/adjust.ts`; `packages/shared/src/__tests__/{adjust,adjust-doc,creative}.test.ts`; `apps/web/src/render/adjustImage.ts`; `apps/web/src/components/dev/FrameLab.tsx`; `apps/web/src/app/dev/frames/`; `apps/web/e2e/p10/{phase3.spec.ts,phase3kit.ts,perf.spec.ts}`; `docs/qa/phase-3-4/` (laporan ini).

**Ditambah pada putaran terarah:** `apps/web/src/capture/__tests__/drawFrame.test.ts`; `apps/web/e2e/p10/regress-n.spec.ts`; `docs/qa/phase-3-4/data/scale-parity.json`. Diubah tambahan: `capture/captureFrame.ts`, `components/room/{RoomScreen,LobbyLayout}.tsx`, `components/session/VotingScreen.tsx`, `components/ui/{Toast.tsx,Toast.module.css,__tests__/ui.test.tsx}`, `shared/editor/doc.ts` + `__tests__/editor.test.ts`, `shared/render/adjust.ts` + `__tests__/adjust.test.ts`, `shared/studio/frames.ts`, `components/dev/FrameLab.tsx`.

**Diubah (28 berkas pada Phase 3+4, belum termasuk daftar tambahan di atas):**
- shared: `editor/{doc,schema,validate}.ts`, `render/{draw,index}.ts`, `studio/{config,frames,generate,scene,types,validate}.ts`.
- web: `components/editor/{EditorCanvas,EditorPanels,EditorScreen}.tsx`, `EditorPanels.module.css`, `components/studio/{StudioContainer.tsx,canvas/StudioCanvas.tsx,canvas/assets.ts,panels/FramePanel.tsx,panels/panels.module.css}`, `components/ui/{Slider.tsx,Slider.module.css,BottomSheet.module.css}`, `editor/useEditor.ts`, `editor/__tests__/editor.test.tsx`, `export/render.ts`, `render/resources.ts`, `e2e/p10/uiqa.spec.ts`.
- `apps/web/test-results/p10/.last-run.json` — berkas hasil Playwright yang ter-track dan berubah tiap run; **bukan perubahan produk**. Disarankan dikembalikan oleh owner (`git checkout -- apps/web/test-results/p10/.last-run.json`) sebelum commit.

**Dihapus:** tidak ada berkas produk. Tidak ada tes lama yang dihapus atau dilonggarkan.

## 12. Konfirmasi lokal

`git log` masih berakhir di `8cc3461`; `git status` hanya menampilkan perubahan working tree (di atas). Tidak ada commit, push, deploy, perubahan DB produksi, secret, DNS, atau TURN. Folder sementara baseline sudah dihapus. Menunggu keputusan owner.
