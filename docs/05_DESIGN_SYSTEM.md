# 05 — Design System

| Atribut | Nilai |
|---|---|
| Versi | 1.1.0 |
| Sumber | Visual Baseline V1 (`01_Design_System/Brand_Identity.webp` + 16 layar) |
| Fase utama | P01 (fondasi), dipakai semua fase UI |

## 0. Asal nilai token

Mockup V1 dirender dari source HTML/CSS yang dibuat bersamaan dengan gambar, sehingga sebagian besar nilai di dokumen ini **diambil langsung dari source tersebut**, bukan diukur dari gambar raster.

| Label | Arti |
|---|---|
| **V1** | Nilai persis yang dipakai untuk merender Visual Baseline V1. |
| **PROPOSED** | Nilai implementasi yang diusulkan karena V1 tidak mendefinisikannya (misal state hover, motion) atau karena perbaikan aksesibilitas. |

Perubahan atas nilai **V1** harus punya alasan (aksesibilitas/usability) dan dicatat di 18.

---

## 1. Identitas brand

### 1.1 Logo

| Elemen | Spesifikasi (V1) |
|---|---|
| **Mark** | Gulungan film (lingkaran + lubang tengah) yang mengeluarkan strip vertikal berisi **4 frame** berwarna pemain (Peach, Butter, Mint, Lilac, dari atas ke bawah). viewBox 32×48. |
| Warna mark | Fill `#3B2350` (plum) di latar terang; `#F6F3EE` di latar gelap. Lubang gulungan mengikuti warna latar. |
| Frame di mark | `#F4B9A0`, `#EED27A`, `#9DD5B8`, `#BBA9EC` (radius 1.2 dari 32). |
| **Wordmark** | `longroll` huruf kecil, **Bricolage Grotesque**, `font-stretch: 75%` (condensed), weight 700, `letter-spacing: -0.035em`, `line-height: 0.9`. |
| Lockup horizontal | Mark tinggi = 1.12 × ukuran font wordmark; jarak mark–wordmark = 0.32 × ukuran font. |
| App icon | Mark terang di kotak plum `#3B2350`, radius ≈ 27% sisi. |

**Aturan pakai**

- Ukuran minimum wordmark: 16 px (UI), 24 px (marketing).
- Ruang kosong minimum di sekitar lockup: setinggi huruf `l` pada wordmark.
- **Jangan**: mengubah urutan warna frame, memutar mark, memberi outline/shadow, memakai wordmark huruf besar, mengganti font wordmark.
- Implementasi: mark sebagai komponen SVG inline (`<LogoMark tone="light|dark" />`). Path geometri: lihat lampiran A.

### 1.2 Karakter visual

UI tenang dan editorial; keseruan berasal dari **frame, stiker, dan interaksi multiplayer**. Workspace photobooth memakai tema gelap (`stage`) supaya kamera dan foto menonjol. Dekorasi (selotip, bintang, stiker) **hanya** muncul di dalam hasil foto/frame dan ilustrasi marketing, tidak pada kontrol UI.

---

## 2. Warna

### 2.1 Token inti (V1)

| Token | Hex | Peran |
|---|---|---|
| `--bg` | `#F6F3EE` | Latar halaman (paper hangat) |
| `--surface` | `#FFFFFF` | Kartu, panel, input |
| `--sunk` | `#EFEBE5` | Latar tenggelam: area kanvas editor, tombol soft, segmen |
| `--line` | `#E6E0D8` | Garis pemisah tipis |
| `--line2` | `#D9D1C7` | Border tombol sekunder & input |
| `--ink` | `#1B1720` | Teks utama, chip aktif, toast |
| `--ink2` | `#4A4451` | Teks sekunder |
| `--mute` | `#857E8C` | Teks tersier (**lihat 2.5: tidak lolos AA untuk teks kecil**) |
| `--faint` | `#B7B0BB` | Dekoratif/disabled saja |
| `--plum` | `#3B2350` | **Satu-satunya warna aksi utama** |
| `--plum2` | `#4F3069` | Plum hover (PROPOSED dipakai untuk hover) |
| `--lav` | `#EDE7F7` | Latar aksen lembut (tool aktif, tag "Bareng") |
| `--lavd` | `#6650AE` | Teks di atas `--lav` |
| `--rec` | `#E5484D` | Titik LIVE/rekam saja |
| `--ok` | `#23845C` | Sukses (di atas putih) |
| `--warn` | `#A87114` | Peringatan (**lihat 2.5**) |
| `--err` | `#C03B3A` | Error / aksi destruktif |

