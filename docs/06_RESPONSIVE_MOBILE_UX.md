# 06 — Responsive & Mobile UX

| Atribut | Nilai |
|---|---|
| Versi | 1.1.0 |
| Requirement | REQ-MOB-01..12, REQ-UI-04 |
| Referensi | `03_Mobile/*.webp` (390 px), `02_Desktop/*.webp` (1280 px) |

## 1. Strategi

1. **Dua tata letak, satu sistem.** Desktop dan mobile berbagi token, komponen, state, dan logika. Yang berbeda adalah **komposisi layar**, bukan sekadar skala. Contoh: rail alat desktop menjadi tombol **Alat** + bottom sheet di mobile; drawer kanan menjadi bottom sheet; kursor menjadi outline soft-lock.
2. **Kamera/foto dulu.** Di layar photobooth, kamera/foto mendapat ruang terbesar. Kontrol dipindah ke dock bawah atau overlay mengambang.
3. **Deteksi kemampuan, bukan perangkat.** Pakai `@media (pointer: coarse|fine)`, `(hover: hover)`, dan lebar viewport. Jangan sniff user-agent kecuali untuk workaround browser yang terdokumentasi (§9).

## 2. Breakpoint (PROPOSED)

| Nama | Lebar | Layout | Referensi |
|---|---|---|---|
| `xs` | < 360 px | Mobile ringkas: grid 2×2 tetap, judul turun satu tingkat, chip lebih sempit | — |
| `sm` | 360–599 px | **Mobile** (desain acuan 390) | `03_Mobile` |
| `md` | 600–1023 px | **Tablet**: layout mobile dengan konten maks. 640 px di tengah; panel jadi sheet setengah layar di sisi bawah (portrait) atau drawer kanan 360 px (landscape ≥ 900) | Derived |
| `lg` | 1024–1439 px | **Desktop** (acuan 1280) | `02_Desktop` |
| `xl` | ≥ 1440 px | Desktop dengan konten maks. 1440; area kamera membesar, panel tetap lebarnya | Derived |

Aturan tambahan: jika tinggi viewport < 640 px di desktop, bar bawah booth dirapatkan (shutter 60 px) dan panel kanan bisa di-scroll.

## 3. Adaptasi per layar

| Layar | Desktop (`lg+`) | Mobile (`sm`) | Tablet (`md`) |
|---|---|---|---|
| SCR-01 Landing | Hero 2 kolom | 1 kolom, frame scroll horizontal | 1 kolom, hero visual lebih besar |
| SCR-05 Lobby | Grid kamera + rail kanan 310 | Grid 2×2 + kartu kode + CTA bawah | Seperti mobile, grid lebih besar |
| SCR-06 Voting | 4 kartu sejajar | Grid 2×2 | Grid 2×2 |
| SCR-08 Studio | Rail kiri, feed, panel kanan, bar bawah | **Fullscreen feed** + overlay atas + dock bawah | Feed + dock bawah; panel sebagai sheet |
| SCR-09..12 Panel | Drawer kanan 380–400 | Bottom sheet kontekstual (40–70% tinggi) | Drawer (landscape) / sheet (portrait) |
| SCR-14 Accept/Retake | 2 kolom (foto sendiri + kartu lain) | Foto sendiri besar + baris kartu ringkas + tombol bawah | Seperti mobile, kartu lain 2 kolom |
| SCR-16 Editor | Rail kiri + kanvas + panel kanan | **Kanvas fullscreen** + dock mengambang + sheet kontekstual | Kanvas + dock + sheet |
| SCR-18 Galeri | Grid 4 kolom | Masonry 2 kolom + bar aksi bawah | Masonry 3 kolom |

## 4. Target sentuh & ergonomi

