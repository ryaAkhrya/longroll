# 10 — Frames, Canvas & Layout

| Atribut | Nilai |
|---|---|
| Versi | 1.1.0 |
| Requirement | REQ-FRAME-01..15, REQ-VOTE-07, REQ-CAM-09..10 |
| Fase | P05 (utama), P07 (editor memakai model yang sama), P08 (export) |
| Layar | SCR-08, SCR-09, SCR-10, SCR-11 |

Bagian berlabel **UX** adalah requirement pengalaman pengguna. Bagian berlabel **IMPL** adalah usulan implementasi (RECOMMENDED/PROPOSED).

## 1. Komponen mesin frame (IMPL)

```text
StudioState (bersama, per sesi)
 ├─ layout: LayoutSpec        # kanvas + BindingPlan (slot + binding, §5)
 ├─ bindingStrategy           # 'PER_SHOT_GROUP' | 'PER_PARTICIPANT_SHOT' | 'FREEFORM' (DEC-061 OPEN)
 ├─ frame: FrameRef           # frame aktif (bawaan / custom)
 ├─ style: { bgColor, gap, cornerRadius, filterPreset }
 └─ countdownSec

Renderer (klien, Konva - DEC-039)
 ├─ BackgroundLayer   (warna/tekstur latar frame)
 ├─ PhotoLayer        (slot: video live di studio, foto di editor/export)
 ├─ FrameOverlayLayer (artwork frame dengan lubang transparan)
 └─ DecorLayer        (teks/ornamen bawaan frame; stiker dari editor ada di 11)
```

Satu definisi scene dipakai untuk: pratinjau studio, kanvas editor, preview galeri, dan export resolusi penuh. **Tidak boleh** ada jalur render terpisah yang hasilnya berbeda.

## 2. Kategori frame (UX)

| Kategori | Contoh V1 | Ciri |
|---|---|---|
| Korean | Seoul Strip | Strip putih bersih, 4 foto vertikal, logo + tanggal mono di bawah |
| Minimal | Editorial | Margin lebar, 1 foto besar + 3 kecil, caption serif |
| Retro | Film 400 | Strip hitam dengan lubang sprocket, nomor frame oranye |
| Scrapbook | Scrapbook | Kertas kraft, polaroid miring, selotip, tulisan tangan |
| Pastel | Lilac Dream | Gradien pastel, pola titik, foto rounded ber-outline putih |
| Grid | Mosaic | Mosaik 1 besar + beberapa kecil |
| Punyaku | (upload) | Frame custom milik room |

Target jumlah: DEC-066 (MVP ≥ 6, rilis publik ≥ 24).

## 3. Mode & layout (UX)

| Mode | Layout yang tersedia | Kustomisasi internal (REQ-VOTE-07) |
|---|---|---|
| Photo Strip | Strip vertikal, strip horizontal | Jumlah shot, rasio slot, jarak, radius, warna latar, frame, orientasi |
| Group Shot | Bidang lebar tunggal (berdampingan, masker lembut, DEC-062) | Rasio output, urutan peserta, overlap, frame, jumlah shot (1–4) |
| Photo Grid | Grid N×M (safeguard DEC-042: ≤ 32 cell, sisi ≤ 8), mosaik | Ukuran grid, slot gabungan (span), jarak, frame |
| Freeform Collage | Kanvas bebas | Ukuran kanvas, latar, foto bebas posisi/rotasi/skala |

## 4. Sistem koordinat kanvas (IMPL)