### 2.2 Tema stage (workspace photobooth, V1)

| Token | Nilai | Peran |
|---|---|---|
| `--stage` | `#131015` | Latar booth |
| `--stage2` | `#1D1920` | Panel/drawer |
| `--stage3` | `#29242D` | Tombol & segmen di stage |
| `--sline` | `rgba(255,255,255,.08)` | Garis pemisah di stage |
| Glass | `rgba(19,16,21,.42)` + `backdrop-filter: blur(12px)` | Label di atas video/foto |
| Tombol primary stage | Latar `#FFFFFF`, teks `--stage` | Shutter, **Pakai ini**, **Pasang buat semua** |

### 2.3 Warna pemain (V1)

| Slot | Nama | `tint` (latar) | `mid` (ring, kursor, bar) | `deep` (teks di atas tint) | Kontras deep/tint |
|---|---|---|---|---|---|
| P1 | Peach | `#FBE4D8` | `#F2AE8C` | `#9C4A27` | 5.02:1 ✅ |
| P2 | Butter | `#F6EDC6` | `#E2C352` | `#7A5F12` | 5.14:1 ✅ |
| P3 | Mint | `#D9F0E4` | `#7FC6A2` | `#22684A` | 5.57:1 ✅ |
| P4 | Lilac | `#E8E2F8` | `#A592E0` | `#56429F` | 6.23:1 ✅ |

Aturan:

- Warna pemain **hanya** untuk identitas orang (avatar, ring kamera sendiri, kursor, outline soft-lock, bar progres vote). **Tidak pernah** untuk tombol aksi.
- Label kursor: teks `--ink` di atas `mid` (kontras 6.5–10.2:1 ✅).
- Warna tidak boleh jadi satu-satunya pembeda: selalu disertai nama/inisial.

### 2.4 Warna semantik untuk status

| Status | Latar | Teks/ikon | Contoh |
|---|---|---|---|
| Udah pakai / sukses | `#DDF1E6` | `--ok` | Chip "Udah pakai" |
| Ngulang | `#F6EDC6` | `#7A5F12` | Chip "Ngulang · ke-2" |
| Netral / lagi milih | `--sunk` | `--ink2` | Chip "Lagi milih…" |
| Keputus / error | `#F8E2E1` | `--err` | Chip "Keputus" |
| Banner retensi | `#F6EDC6` | `#5E4A12` (7.24:1) | Banner galeri |
| Di stage: sukses | `rgba(127,198,162,.16)` | `#BFE8D2` | Chip di SCR-14 |
| Di stage: ngulang | `rgba(226,195,82,.16)` | `#EBD27E` | Chip di SCR-14 |

### 2.5 Kontras: hasil hitung & koreksi

Rasio dihitung dengan rumus WCAG 2.x.

| Pasangan | Rasio | Status | Tindakan |
|---|---|---|---|
| `--ink` / `--bg` | 15.94 | ✅ | — |
| `--ink2` / `--bg` | 8.48 | ✅ | — |
| `--mute` / `--bg` | **3.54** | ❌ teks kecil | **PROPOSED:** tambah token `--mute-text: #6F6876` (4.84:1 di `--bg`, 5.36:1 di putih) untuk teks < 18.66 px bold / < 24 px regular. `--mute` hanya untuk ikon/label besar/dekoratif. |
| `--mute` / `#FFF` | **3.92** | ❌ teks kecil | Sama seperti di atas. |
| `#FFF` / `--plum` | 13.62 | ✅ | — |
| `--lavd` / `--lav` | 5.23 | ✅ | — |
| `--ok` / `#FFF` | 4.64 | ✅ | — |
| `--ok` / `--bg` | **4.19** | ⚠ | Jangan pakai teks `--ok` langsung di `--bg`; pakai di atas putih/chip. |
| `--warn` / `#FFF` | **4.17** | ❌ | **PROPOSED:** `--warn: #8C5E10` (5.64:1). |
| `--err` / `#FFF` | 5.35 | ✅ | — |
| `#FFF` / `--stage` | 18.87 | ✅ | — |
| `--faint` / `--bg` | 1.91 | ❌ | Dekoratif saja, tidak untuk teks informatif. |

---

## 3. Tipografi

### 3.1 Keluarga font (V1, CONFIRMED DEC-014)