| Aturan | Nilai |
|---|---|
| Minimum target | 44×44 px (Apple HIG). Area hit boleh diperluas dengan pseudo-element walau visualnya lebih kecil. |
| Aksi utama | Di zona jempol: 1/3 bawah layar. Shutter 76 px, **Pakai ini**/**Ulang** 56 px. |
| Jarak antar target | ≥ 8 px. |
| Aksi destruktif | Tidak bersebelahan langsung dengan aksi utama tanpa pemisah. "Keluar" ada di menu `⋯`, tidak di dock. |
| Long-press | Hanya sebagai jalan pintas; setiap aksi long-press punya alternatif tap. |

## 5. Safe area

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
- Padding memakai `env(safe-area-inset-*)`:
  - Overlay atas booth: `top: calc(env(safe-area-inset-top) + 8px)`.
  - Dock/sheet bawah: `padding-bottom: max(34px, calc(env(safe-area-inset-bottom) + 16px))`.
  - Landscape: inset kiri/kanan untuk notch.
- Video fullscreen boleh masuk ke area safe-area (edge-to-edge), **kontrol tidak boleh**.

## 6. Bottom sheet

| Aspek | Spesifikasi |
|---|---|
| Snap point | `peek` (≈ 180 px, misal sheet teks editor), `half` (≈ 45%), `full` (≈ 90%, tidak menutupi status bar). |
| Kontekstual | Isi sheet ditentukan konteks: memilih elemen teks → sheet teks; menekan **Alat** → sheet pilihan alat; tidak ada yang dipilih → sheet tertutup, dock saja. |
| Gestur | Drag handle untuk ganti snap; swipe ke bawah dari `peek` untuk menutup; tap scrim (jika ada) untuk menutup. |
| Kanvas tetap terlihat | Pada snap `peek`/`half`, kanvas/feed di atasnya tetap interaktif (tanpa scrim), supaya perubahan terlihat langsung. Sheet konfirmasi (keluar, sesi baru) memakai scrim. |
| Aksesibilitas | Sheet adalah `role="dialog"` dengan label. Fokus pindah ke judul sheet saat terbuka, kembali ke pemicu saat tertutup. Handle punya alternatif tombol tutup. |
| Keyboard virtual | Sheet dengan input naik di atas keyboard (§10). |

## 7. Layout camera-first (booth mobile)

Acuan: `03_Mobile/04_Live_Photobooth.webp`.

| Zona | Isi |
|---|---|
| Feed | Grid 2×2 edge-to-edge (gap 3 px) sampai tepat di atas dock. Untuk 2 peserta: 2 feed vertikal (1×2). Untuk 3: 1 besar di atas + 2 di bawah (PROPOSED). Untuk 1: fullscreen. |
| Overlay atas (glass) | Pill kode, pill mode + progres shot, tombol **Fokus** (collapse/expand). |
| Dock bawah | **Timer** (kiri), **Shutter** (tengah), **Alat** (kanan), caption status. |
| Mode fokus | Menyembunyikan overlay atas & caption, menyisakan dock + shutter. Tap layar sekali menampilkan overlay 3 detik. |

### 7.1 Editor mobile (kanvas fullscreen)

Acuan: `03_Mobile/07_Editor.webp`.

- Kanvas memenuhi layar dengan latar `--sunk`; hasil bisa di-zoom/pan dengan 2 jari **di area kosong**.
- Overlay atas: Undo, Redo, stack avatar, **Selesai**.
- Dock alat mengambang (Stiker, Teks, Coret, Filter, Layer) + chevron untuk melipat menjadi satu tombol bulat.
- Memilih elemen membuka sheet kontekstual (teks: gaya & warna; stiker: ukuran/hapus/urutan; foto: crop/filter).
- Mode **Coret**: satu jari menggambar, dua jari pan/zoom kanvas; dock menampilkan warna & ketebalan.

## 8. Gestur

| Gestur | Konteks | Aksi |
|---|---|---|
| Tap | Elemen editor | Pilih |
| Double-tap | Teks | Edit teks |
| Drag 1 jari | Elemen terpilih | Pindah |
| Pinch 2 jari | Elemen terpilih | Skala |
| Rotate 2 jari | Elemen terpilih | Rotasi (snap 0°/90° dalam ±4°) |
| Pinch 2 jari | Area kosong kanvas | Zoom tampilan (bukan dokumen) |
| Drag 1 jari | Feed sendiri di Kameraku | Geser framing |
| Pinch | Feed sendiri di Kameraku | Zoom framing |
| Swipe bawah | Sheet | Tutup/turunkan snap |
| Long-press | Elemen | Menu konteks (duplikat, depan/belakang, hapus) |

Implementasi: pakai Pointer Events (`touch-action: none` hanya pada kanvas/elemen interaktif), bukan Touch Events terpisah. Elemen yang di-drag tidak boleh memicu scroll halaman.

## 9. Keterbatasan browser mobile (harus ditangani)

| Isu | Platform | Penanganan |
|---|---|---|
| `getUserMedia` butuh HTTPS & gesture pengguna | Semua | Kamera dinyalakan dari tombol eksplisit di SCR-04. |
| Video autoplay | iOS Safari | Elemen `<video>` wajib `playsInline muted autoPlay`. |
| Tab di background menghentikan kamera | iOS/Android | Deteksi `visibilitychange`; saat kembali, cek `track.readyState` dan restart track; status peserta "Kamera off" selama di background. |
| Kamera dipakai app lain | Semua | Tangani `NotReadableError` → state `in_use`. |
| `facingMode` & daftar device | iOS | `enumerateDevices` hanya memberi label setelah izin. Pakai `facingMode: 'user'|'environment'` untuk ganti kamera. |
| Resolusi capture | iOS | `ImageCapture` tidak tersedia di Safari → ambil frame dari `<video>` ke canvas di resolusi track (DEC-072); minta constraint resolusi tinggi saat capture jika perlu (09 §7). |
| Batas memori kanvas | iOS | Area kanvas maksimum terbatas (sekitar 16,7 juta piksel di banyak versi Safari); output dibatasi DEC-042 dan render export bertahap (12 §4). |
| Unduh file | iOS | `<a download>` tidak andal → pakai `navigator.share({files})` jika tersedia, fallback buka gambar di tab baru dengan instruksi "Tekan lama → Simpan". |
| 100vh | Mobile | Pakai `100dvh`/`svh` untuk layar fullscreen. |
| Popup Google OAuth | Mobile | Popup harus dipicu langsung dari tap pengguna. |
| Orientasi | Semua | Stream kamera di-restart/disesuaikan saat orientasi berubah jika rasio track berubah. |

## 10. Keyboard virtual

- Input di sheet: pakai `visualViewport` untuk mengangkat sheet di atas keyboard.
- Input font ≥ 16 px (mencegah auto-zoom iOS).
- Saat mengedit teks di kanvas: kanvas bergeser sehingga elemen teks tetap terlihat di atas keyboard.
- `enterkeyhint`: "go" untuk kode room, "done" untuk nama.

## 11. Orientasi (DEC-058)

- Portrait adalah orientasi utama di semua layar.
- Landscape di booth & editor: dock pindah ke sisi kanan (lebar 120 px), overlay atas tetap.
- Landing, lobby, voting, galeri: layout portrait dengan konten tengah maks. 640 px.

## 12. Layar kecil (`xs`, ≤ 359 px)

- Judul display turun satu tingkat skala.
- Grid voting 2×2 tetap, tinggi pratinjau 160 px.
- Dock booth: tombol Timer/Alat hanya ikon (label disembunyikan secara visual, tetap ada untuk screen reader).

## 13. Aksesibilitas mobile

- Dukung Dynamic Type/zoom browser hingga 200% tanpa kehilangan fungsi (layout boleh scroll).
- Screen reader: VoiceOver/TalkBack bisa mengoperasikan shutter, Pakai/Ulang, voting, dan unduh.
- Editor: panel **Layer** jadi alternatif non-gestur untuk memilih, memindah (tombol panah ±4 px), dan menghapus elemen.
- Getar (vibration) tidak dipakai sebagai satu-satunya umpan balik.

## 14. Reduced motion

`@media (prefers-reduced-motion: reduce)`:

- Tanpa flash capture (ganti fade 120 ms).
- Tanpa animasi lempar koin (langsung tampilkan hasil + teks).
- Kursor remote tanpa interpolasi panjang.
- Transisi sheet tetap ada tapi ≤ 120 ms.

## 15. Checklist mobile per fase

| Fase | Wajib diverifikasi di perangkat nyata |
|---|---|
| P01 | Safe area, `100dvh`, font loading, target sentuh komponen dasar |
| P02 | Join via link di iOS Safari & Android Chrome, presence ringkas |
| P03 | Izin kamera, ganti depan/belakang, background/foreground, 4 feed stabil |
| P05 | Sheet frame/layout, gestur framing |
| P06 | Shutter & Pakai/Ulang di zona jempol, countdown sinkron dengan desktop |
| P07 | Gestur editor, sheet teks + keyboard, mode coret |
| P08 | Unduh (share sheet), Drive popup |
| P10 | Alur penuh 4 peserta campuran mobile/desktop |