| Aspek | Spesifikasi |
|---|---|
| Unit | **Base pixel** pada ukuran output dasar layout (misal Strip 2×6" = 600×1800). |
| Origin | Kiri atas (0,0). X ke kanan, Y ke bawah. Rotasi derajat searah jarum jam, pusat rotasi = pusat elemen. |
| Export | Skala seragam `s = exportLongSide / baseLongSide` diterapkan ke semua koordinat. Tidak ada skala non-uniform. |
| Tampilan | Kanvas ditampilkan dengan `fit: contain` di viewport. Zoom tampilan (editor) **tidak** mengubah koordinat dokumen. |
| Presisi | Simpan angka dengan 2 desimal. |

## 5. Slot, cell & binding — 🔴 DEC-061 tetap OPEN QUESTION

> **v1.1:** pemetaan foto ke slot **belum diputuskan** (DEC-061). Model data di bawah (DEC-087, RECOMMENDED) dirancang agar **kedua** strategi berjalan tanpa mengubah skema. Dokumen ini **tidak** memilih strategi final.

### 5.1 Konsep

| Istilah | Arti |
|---|---|
| **Photo cell** | Unit foto terkecil: foto **satu peserta** pada **satu shot**, `(shotIndex, participantId)`. Jumlah cell dalam sesi = `jumlahShot × jumlahPesertaWajib`. |
| **Slot** | Area di kanvas output. Satu slot bisa menampung **satu cell** (foto individual) **atau beberapa cell** yang disusun otomatis (komposit grup). |
| **Binding** | Aturan yang mengisi slot dengan cell. Binding adalah **data**, bukan logika yang di-hardcode per mode. |
| **BindingPlan** | Daftar slot + binding untuk satu sesi, dibuat oleh generator dari `(mode, strategy, shotCount, participantSlots, template)`. |

```text
Slot {
  id, x, y, w, h, rotation, radius, z, fit: 'cover', focal?: {x,y}
  binding:
    | { kind: 'CELL',  shotIndex, participantSlot }              # satu foto individual
    | { kind: 'SHOT_GROUP', shotIndex, arrangement: 'ROW'|'COLUMN'|'GRID'|'BLEND' }   # semua peserta pada satu shot
    | { kind: 'FREE' }                                            # collage: diisi item bebas di editor
}
BindingPlan { strategy: 'PER_SHOT_GROUP' | 'PER_PARTICIPANT_SHOT' | 'FREEFORM', slots: Slot[] }
```

- `participantSlot` memakai slot peserta P1–P4 (bukan `participantId`), supaya binding tetap stabil jika peserta reconnect atau ada yang keluar. Foto diambil dari `acceptedAttemptId` peserta yang menempati slot itu **saat shot diambil**.
- Cell tanpa foto (`SKIPPED`, `NOT_REQUIRED`) dirender sebagai placeholder netral pada pratinjau. Saat export, slot `CELL` kosong memakai warna latar frame; sub-tile kosong di `SHOT_GROUP` dihilangkan dan susunan dipadatkan.

### 5.2 Dua strategi yang harus didukung

| | **Strategi A: `PER_SHOT_GROUP`** | **Strategi B: `PER_PARTICIPANT_SHOT`** |
|---|---|---|
| Slot | 1 slot per shot (`SHOT_GROUP`) | 1 slot per cell (`CELL`) |
| Isi slot | Komposit semua peserta pada shot itu (ROW/COLUMN/GRID/BLEND) | Foto satu peserta |
| Mirip dengan | Photobooth fisik (tiap kotak = satu momen grup) | Mockup V1 (tiap kotak strip berisi satu orang) |
| Jumlah slot (4 peserta) | = jumlah shot (1–8 dalam safeguard) | = shot × peserta (4–32 dalam safeguard) |
| Kelebihan | Strip tetap pendek, semantik klasik | Wajah besar, retake individual terlihat per kotak |
| Kekurangan | Wajah kecil di strip sempit | Layout panjang untuk shot banyak |

Mode **Freeform Collage** memakai strategi `FREEFORM`: setiap cell accepted menjadi item bebas di editor (11 §3).

**Status:** strategi default per mode = **OPEN (DEC-061)**. Selama belum diputuskan:

- Generator layout **wajib** bisa menghasilkan plan untuk A **dan** B di setiap mode Strip/Group/Grid.
- Strategi aktif per sesi adalah **pengaturan studio bersama** (`studio.bindingStrategy`) yang bisa diubah sebelum shot pertama (sama seperti struktur lain, DEC-065). Apakah pengaturan ini ditampilkan ke pengguna, atau dikunci ke satu default oleh pemilik produk, adalah bagian dari DEC-061.
- Tampilan studio mockup V1 (grid feed 2×2 + pratinjau strip) tetap berlaku untuk kedua strategi. Yang berubah hanya isi pratinjau output.

### 5.3 Contoh plan (4 peserta)

| Mode | Shot | Strategi A | Strategi B |
|---|---|---|---|
| Photo Strip vertikal | 4 | 4 slot; tiap slot 4 wajah (ROW) | 16 slot; baris = shot, kolom = peserta, **atau** 4 strip berdampingan (satu per peserta). Varian susunan ditentukan template. |
| Photo Strip vertikal | 8 | 8 slot | 32 slot (strip panjang atau 4 kolom × 8 baris) |
| Group Shot | 1 | 1 slot BLEND (DEC-062) | 4 slot berdampingan tanpa blend |
| Photo Grid | 2 | 2 slot GRID | Grid 2 baris × 4 kolom (atau dibalik) |

### 5.4 Penempatan feed di slot (REQ-CAM-10)

- Studio: cell untuk shot yang sedang/akan diambil menampilkan **feed live** peserta; cell untuk shot yang sudah selesai menampilkan foto accepted.
- `fit: cover` dengan titik fokus (`focal`, default 50%/35% agar wajah tidak terpotong). Framing pra-capture peserta (09 §4.1) diterapkan sebelum `cover`.
- Rasio feed ≠ rasio slot/sub-tile → crop seragam, tidak pernah stretch.

## 6. Shot, cell, rasio, output

> **v1.1:** semua angka batas di bawah adalah **PROPOSED technical safeguards** (DEC-042), bukan keputusan produk. Nilainya disimpan sebagai konfigurasi terpusat (`packages/shared`), dan konsisten satu sama lain. Menurunkan batas di bawah nilai ini (mengurangi fleksibilitas) **butuh persetujuan pemilik produk**. Menaikkannya boleh jika uji performa (TC-PERF-022) lolos.

| Parameter | Safeguard (PROPOSED) | Default | Catatan konsistensi |
|---|---|---|---|
| Peserta wajib per shot | 1–4 | jumlah peserta | Batas 4 adalah CONFIRMED (REQ-ROOM-06) |
| Jumlah shot per sesi | 1–8 | Strip 4, Group 1, Grid 1, Collage 4 | `MAX_SHOTS = 8` |
| Photo cell per sesi | ≤ `MAX_SHOTS × 4` = **32** | — | Diturunkan, bukan batas terpisah |
| Slot per plan | Strategi A: ≤ `MAX_SHOTS` (8); Strategi B: ≤ 32; Freeform: ≤ 32 item foto | — | Menggantikan batas lama "12 slot" yang bertentangan dengan 4 × 8 |
| Grid | baris × kolom ≤ 32, masing-masing ≤ 8 | 2×2 | Menggantikan batas lama "4×3" |
| Rasio slot | 1:1, 4:3, 3:4, 16:9, 9:16, custom | 4:3 | — |
| Preset output | Strip 2×6" (600×1800 base; export 1200×3600), Postcard 4×6" (1200×1800), Square (1600×1600), Story 9:16 (1080×1920), Custom | Mengikuti mode & plan | Untuk plan besar (> 16 cell) generator memilih ukuran base yang lebih panjang otomatis |
| Sisi terpanjang output | 600–**8192** px (safeguard export klien) | Mengikuti preset | Plan 32 cell butuh output panjang; render export per tile (12 §4) |
| Resolusi minimum per cell saat export | Sisi pendek cell ≥ 240 px | — | Di bawah ini muncul peringatan kualitas (NFR-12), bukan penolakan |
| Kunci struktur | Setelah shot pertama (DEC-065) | — | Termasuk `bindingStrategy` dan jumlah shot |

Jika kombinasi pengaturan melewati safeguard, UI menampilkan alasan dan alternatif ("8 shot × 4 orang jadi 32 foto. Pakai strip per orang atau grid biar tetap kebaca?"). UI tidak boleh diam-diam memotong jumlah shot.

## 7. Ukuran & posisi slot (REQ-FRAME-09)

- Desktop: drag slot di pratinjau; handle 8 arah; `Shift` = jaga rasio; snapping ke tepi kanvas, pusat, dan slot lain (jarak ≤ 6 base px) dengan garis panduan.
- Mobile: tap slot → sheet dengan kontrol posisi/ukuran numerik + gestur drag/pinch di pratinjau.
- Validasi: slot harus berada ≥ 50% di dalam kanvas; ukuran minimum 60×60 base px.
- Perubahan disinkron sebagai operasi bersama (LWW per slot) dengan toast "Diubah Raka · Balikin".

## 8. Template metadata (IMPL)

```text
FrameTemplate {
  id: string                 # 'builtin/seoul-strip@1' atau 'room/{roomId}/{uuid}'
  name: string               # 'Seoul Strip'
  category: 'KOREAN'|'MINIMAL'|'RETRO'|'SCRAPBOOK'|'PASTEL'|'GRID'|'CUSTOM'
  modes: Mode[]              # mode yang kompatibel
  baseSize: { w, h }         # ukuran desain asli artwork
  adapt: 'FIXED' | 'CONTAIN' | 'COVER' | 'NINE_SLICE' | 'PATTERN'
  nineSlice?: { top, right, bottom, left }   # inset dalam base px
  slots?: SlotSpec[]         # jika frame menentukan lubang foto
  layers: {
    background?: AssetRef    # di bawah foto
    overlay?: AssetRef       # di atas foto (PNG/WebP dengan alpha)
    decor?: DecorSpec[]      # teks/tanggal dinamis, misal {type:'date', format:'YYYY.MM.DD'}
  }
  palette?: { bg, ink }
  license: { source: string, attribution?: string }
  version: number
}
```

Frame bawaan disimpan sebagai aset statis di build (bukan di storage room). Frame custom disimpan per room (DEC-054).

## 9. Validasi upload frame (DEC-041)

Pipeline di server (IMPL):

1. Klien memeriksa awal (tipe, ukuran) untuk umpan balik cepat. **Ini bukan kontrol keamanan.**
2. `POST /api/rooms/{code}/frames` → URL upload presigned (maks. 10 MB, content-type `image/png|image/webp`).
3. Setelah upload: server memeriksa **magic bytes**, decode dengan library image yang aman (misal `sharp`/libvips), cek dimensi (600–6000 px sisi terpanjang), tolak animasi.
4. **Re-encode** ke PNG/WebP baru (membuang metadata dan chunk tak dikenal).
5. Analisis alpha: cari komponen transparan (alpha < 16) dengan luas ≥ 2% kanvas → kandidat slot ("4 lubang ketemu").
6. Simpan aset + metadata `FrameTemplate` kategori `CUSTOM`. Broadcast `frame.added`.
7. Batas: 20 frame custom per room, 20 upload/jam/peserta (DEC-067).

| Error | Kode | Teks UI |
|---|---|---|
| > 10 MB | `FRAME_TOO_LARGE` | "{nama} kebesaran ({ukuran}). Maksimal 10 MB." |
| Format salah | `FRAME_UNSUPPORTED` | "Format ini belum bisa. Pakai PNG atau WebP." |
| Dimensi | `FRAME_DIMENSIONS` | "Ukurannya harus antara 600 dan 6000 px di sisi terpanjang." |
| Rusak | `FRAME_DECODE_FAILED` | "File-nya gak kebaca. Coba ekspor ulang." |
| Kuota | `FRAME_QUOTA` | "Room ini udah punya 20 frame custom." |

## 10. Adaptasi frame custom (REQ-FRAME-14)

Aturan utama: **artwork tidak pernah diskalakan secara non-uniform.**

| Mode | Perilaku | Kapan dipakai |
|---|---|---|
| `FIXED` | Kanvas output mengikuti rasio artwork. Ukuran output diskalakan seragam. | Default jika frame punya lubang slot terdeteksi. |
| `CONTAIN` ("Pas otomatis") | Artwork diskalakan seragam agar muat; sisa diisi warna latar (`palette.bg` atau warna dominan tepi). | Rasio output berbeda dari artwork. |
| `COVER` ("Penuhi") | Artwork diskalakan seragam untuk menutup kanvas; bagian yang keluar dipotong. Peringatan jika > 15% artwork terpotong. | Artwork berupa tekstur/latar. |
| `NINE_SLICE` | Sudut tetap ukuran (skala seragam), tepi dan tengah di-**tile** (diulang), bukan di-stretch. | Frame berbingkai dengan pola tepi. Inset diisi pengguna di "Atur slot" atau dari metadata. |
| `PATTERN` ("Ulangi pola") | Artwork diulang sebagai pola. | Pola kecil. |

Slot dari lubang yang terdeteksi ikut ditransformasikan dengan transform artwork yang sama, sehingga lubang dan foto tetap pas.

**Peringatan kualitas:** jika export memerlukan artwork diperbesar > 1.25× dari resolusi aslinya, tampilkan "Frame ini bakal sedikit buram di ukuran {preset}" (NFR-12).

## 11. Transformasi

| Objek | Transform yang didukung | Disimpan di |
|---|---|---|
| Slot | x, y, w, h, rotation, radius | `layout.slots` (studio, bersama) |
| Foto di dalam slot | crop rect, zoom (1–4×), offset, rotation 90° kelipatan, flip | Dokumen editor (11) setelah capture |
| Frame | mode adaptasi, warna latar, opacity overlay (0.5–1) | `studio.frame` |
| Item collage | x, y, scale, rotation, z | Dokumen editor |

## 12. Live preview (REQ-FRAME-10)

- Perubahan bersama dikirim sebagai intent → server → broadcast `studio.updated {patch, by, version}`. Target ≤ 1 detik (p95) sampai terlihat di klien lain.
- Melihat frame di library adalah **pratinjau lokal** (tidak disinkron), dengan presence "lagi lihat X".
- Studio menampilkan feed live di slot; panel "Hasil sementara" menampilkan foto accepted untuk shot yang sudah selesai.
- Performa: pratinjau frame memakai aset resolusi layar (≤ 2× DPR); aset resolusi penuh hanya untuk export.

## 13. Kompatibilitas render & export

- Render export memakai scene yang sama dengan pratinjau (DEC-039) pada `pixelRatio` = skala export.
- Filter dibuat dengan operasi canvas yang juga tersedia saat export (misal `ctx.filter` atau shader/LUT sederhana), sehingga hasil export sama dengan tampilan. Jika `ctx.filter` tidak didukung (Safari lama), pakai implementasi per-piksel di Web Worker.
- Font dekor frame (tanggal, caption) harus sudah termuat sebelum render (`document.fonts.ready`).
- Batas memori: export > 16 juta piksel dirender per tile (strip panjang) lalu digabung (12 §4).