| Peran | Font | Pengaturan | Pakai untuk |
|---|---|---|---|
| **Display condensed** (`.dc`) | Bricolage Grotesque (variable: `opsz`, `wdth`, `wght`) | `font-stretch: 75%`, weight 700, `letter-spacing: -0.03em`, `line-height: 0.86–0.95` | Wordmark, judul halaman, kode room, angka countdown, judul section |
| **Display** (`.d`) | Bricolage Grotesque | `font-stretch: 88%`, weight 650, `letter-spacing: -0.025em` | Judul kartu, nama mode, judul panel |
| **Aksen editorial** (`.s`) | Instrument Serif **Italic** | weight 400, `letter-spacing: -0.005em` | Maksimal **satu frasa per judul** ("*model apa?*"), angka langkah `01–04`, caption di frame/stiker teks |
| **UI** | Figtree (variable `wght`) | Body 14.5 px / 1.5, weight 400–700 | Semua teks antarmuka |
| **Angka** | Figtree + `font-variant-numeric: tabular-nums` | — | Timer, kode room, `1/4`, persentase |

Implementasi: self-host file font (lisensi OFL 1.1), `font-display: swap`, preload Bricolage dan Figtree untuk halaman pertama. Instrument Serif boleh di-load lazy.

### 3.2 Skala tipe

| Token | Desktop | Mobile | Font | Contoh |
|---|---|---|---|---|
| `display-xl` | 74–96 px / 0.86 | 52–60 px / 0.86 | `.dc` | Hero landing |
| `display-l` | 52–64 px / 0.9 | 34–44 px / 0.9 | `.dc` | Judul layar ("Galeri malam ini.") |
| `display-m` | 34–40 px / 1.0 | 28–34 px / 0.95 | `.dc` | Judul accept/retake, lobby |
| `title` | 18–21 px | 15–18 px | `.d` | Nama mode, judul panel |
| `body-l` | 15–17 px / 1.6 | 15 px / 1.5 | Figtree 400 | Deskripsi hero |
| `body` | 14.5 px / 1.5 | 14 px / 1.5 | Figtree 400–600 | Teks umum |
| `small` | 12.5–13.5 px | 12–13 px | Figtree 500–600 | Caption, status |
| `cap` | 11 px, weight 700, `letter-spacing: .09em`, UPPERCASE | 10.5–11 px | Figtree | Label section ("CARA KERJA") |
| `serif-accent` | ±0.9× ukuran judul yang menyertai | sama | Instrument Serif Italic | "*dari mana aja.*" |

Aturan: teks body minimum 12 px; teks dengan informasi penting minimum 13 px di mobile.

---

## 4. Spasi, radius, bayangan, border

### 4.1 Skala spasi (V1, basis 2/4)

`2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80` px.

| Konteks | Nilai |
|---|---|
| Padding halaman desktop | 56 px (landing), 20–32 px (room) |
| Padding halaman mobile | 16 px (≥ 12 px di stage edge-to-edge) |
| Gap grid kamera | 8–10 px desktop, 8 px mobile lobby, 3 px booth fullscreen mobile |
| Padding kartu | 18–24 px |

### 4.2 Radius (V1)

| Token | Nilai | Pakai |
|---|---|---|
| `r-xs` | 7–8 px | Tag, item segmen |
| `r-sm` | 10 px | Tombol sm, pill kode |
| `r-md` | 12 px | Tombol md, input kecil |
| `r-lg` | 14–16 px | Tombol lg/xl, kartu kamera di stage, toast |
| `r-xl` | 18–22 px | Kartu kamera lobby, kartu mode, panel drawer |
| `r-2xl` | 24–28 px | Bottom sheet (atas saja), booth window landing |
| `r-pill` | 999 px | Chip, avatar |

### 4.3 Bayangan (V1)

| Token | Nilai |
|---|---|
| `--sh1` | `0 1px 2px rgba(27,23,32,.05), 0 2px 10px rgba(27,23,32,.05)` |
| `--sh2` | `0 2px 6px rgba(27,23,32,.06), 0 14px 34px rgba(27,23,32,.09)` |
| `--sh3` | `0 10px 26px rgba(27,23,32,.12), 0 36px 70px rgba(27,23,32,.14)` |
| Primary button | `0 1px 2px rgba(59,35,80,.3), 0 6px 16px rgba(59,35,80,.18)` |
| Sheet | `0 -10px 40px rgba(19,16,21,.18)` |

### 4.4 Border

V1 memakai **inset box-shadow 1 px** sebagai border (`inset 0 0 0 1px var(--line2)`) agar tidak mengubah ukuran elemen. Garis tebal tidak dipakai.

---

## 5. Tombol (V1)

| Varian | Latar | Teks | Border | Pakai |
|---|---|---|---|---|
| `primary` | `--plum` | `#FFF` | — + shadow plum | Satu aksi utama per layar |
| `secondary` | `--surface` | `--ink` | inset 1 px `--line2` | Aksi alternatif |
| `soft` | `--sunk` | `--ink` | — | Aksi dalam input/kartu |
| `ghost` | transparan | `--ink2` | — | Aksi tersier, ikon di header |
| `danger` | `--surface` | `--err` | inset `--line2` | Keluar sekarang, hapus |
| Stage `primary` | `#FFF` | `--stage` | — | Aksi utama di booth |
| Stage default | `--stage3` | `#FFF` | — | Aksi sekunder di booth |

| Ukuran | Tinggi | Padding X | Radius | Font |
|---|---|---|---|---|
| `sm` | 34 | 12 | 10 | 13 px / 600 |
| `md` | 42 | 16 | 12 | 14 px / 600 |
| `lg` | 50 | 22 | 14 | 15 px / 600 |
| `xl` | 56 | 26 | 16 | 16 px / 600 |
| Ikon | lebar = tinggi | — | sama | Ikon 15–19 px |
| **Shutter** | 70 (desktop) / 76 (mobile) | — | 50% | Lingkaran putih + ring dalam 2 px + ikon kamera |

State (PROPOSED): hover = `--plum2` (primary) / latar `--sunk` (secondary); active = `transform: scale(.98)`; focus-visible = `0 0 0 2px var(--bg), 0 0 0 4px #8E74C9`; disabled = latar `--sunk`, teks `--faint`, `cursor: not-allowed`; loading = spinner 16 px menggantikan ikon, label tetap.

## 6. Input

| Elemen | Spesifikasi |
|---|---|
| Teks | Tinggi 52 px, radius 14, padding 16, font 16 px (mencegah zoom iOS), inset border `--line2`. |
| Fokus | `inset 0 0 0 1.5px var(--plum), 0 0 0 4px rgba(102,80,174,.14)`. |
| Error | `inset 0 0 0 1.5px var(--err)` + teks error 12.5 px di bawah, `aria-describedby`. |
| Kode room | 6 kotak (58×66 desktop, fleksibel di mobile), Display 24–28 px, tabular. Secara teknis **satu** `<input>` dengan presentasi bersegmen. |
| Counter | Kanan dalam input, 13 px `--mute-text`. |

## 7. Chip, tag, segmen, toggle, slider

| Komponen | Spesifikasi (V1) |
|---|---|
| Chip | Tinggi 30 (28 di mobile), radius pill, 12.5 px/600. Default `--sunk`/`--ink2`; aktif `--ink`/`#FFF`; outline `inset 1px --line2`. |
| Tag | Tinggi 22, radius 7, 11 px/700. `Bareng`: `--lav`/`--lavd` + ikon users. `Cuma kamu`: `--sunk`/`--ink2` + ikon mata. Di stage: varian transparan. |
| Segmen | Wadah `--sunk` padding 3 radius 11; item tinggi 30 radius 8; item aktif `--surface` + `--sh1`. |
| Toggle | 40×24, knob 18, aktif `--plum` (stage: putih). |
| Slider | Track 4 px `--sunk`, isi `--plum`, thumb 20 px putih + shadow. Label kiri, nilai kanan (tabular). |

## 8. Kartu, modal, toast, bottom sheet

| Komponen | Spesifikasi |
|---|---|
| Kartu | `--surface`, radius 20, `--sh1`. Kartu terpilih: `0 0 0 2px var(--plum)` + `--sh2`. |
| Modal (desktop) | Lebar 480–520, radius 28, `--sh3`, scrim `rgba(27,23,32,.28)`. Fokus terperangkap, `Esc` menutup (kecuali konfirmasi destruktif). |
| Toast | Latar `--ink`, teks putih 13 px/600, radius 14, padding 9/9/9/12, `--sh3`. Tombol aksi dalam toast: latar `rgba(255,255,255,.14)`, radius 8, tinggi 28. Varian peringatan: latar putih, ikon `--warn`. |
| Bottom sheet | Radius 24 (atas), handle 36×5 `--line2`, padding samping 16, padding bawah `max(34px, env(safe-area-inset-bottom) + 16px)`. Di stage: latar `--stage2`. |
| Banner | Radius 13–14, padding 10–16, ikon 15–18 px + teks. |

## 9. Navigasi & toolbar

| Komponen | Spesifikasi |
|---|---|
| Header room desktop | 60 px (lihat 04 §0.2). |
| Stepper sesi | Wadah `--sunk` (stage: `--stage2`) tinggi 32 radius 10; item tinggi 26 radius 7, 12.5 px. |
| Rail alat desktop | Lebar 60–76 px, item ikon 19 px + label 11 px/600, radius 13. Aktif light: `--lav`/`--plum`; aktif stage: putih/`--stage`. |
| Dock mobile | Booth: tinggi 150 px termasuk safe area. Editor: pill mengambang `--surface` radius 14 `--sh2`, item 40×36, bisa dilipat. |
| Tabs/kategori | Chip yang bisa di-scroll horizontal, tanpa scrollbar terlihat, fade di tepi kanan. |

## 10. Kartu kamera (camera panel)

| Bagian | Spesifikasi (V1) |
|---|---|
| Wadah | `object-fit: cover`, radius 14–18 (lobby 18, stage 16, booth fullscreen mobile 0). |
| Tag nama | Glass, kiri-bawah 10 px, tinggi 26 (24 mobile), avatar 18 + nama 12 px/700. Kamera sendiri: "Kamu". |
| Kamera sendiri | Ring: `0 0 0 2px <latar>, 0 0 0 3.5px <player.mid>`. |
| Badge status | Kanan-bawah atau kanan-atas: `✓ Siap` (putih, teks `--ok`), teks bebas glass ("Benerin rambut…"), `LIVE` glass dengan titik merah. |
| State | `live`, `connecting` (skeleton + teks), `camera_off` (avatar besar di `--stage2` + "Kamera {nama} lagi off"), `permission` (blur + ikon kamera + "Ngizinin kamera…"), `reconnecting` (grayscale + blur + ring progres `#F0D58A` + "Nyambung lagi… 0:24"), `empty` (inset dashed 1.5 px + ikon plus + "Slot kosong" + **Salin link**). |
| Countdown di kartu | Lingkaran glass 64–96 px berisi angka `.dc`. |

## 11. Presence

| Platform | Indikator |
|---|---|
| Desktop | Kursor panah 15×17 dengan fill `player.mid` + stroke putih 1.4; label pill tinggi 19 px, radius 6, latar `mid`, teks `--ink` 11 px/700, bisa memuat aksi ("Raka · nempel stroberi"). |
| Mobile | Tanpa kursor. Elemen yang sedang dipegang: outline 1.5 px `player.mid` + avatar 18 px di sudut kanan atas. |
| Soft-lock (editor) | Outline + handle sudut 9×9 putih dengan stroke warna pemain. |
| Daftar peserta | Avatar (foto mini dari kamera jika tersedia, fallback inisial di `tint`/`deep`) + titik status 30% ukuran avatar (`--ok`, `--warn`, `--faint`). |
| Stack avatar | Overlap −7 px, ring 2 px warna latar. |

## 12. Kanvas foto, frame, filter

| Elemen | Spesifikasi |
|---|---|
| Latar kanvas editor | `--sunk`; hasil dengan `--sh3`. |
| Thumbnail frame | Wadah 150 px (desktop) / 112 px (mobile) di `--stage3`, radius 13–14. Terpilih: ring 2 px latar + 4 px putih + centang bulat kiri atas. Avatar peserta yang sedang melihat: kanan atas. |
| Gaya frame V1 | **Seoul Strip** (Korean: putih, 4 foto vertikal, mark + tanggal mono di bawah), **Editorial** (minimal: off-white, 1 foto besar + 3 kecil, caption serif + nama caps), **Film 400** (retro: hitam dengan lubang sprocket, nomor frame `24A` oranye `#E39A3C`), **Scrapbook** (kertas kraft `#EFE5D3` bertitik, polaroid miring, selotip, caption serif), **Lilac Dream** (pastel: gradien `#F7D6E2→#DCD2F6`, pola titik, foto rounded ber-outline putih, "♡ besties ♡"), **Mosaic** (grid custom: 1 besar + 5 kecil). |
| Filter preset (PROPOSED nilai) | `Asli` (none), `Hangat` (`sepia(.18) saturate(1.12) brightness(1.03)`), `Sejuk` (`saturate(.88) hue-rotate(-6deg) brightness(1.04)`), `Pudar` (`contrast(.88) brightness(1.08) saturate(.82)`), `Film` (`contrast(1.08) saturate(.9) sepia(.12)`), `Mono` (`grayscale(1) contrast(1.08) brightness(1.03)`). Render export harus memberi hasil yang sama (12 §4). |

## 13. Interaksi & motion (PROPOSED)

| Token | Nilai | Pakai |
|---|---|---|
| `motion-fast` | 120 ms `cubic-bezier(.2,.8,.2,1)` | Hover, tekan |
| `motion-base` | 200 ms | Chip, toggle, toast masuk |
| `motion-sheet` | 280 ms `cubic-bezier(.32,.72,0,1)` | Bottom sheet, drawer |
| `motion-emph` | 420 ms | Reveal hasil vote, flash capture |

Prinsip: motion menjelaskan perubahan state (siapa yang mengubah apa), bukan dekorasi. Kursor remote diinterpolasi (lerp ≤ 100 ms). `prefers-reduced-motion: reduce` → transisi menjadi fade ≤ 120 ms, tanpa flash, tanpa animasi lempar koin.

## 14. Ikonografi

- Gaya: garis **1.75 px**, ujung & sambungan bulat, grid 24 px, tanpa fill (V1).
- Ukuran: 12–14 (dalam chip), 15–17 (tombol sm/md), 19–20 (rail, tombol lg), 22–28 (state kosong).
- Implementasi (PROPOSED): **Lucide** (lisensi ISC) dengan `strokeWidth={1.75}` cocok dengan gaya V1. Ikon khusus (shutter, mark) dibuat sebagai SVG sendiri.
- Ikon wajib berlabel teks di navigasi utama (rail, dock). Tombol ikon tunggal wajib punya `aria-label`.

## 15. Aksesibilitas desain

| Aturan | Detail |
|---|---|
| Kontras | Ikuti 2.5. Teks informatif ≥ 4.5:1, teks besar ≥ 3:1. |
| Target sentuh | ≥ 44×44 px (tombol sm 34 px hanya untuk desktop dengan pointer `fine`; di mobile minimal md 42 + area hit diperluas ke 44). |
| Fokus | Selalu terlihat (`:focus-visible`), tidak dihilangkan. |
| Warna | Tidak menjadi satu-satunya pembawa makna (status selalu ikon + teks). |
| Teks di atas video | Selalu di dalam glass pill, tidak langsung di atas video. |
| Bahasa | `lang="id"`. Copy santai tapi jelas: hindari slang yang ambigu untuk instruksi kritis (izin kamera, penghapusan data). |

## 16. Token sebagai CSS custom properties (referensi implementasi)

```css
/* Dokumentasi struktur token — bukan kode final */
:root {
  --bg:#F6F3EE; --surface:#FFFFFF; --sunk:#EFEBE5; --line:#E6E0D8; --line2:#D9D1C7;
  --ink:#1B1720; --ink2:#4A4451; --mute:#857E8C; --mute-text:#6F6876; --faint:#B7B0BB;
  --plum:#3B2350; --plum2:#4F3069; --lav:#EDE7F7; --lavd:#6650AE;
  --rec:#E5484D; --ok:#23845C; --warn:#8C5E10; --err:#C03B3A;
  --stage:#131015; --stage2:#1D1920; --stage3:#29242D; --sline:rgba(255,255,255,.08);
  --p1-tint:#FBE4D8; --p1-mid:#F2AE8C; --p1-deep:#9C4A27;
  --p2-tint:#F6EDC6; --p2-mid:#E2C352; --p2-deep:#7A5F12;
  --p3-tint:#D9F0E4; --p3-mid:#7FC6A2; --p3-deep:#22684A;
  --p4-tint:#E8E2F8; --p4-mid:#A592E0; --p4-deep:#56429F;
}
```

Catatan: `--warn` dan `--mute-text` di atas adalah nilai **PROPOSED** (koreksi aksesibilitas), menggantikan `--warn: #A87114` milik V1 untuk teks.

---

## Lampiran A — Geometri mark (viewBox 0 0 32 48)

| Elemen | Geometri |
|---|---|
| Gulungan | `circle cx=12 cy=10 r=9` (fill mark) |
| Lubang | `circle cx=12 cy=10 r=3.2` (fill latar) |
| Strip | `path M12 1 h12 a3 3 0 0 1 3 3 v39 a3 3 0 0 1 -3 3 H15 a3 3 0 0 1 -3 -3 V19` |
| Frame 1–4 | `rect x=15 w=9 rx=1.2` pada `y=9 (h7)`, `y=18.5 (h7)`, `y=28 (h7)`, `y=37.5 (h6)` |
