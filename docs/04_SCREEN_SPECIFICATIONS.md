# 04 — Screen Specifications

| Atribut | Nilai |
|---|---|
| Versi | 1.1.0 |
| Referensi visual | `LONGROLL_FINAL_VISUAL_REVIEW.zip` (Visual Baseline V1) |
| Komponen & token | [05_DESIGN_SYSTEM.md](05_DESIGN_SYSTEM.md) |
| Aturan mobile | [06_RESPONSIVE_MOBILE_UX.md](06_RESPONSIVE_MOBILE_UX.md) |

## 0. Cara membaca

- **Status visual**
  - `V1-APPROVED`: layar tergambar di 17 gambar V1. Implementasi harus mengikuti gambar, kecuali bertentangan dengan requirement (lihat kolom "Penyimpangan dari mockup").
  - `DERIVED`: layar tidak tergambar di V1. Desainnya **diturunkan** dari design system dan belum disetujui secara visual. Tampilannya harus direview sebelum fase terkait ditutup.
- **File referensi** relatif terhadap root `LONGROLL_FINAL_VISUAL_REVIEW/`.
- **Tema**: `light` (paper) atau `stage` (gelap, workspace photobooth).

### 0.1 Inventaris layar

| ID | Layar | Tema | Status visual | Referensi desktop | Referensi mobile | Fase |
|---|---|---|---|---|---|---|
| SCR-01 | Landing | light | V1-APPROVED | `02_Desktop/01_Landing.webp` | `03_Mobile/01_Landing.webp` | P01, P02 |
| SCR-02 | Bikin room | light | DERIVED | — | — | P01 (kerangka layout), P02 |
| SCR-03 | Gabung room | light | DERIVED | — | — | P01 (kerangka layout), P02 |
| SCR-04 | Cek kamera | light | DERIVED | — | — | P03 |
| SCR-05 | Room lobby | light | V1-APPROVED | `02_Desktop/02_Lobby.webp` | `03_Mobile/02_Lobby.webp` | P01 (kerangka layout), P02, P03 |
| SCR-06 | Voting mode | light | V1-APPROVED | `02_Desktop/03_Voting.webp` | `03_Mobile/03_Voting.webp` | P04 |
| SCR-07 | Hasil vote / seri | light | DERIVED | — | — | P04 |
| SCR-08 | Studio (live photobooth) | stage | V1-APPROVED | `02_Desktop/04_Live_Photobooth.webp` | `03_Mobile/04_Live_Photobooth.webp` | P03, P05, P06 |
| SCR-09 | Panel Frame library | stage | V1-APPROVED | `02_Desktop/05_Frame_Library.webp` | `03_Mobile/05_Frame_Library.webp` | P05 |
| SCR-10 | Panel Upload frame | stage | DERIVED | — | — | P05 |
| SCR-11 | Panel Layout & kanvas | stage | DERIVED | — | — | P05 |
| SCR-12 | Panel Kameraku | stage | DERIVED | — | — | P03, P05 |
| SCR-13 | Countdown & capture | stage | DERIVED | — | — | P06 |
| SCR-14 | Pakai / Ulang (accept/retake) | stage | V1-APPROVED | `02_Desktop/06_Accept_Retake.webp` | `03_Mobile/06_Accept_Retake.webp` | P06 |
| SCR-15 | Nunggu peserta lain | stage | DERIVED (state dari SCR-14) | — | — | P06 |
| SCR-16 | Editor kolaboratif | light | V1-APPROVED | `02_Desktop/07_Editor.webp` | `03_Mobile/07_Editor.webp` | P07 |
| SCR-17 | Hasil akhir & export | light | DERIVED | — | — | P08 |
| SCR-18 | Galeri sementara | light | V1-APPROVED | `02_Desktop/08_Gallery.webp` | `03_Mobile/08_Gallery.webp` | P08 |
| SCR-19 | Ajakan sesi baru | light | DERIVED | — | — | P08 |
| SCR-20 | Overlay putus/nyambung lagi | stage/light | DERIVED | — | — | P02, P03, P06 |
| SCR-21 | Room bubar | light | DERIVED | — | — | P01 (kerangka layout), P02 |
| SCR-22 | Feedback sistem (toast, error, konfirmasi) | keduanya | Sebagian V1 (toast di `07_Editor`, `01_Design_System/Brand_Identity.webp`) | — | — | Semua |

### 0.2 Chrome room bersama

**Header desktop (light & stage)** — sesuai `02_Lobby`, `03_Voting`, `07_Editor`:

- Tinggi 60 px. Kiri: wordmark → pemisah → pill kode room (`Room BOBA27` + ikon salin). Opsional: tag status (`Lobby`, `Galeri`).
- Tengah (absolut): **stepper sesi** `Vote · Foto · Edit · Hasil`. Langkah aktif berlatar surface, langkah selesai bertanda centang, langkah mendatang opacity 45%.
- Kanan: aksi kontekstual (misal Undo/Redo + **Selesai edit** di editor), stack avatar peserta, tombol keluar (ikon).
- Tema stage memakai garis bawah `--sline` dan wordmark versi terang.

**Header mobile**: tinggi 52 px. Kiri: pill kode `BOBA27`. Kanan: stack avatar (24 px) + tombol menu `⋯` (berisi: salin link, QR, keluar). Di booth mobile, header berubah menjadi **overlay mengambang** di atas feed (glass), lihat SCR-08.

---

## SCR-01 — Landing

| Field | Spesifikasi |
|---|---|
| Tujuan | Menjelaskan LONGROLL dalam satu layar dan mengarahkan ke Bikin room / Gabung. |
| Masuk | URL `/`. |
| Keluar | **Bikin room** → SCR-02. **Gabung** (kode valid) → SCR-03. Link nav ke section di halaman yang sama. |
| Navigasi | Nav atas: wordmark, `Cara kerja`, `Frame`, `Mode`, `FAQ`, tombol **Gabung pakai kode** (scroll/fokus ke input kode). Mobile: wordmark + tombol **Gabung**. |
| Layout | (1) Hero dua kolom: kiri teks + CTA, kanan "booth window" stage berisi 4 feed contoh + angka countdown + strip miring dengan selotip. (2) Section **Frame**: 6 gaya frame berjajar dengan nama & kategori. (3) **Cara kerja**: 4 kartu bernomor serif `01–04`. (4) CTA penutup tema stage + 3 fakta + footer. |
| Komponen | Wordmark, chip info ber-dot warna pemain, judul display + aksen serif, tombol primary XL, input kode + tombol soft, kartu langkah, thumbnail frame, footer. |
| Informasi | "Sampai 4 orang · tanpa akun · tanpa host". Catatan retensi: "Room sementara: foto dan datanya dihapus setelah room kedaluwarsa." |
| Aksi primer | **Bikin room**. |
| Aksi sekunder | Input kode + **Gabung**. |
| Interaksi | Input kode: huruf besar otomatis, maks 6, karakter selain alfabet DEC-022 diabaikan; Enter = Gabung. Gabung memanggil preview (F-03) dan menampilkan error inline di bawah input. |
| Loading | Tombol Gabung → spinner di tombol, input dikunci. |
| Empty | Tidak ada. |
| Error | Kode tidak ditemukan, room penuh, rate limit (teks: 03 F-03). |
| Desktop | Lebar konten maks. 1280 px, padding horizontal 56 px. Hero kiri 470 px. |
| Mobile | Satu kolom: chip → judul (60 px) → deskripsi → booth window 2×2 (tinggi 300 px) dengan strip mini menjorok → CTA penuh → input kode → catatan. Section Frame bisa di-scroll horizontal. |
| Aksesibilitas | `<h1>` tunggal. Feed contoh adalah gambar dekoratif (`alt=""`) dengan deskripsi teks di dekatnya. Input kode punya `<label>` (boleh visually-hidden) dan `aria-describedby` untuk error. |
| Requirement | REQ-ROOM-01, -03, -05; REQ-UI-01..02; REQ-MOB-01 |
| Penyimpangan dari mockup | Gambar feed di mockup adalah placeholder; implementasi memakai ilustrasi/foto contoh berlisensi atau render statis yang netral. |

## SCR-02 — Bikin room `DERIVED`

| Field | Spesifikasi |
|---|---|
| Tujuan | Mengumpulkan display name lalu membuat room. |
| Masuk | Dari SCR-01 **Bikin room**. |
| Keluar | Sukses → SCR-04. **Balik** → SCR-01. |
| Layout | Desktop: kartu tengah 2 kolom (kiri form, kanan pratinjau warna/kamera jika izin sudah ada, jika belum: ilustrasi strip). Mobile: satu kolom, CTA menempel di bawah. |
| Komponen | Input "Nama panggilan" (dengan counter `5/20`), pratinjau warna pemain (read-only, warna ditentukan server: DEC-044), tombol primary **Bikin room**. |
| Interaksi | Validasi live: kosong → tombol disabled; > 20 → counter merah + pesan. |
| Loading | Tombol menampilkan spinner "Bikin room…". |
| Error | Rate limit; jaringan; nama ditolak setelah sanitasi. |
| Aksesibilitas | Fokus otomatis ke input nama. Error diumumkan via `aria-live="polite"`. |
| Requirement | REQ-ROOM-01..04, DEC-043 |

## SCR-03 — Gabung room `DERIVED`

| Field | Spesifikasi |
|---|---|
| Tujuan | Validasi kode/link dan mengumpulkan nama. |
| Masuk | Dari SCR-01 (kode) atau `/r/{code}`. |
| Keluar | Sukses → SCR-04. Room bubar → SCR-21. |
| Layout | Kode 6 kotak (terkunci jika dari link) → kartu "Room ketemu · 3/4" dengan **avatar inisial** peserta (tanpa feed) → input nama → **Gabung ke BOBA27**. |
| State | `valid`, `not_found`, `full`, `expired`, `rate_limited`. |
| Error | `full`: "Udah 4 orang di dalem." + **Bikin room baru**. `not_found`: pesan + **Coba lagi**. |
| Aksesibilitas | 6 kotak kode berperilaku sebagai **satu** input (paste 6 karakter langsung terisi). |
| Requirement | REQ-ROOM-05, -06 |
| Catatan privasi | Preview room **tidak** menampilkan feed/foto peserta sebelum join (15 §4). |

## SCR-04 — Cek kamera `DERIVED`

| Field | Spesifikasi |
|---|---|
| Tujuan | Mendapat izin kamera dan memastikan framing sebelum masuk lobby. |
| Masuk | Setelah SCR-02/03 (DEC-077). Juga dari menu Kameraku jika izin dicabut. |
| Keluar | **Masuk ke lobby** → SCR-05. **Masuk tanpa kamera** → SCR-05 (DEC-068). |
| Layout | Desktop: pratinjau kamera besar kiri (rounded 28 px) dengan oval panduan wajah; kanan: judul, daftar status (Izin kamera ✓, pilih device, toggle cermin), slider kecerahan/zoom, CTA. Mobile: pratinjau 440 px di atas, pill kontrol mengambang (cermin, ganti kamera, kecerahan, zoom), daftar status, CTA bawah. |
| State | `prompt` (penjelasan + **Nyalain kamera**), `granted`, `denied` (langkah pemulihan per platform), `unavailable`, `in_use`. |
| Aksesibilitas | Hasil izin diumumkan. Langkah pemulihan berupa daftar bernomor. |
| Requirement | REQ-CAM-03..07, REQ-CAM-09 |

## SCR-05 — Room lobby `V1-APPROVED`

| Field | Spesifikasi |
|---|---|
| Tujuan | Menunggu peserta, mengundang, lalu memulai voting. |
| Masuk | Dari SCR-04, atau reconnect saat room dalam state lobby. |
| Keluar | **Mulai vote mode** (siapa pun) → semua ke SCR-06. Keluar → konfirmasi. |
| Layout desktop | Header (tag `Lobby`). Kiri: judul "Nungguin geng lengkap" + sub "3 dari 4 udah masuk · bisa mulai bertiga", grid 2×2 kartu kamera (radius 18). Kanan 310 px: kartu **Ajak temen** (kode display 52 px, QR, link + **Salin**), kartu **Di room · 3/4** (avatar foto + status), kartu CTA **Mulai vote mode**. |
| Layout mobile | Header ringkas. Judul 34 px. Grid 2×2 (tinggi 420 px). Kartu kode (kode 32 px, tombol QR, **Ajak** = Web Share). CTA bawah + caption "Siapa aja boleh mulai · bisa bertiga". |
| Kartu kamera | State: live (tag `LIVE` hanya pada kartu sendiri), nyalain kamera (blur + ikon + teks), kamera off, slot kosong (dashed + **Salin link undangan**). Kartu sendiri punya ring warna pemain 3.5 px. |
| Interaksi | **Salin** → toast "Link room tersalin". QR membuka modal QR besar. |
| Loading | Skeleton kartu kamera saat koneksi peer dibuat (≤ 15 detik sebelum state error). |
| Error | Peer gagal terhubung → kartu "Gak bisa nyambung ke kamera Raka" + **Coba lagi** (restart ICE). |
| Aksesibilitas | Setiap kartu kamera berlabel `Kamera {nama}, {status}`. Perubahan presence diumumkan (polite). |
| Requirement | REQ-ROOM-04, -07, -12; REQ-CAM-02, -11; REQ-MOB-10 |
| Penyimpangan dari mockup | Teks "bisa mulai bertiga" bergantung pada DEC-025; jika minimal peserta berubah, teks ikut berubah. |

## SCR-06 — Voting mode `V1-APPROVED`

| Field | Spesifikasi |
|---|---|
| Tujuan | Memilih mode secara demokratis. |
| Masuk | Mulai vote dari lobby, atau sesi baru. |
| Keluar | `vote.resolved` → SCR-07 (menang). `vote.tie` → SCR-07 (seri). |
| Layout desktop | Header + stepper (`Vote` aktif). Judul "Mau foto *model apa?*" + caption `Sesi 1 · pilih mode`. Kanan atas: kartu progres "3 dari 4 udah vote" + bar warna pemain. Grid 4 kartu mode: area pratinjau 340 px (latar tint per mode) + nama, deskripsi, avatar pemilih, jumlah suara, tombol **Pilih**. Kartu terpilih: ring plum 2 px + tag `✓ Pilihanmu`. Footer: ikon gembok + "Mode yang menang dikunci buat sesi ini. Frame dan layout tetap bisa diatur bareng." Kursor peserta lain mengambang. |
| Layout mobile | Grid 2×2 kartu (pratinjau 196 px), tanda centang bulat pada kartu terpilih, bar progres + caption gembok di bawah. |
| Interaksi | Tap kartu = pilih/ganti pilihan. Tap kartu yang sama tidak membatalkan suara (cegah salah tap). Tombol **Tutup vote** muncul jika syarat DEC-023 terpenuhi. |
| Loading | Kartu menampilkan suara setelah `vote.state` diterima. Optimistic UI dengan rollback jika server menolak. |
| Error | Vote gagal terkirim → toast + retry otomatis (idempotent: 14 §8). |
| Aksesibilitas | Kartu mode adalah `radiogroup`. Jumlah suara dibacakan. Kursor remote tidak di-fokus dan `aria-hidden`. |
| Requirement | REQ-VOTE-01..04, REQ-ROOM-10 |
| Penyimpangan dari mockup | **Kartu "Sisa waktu 0:18" tidak diimplementasikan** sebagai penutup otomatis (DEC-046). Tempatnya diganti status penutupan (misal "Nunggu Bimo" / tombol **Tutup vote**). |

## SCR-07 — Hasil vote / seri `DERIVED`

| Field | Spesifikasi |
|---|---|
| State menang | Pratinjau output besar (tint mode) + "Photo Strip *menang.*" + bar hasil per mode + avatar pemilih + gembok "Dikunci buat sesi 1" + **Masuk booth**. Semua peserta otomatis masuk studio setelah 3 detik; tombol hanya mempercepat. Ini transisi, bukan keputusan, jadi tidak melanggar REQ-CAP-09. |
| State seri | Tag `⚠ Seri 2–2`, judul "Pilih salah satu, *sekali lagi.*", 2+ kartu opsi seri, progres vote ulang. |
| State lempar koin | Animasi singkat (≤ 1.5 detik, tanpa animasi jika `prefers-reduced-motion`) + hasil + caption "Booth lempar koin karena masih seri". |
| Requirement | REQ-VOTE-05, -06; DEC-024 |

## SCR-08 — Studio / Live photobooth `V1-APPROVED`

| Field | Spesifikasi |
|---|---|
| Tujuan | Workspace utama: melihat semua feed live dalam konteks layout, mengatur, dan memulai capture. |
| Masuk | Setelah mode terkunci; setelah shot selesai (shot berikutnya). |
| Keluar | Shutter → SCR-13. Panel → SCR-09..12 (drawer). Shot terakhir selesai → SCR-16. |
| Layout desktop | Tema stage. Header + stepper (`Foto`). Rail kiri 60 px: **Frame, Layout, Kamera, Filter** (ikon + label). Tengah: grid feed 2×2 (radius 16) dengan tag nama glass kiri-bawah dan badge status kanan-bawah (`✓ Siap` putih / `Benerin rambut…` glass). Kanan 250 px: **Hasil sementara** (tag `Bareng`) dengan pratinjau output, lalu ringkasan `Mode: Photo Strip 🔒`, `Frame: Seoul Strip ›`, `Layout: 4 shot · 2:6 ›`. Bar bawah 92 px: segmen timer `3 dtk / 5 dtk / 10 dtk`, shutter putih 70 px diapit `Shot 1/4` dan `Siap 3/4`, caption "Siapa aja boleh cekrek". |
| Layout mobile | **Fullscreen canvas**: 4 feed edge-to-edge (gap 3 px) mengisi layar di atas dock bawah 150 px. Overlay atas mengambang (glass): pill kode, pill `Strip · 1/4` + 4 slot progres, tombol **collapse/expand** (masuk/keluar mode fokus). Dock bawah: tombol **Timer** (`5s`), shutter 76 px, tombol **Alat** (membuka bottom sheet pilihan Frame/Layout/Kameraku/Filter). Caption "3/4 siap · siapa aja boleh cekrek". |
| Komponen | Kartu feed (05 §10), rail alat, panel ringkasan, segmen timer, shutter, badge status. |
| Interaksi | Shutter → aturan DEC-026. Mode fokus mobile menyembunyikan overlay atas dan caption; dock tetap ada. Tap pada feed sendiri membuka Kameraku. |
| Loading | Feed remote: skeleton + "Nyambungin kamera Raka…". |
| Error | Kamera sendiri gagal → kartu sendiri "Kamera kamu lagi off" + **Nyalain lagi**. Peer putus → SCR-20. |
| Aksesibilitas | Shutter: `aria-label="Ambil foto, hitung mundur 5 detik"`. Shortcut desktop: `Space` = shutter (hanya jika fokus tidak di input), `Esc` = Tunggu!. Status siap per peserta dibacakan. |
| Requirement | REQ-CAM-01..02, -10..12; REQ-FRAME-10; REQ-CAP-01; REQ-MOB-03, -05, -06; REQ-UI-03 |
| Catatan | Feed di studio dirender sesuai BindingPlan aktif (10 §5, DEC-087). Strategi binding default **OPEN (DEC-061)**: layar ini harus berfungsi untuk komposisi grup per shot **dan** foto individual per shot. Mockup V1 (grid feed 2×2 + pratinjau strip terpisah) tetap tampilan untuk kedua strategi; yang berubah hanya isi pratinjau output. |

## SCR-09 — Panel Frame library `V1-APPROVED`

| Field | Spesifikasi |
|---|---|
| Tujuan | Memilih frame bersama dengan pratinjau langsung. |
| Layout desktop | Area tengah berubah menjadi **pratinjau besar** output dengan frame yang sedang dilihat (label `Pratinjau · Film 400`), deretan thumbnail feed live kecil di kiri bawah ("kamera tetap live"), info presence ("Sasa lagi lihat Lilac Dream"). Drawer kanan 400 px: judul **Frame** + tag `Bareng`, search, chip kategori (`Semua, Korean, Retro, Pastel, Punyaku`), grid 3 kolom thumbnail (tinggi 150 px, nama + kategori), avatar peserta yang sedang melihat sebuah frame, footer **Upload frame** + **Pasang buat semua**. |
| Layout mobile | Header ringkas `Pratinjau frame` + tutup. Pratinjau besar (tinggi 420 px) + mini feed vertikal. Bottom sheet 352 px: judul + `Bareng` + **Upload**, chip kategori, carousel horizontal thumbnail (98×112), CTA **Pasang {nama frame} buat semua**. |
| Interaksi | Tap thumbnail = **pratinjau lokal** (tidak mengubah apa pun untuk orang lain, tapi presence "lagi lihat X" dikirim). **Pasang buat semua** = perubahan bersama + toast untuk semua "Nadia pasang Film 400 · Balikin". |
| Aksesibilitas | Grid thumbnail adalah `listbox`. Nama frame sebagai label. |
| Requirement | REQ-FRAME-10..12, REQ-MOB-04 |

## SCR-10 — Panel Upload frame `DERIVED`

| Field | Spesifikasi |
|---|---|
| Layout | Drawer/bottom sheet: dropzone/tombol pilih file → pratinjau frame dengan slot terdeteksi ("4 lubang ketemu") → mode adaptasi (`Pas otomatis`, `Penuhi`, `Ulangi pola`, `9-slice` jika metadata tersedia) → **Atur slot** manual → **Pasang buat semua**. |
| Error | Ukuran/format/dimensi (DEC-041) dengan pesan spesifik, misal "frame-glitter.png kebesaran (14 MB). Maksimal 10 MB." |
| Loading | Progress upload + "Ngecek file…" (validasi server). |
| Requirement | REQ-FRAME-13, -14 |

## SCR-11 — Panel Layout & kanvas `DERIVED`

| Field | Spesifikasi |
|---|---|
| Kontrol | Susunan (strip vertikal, strip horizontal, grid, custom), jumlah shot (stepper, safeguard DEC-042: 1–8), rasio slot, preset output, jarak antar foto, radius sudut, warna latar, edit slot manual (drag/resize slot di pratinjau). |
| Kunci | Setelah shot pertama: kontrol struktur (termasuk strategi binding) disabled dengan tooltip "Dikunci setelah shot pertama" (DEC-065). |
| Strategi binding | `studio.bindingStrategy` (10 §5.2). **Apakah** kontrol ini tampil ke pengguna adalah bagian dari DEC-061 (OPEN). Jika tampil (usulan): segmen "Foto bareng per shot" / "Foto per orang". Jika tidak tampil, generator memakai default yang disetujui pemilik produk. |
| Safeguard | Kombinasi yang melewati safeguard (10 §6) menampilkan banner peringatan + alternatif, misal "8 shot × 4 orang jadi 32 foto. Pakai strip per orang atau grid biar tetap kebaca?". Tidak ada pemotongan diam-diam. Test: TC-FRAME-006. |
| Requirement | REQ-FRAME-02..09 |

## SCR-12 — Panel Kameraku `DERIVED`

| Field | Spesifikasi |
|---|---|
| Tag | `Cuma kamu` (lokal). |
| Kontrol | Pratinjau feed sendiri dengan overlay framing (drag/pinch), **Ganti** (depan/belakang), **Cermin**, **Reset**, zoom (0.5× jika didukung / 1× / 1.5× / 2×), kecerahan, kehangatan, pilih device (desktop dropdown). |
| Catatan | Keterangan: "Pengaturan ini cuma ngubah kamera kamu. Filter buat semua ada di tab Filter." |
| Requirement | REQ-CAM-05..09, -12, -13; DEC-049 |

## SCR-13 — Countdown & capture `DERIVED`

| Field | Spesifikasi |
|---|---|
| Layout | Di atas SCR-08: angka countdown besar (Display, ≥ 96 px) di dalam lingkaran progres glass di tengah area feed, teks aksen serif ("senyum dikit…"), tombol **Tunggu!** (desktop di bar bawah, mobile tombol penuh), caption "Dimulai sama Raka · shot 2 dari 4". |
| Saat T0 | Flash putih ringan 120 ms di area feed (tanpa flash jika `prefers-reduced-motion`; diganti fade). Suara shutter: tidak ada secara default. |
| Setelah T0 | Indikator "Nyimpen foto…" per kartu sampai upload selesai → SCR-14. |
| Aksesibilitas | Countdown diumumkan per detik lewat `aria-live="assertive"` hanya untuk 3 detik terakhir. |
| Requirement | REQ-CAP-01, DEC-026, DEC-027 |

## SCR-14 — Pakai / Ulang `V1-APPROVED`

| Field | Spesifikasi |
|---|---|
| Tujuan | Setiap peserta memutuskan fotonya sendiri; peserta lain melihat proses retake. |
| Layout desktop | Kiri 540 px: caption `Shot 2 dari 4 · fotomu`, judul "Pakai ini *atau ulang?*", foto sendiri besar (ring warna pemain), tombol **Ulang** (sekunder gelap) + **Pakai ini** (primary putih, lebih lebar), caption "Gak ada batas waktu. Temen-temen lihat kalau kamu ngulang." Kanan: caption "Lanjut ke shot 3 kalau semua udah 'Pakai'", kartu peserta yang retake (thumbnail attempt ditolak dengan label `✕ Take 1 · diulang` + reaksi, feed live + countdown retake, chip `Ngulang · percobaan 2`), kartu peserta lain (foto, chip `Udah pakai` / `Lagi milih…`, chip reaksi). |
| Layout mobile | Foto sendiri 500 px dengan pill `Shot 2/4 · fotomu`. Baris 3 kartu ringkas peserta lain (kartu retake lebih lebar: thumbnail ✕ + "Ngulang · ke-2"). Tombol **Ulang** + **Pakai ini** 56 px di bawah + caption tanpa batas waktu. |
| Interaksi | **Ulang** → countdown retake lokal (durasi = setting countdown bersama). **Pakai ini** → `ACCEPTED`. "Ganti pilihanku" tersedia sampai shot maju (DEC-079). Reaksi (DEC-048, opsional). |
| Larangan | Tidak boleh ada timer, progress ring, atau teks yang menyiratkan foto akan diterima otomatis (REQ-CAP-09). |
| Aksesibilitas | Foto sendiri punya `alt` "Fotomu untuk shot 2". Status peserta lain dibacakan saat berubah. |
| Requirement | REQ-CAP-02..10, REQ-MOB-11 |
| Penyimpangan dari mockup | Tidak ada. (Teks auto-accept di artefak lama dihapus.) |

## SCR-15 — Nunggu peserta lain `DERIVED`

| Field | Spesifikasi |
|---|---|
| Tujuan | State SCR-14 setelah peserta sendiri accepted. |
| Layout | Judul "Kamu udah oke. *Nunggu Raka ngulang…*", daftar status semua peserta, feed live peserta yang retake (besar), strip progres, aksi **Ganti pilihanku** dan **Colek {nama}** (DEC-080). Jika peserta wajib putus: status `Nyambung lagi…` dan setelah 15 detik tombol **Lanjut tanpa {nama}** (DEC-028). |
| Requirement | REQ-CAP-06, -08, -09 |

## SCR-16 — Editor kolaboratif `V1-APPROVED`

| Field | Spesifikasi |
|---|---|
| Tujuan | Menghias hasil bersama secara real-time. |
| Layout desktop | Header + stepper (`Edit`) + Undo/Redo + **Selesai edit**. Rail kiri 76 px: **Stiker** (aktif: latar lavender, teks plum), Teks, Coret, Filter, Frame, Layer. Tengah (latar `--sunk`): kanvas hasil dengan elemen; elemen yang dipegang peserta lain diberi outline warna + handle; kursor peserta dengan label aksi ("Raka · nempel stroberi"); toast konflik kiri atas; kontrol zoom bawah tengah (`− 100% +` + layar penuh). Panel kanan 300 px: judul alat aktif + `Bareng`, chip kategori, grid stiker 4 kolom (56 px), stiker teks (serif), pemisah, **Riwayat** "siapa aja bisa balikin" (avatar, nama, aksi, waktu). |
| Layout mobile | **Kanvas fullscreen**. Overlay atas: Undo, Redo, stack avatar, **Selesai**. Dock alat mengambang yang bisa dilipat (Stiker, Teks, Coret, Filter, Layer, chevron). Bottom sheet **kontekstual** sesuai pilihan: contoh teks terpilih → "Teks · 'besties ♡'" + hapus + **Selesai**, pilihan gaya (`Serif`, `Tegas`, `Bulat`), swatch warna. Elemen yang disentuh orang lain: outline warna + avatar mini. |
| Interaksi | Lihat 11 §4. Gestur mobile: 1 jari drag, 2 jari pinch/rotate, ketuk dua kali pada teks = edit. |
| Loading | Dokumen dimuat dari snapshot; skeleton kanvas maksimal 2 detik. |
| Error | Sinkronisasi terputus → banner "Editanmu disimpan dulu di perangkat" (perubahan antre). |
| Aksesibilitas | Kanvas punya alternatif **panel Layer** yang bisa dinavigasi keyboard (pilih elemen, geser dengan panah, `Delete`). Toast konflik bisa difokus. |
| Requirement | REQ-EDIT-01..14, REQ-ROOM-10..11, REQ-MOB-04, -06, -07 |

## SCR-17 — Hasil akhir & export `DERIVED`

| Field | Spesifikasi |
|---|---|
| Layout desktop | Kiri: hasil besar di latar radial lembut, chip status peserta (`✓` atau "masih lihat"). Kanan 420 px: caption sesi + mode, judul "Jadi! *Cakep banget.*", segmen format **PNG/JPG**, pilihan ukuran (radio card: Asli, Cetak 300 dpi, Story), **Unduh** (primary XL), **Simpan ke Google Drive** (sekunder), tautan **Balik edit** / **Ke galeri room**, tombol **Sesi baru**. |
| Layout mobile | Hasil di atas, bottom sheet 330 px: judul, segmen format & ukuran, **Unduh**, baris **Drive** + **Balik edit**. |
| State | `rendering` (progress), `ready`, `drive_auth`, `drive_uploading`, `drive_done`, `drive_error` (Drive penuh / izin ditolak / jaringan). |
| Requirement | REQ-GAL-01..02, REQ-EXP-01..05 |

## SCR-18 — Galeri sementara `V1-APPROVED`

| Field | Spesifikasi |
|---|---|
| Layout desktop | Header (tag `Galeri`). Caption `BOBA27 · 4 sesi`, judul "Galeri *malam ini.*", **Unduh semua (.zip)** (DEC-045) + **Sesi baru** (primary). Banner retensi (latar butter): "**Galeri ini sementara.** Setelah semua keluar dan room kedaluwarsa, foto dan datanya dihapus. Unduh yang kamu suka sebelum itu." Chip filter: `Semua`, per sesi, `Per orang`. Grid kartu hasil (latar tint, aksi hover: unduh, Drive, layar penuh), nama sesi + mode + jam. Section **Per orang · sesi 1** (foto accepted individual). |
| Layout mobile | Judul 38 px, banner ringkas, chip scroll horizontal, masonry 2 kolom, kartu "Per orang · 16 foto", bar bawah **Unduh semua** + **Sesi baru**. |
| Larangan | Tidak ada take gagal di galeri dalam bentuk apa pun (REQ-GAL-07..08). |
| Empty | "Belum ada foto di sini. Hasil tiap sesi bakal ngumpul di galeri ini." + **Mulai vote mode**. |
| Requirement | REQ-GAL-01..08, REQ-LIFE-06 |

## SCR-19 — Ajakan sesi baru `DERIVED`

| Field | Spesifikasi |
|---|---|
| Layout | Desktop: modal tengah (480 px). Mobile: bottom sheet. Isi: avatar pengajak + "Ajakan dari Nadia · Lanjut sesi 2?", penjelasan "Vote mode lagi dari awal. Hasil sesi 1 tetap aman di galeri.", daftar status peserta (Ikut / Lagi unduh… / Belum jawab), **Bentar** + **Ikut, ayo vote**. |
| Requirement | REQ-VOTE-08, REQ-GAL-04..05, DEC-063 |

## SCR-20 — Putus / nyambung lagi `DERIVED`

| Field | Spesifikasi |
|---|---|
| Varian | (a) **Peserta lain putus**: kartu kamera grayscale-blur + ring progres kuning + "Nyambung lagi… · slot dijaga 0:24". Banner atas: "Bimo keputus. Cekrek ditahan dulu." + **Lanjut bertiga** (sesuai DEC-028). (b) **Koneksi sendiri lemah**: banner kuning "Sinyal lemah, nyambung lagi…". (c) **Kamera sendiri off**: kartu sendiri + **Nyalain lagi**. |
| Requirement | REQ-LIFE-02, REQ-CAM-11, NFR-06 |

## SCR-21 — Room bubar `DERIVED`

| Field | Spesifikasi |
|---|---|
| Layout | Ilustrasi strip kosong bertumpuk (tanpa foto) + caption kode room + judul "Room-nya *udah bubar.*" + penjelasan "Semua orang keluar lebih dari {N} menit, jadi room dan fotonya udah dihapus. File yang udah kamu unduh atau simpan ke Drive tetap aman." + **Bikin room baru** + **Ke beranda**. |
| Catatan | `{N}` mengikuti DEC-020. Kata "permanen" hanya boleh dipakai jika 15 §8 (verifikasi penghapusan) sudah terpenuhi. |
| Requirement | REQ-LIFE-04..06 |

## SCR-22 — Feedback sistem

| Komponen | Spesifikasi |
|---|---|
| Toast | Gelap (`--ink`), radius 14, posisi desktop kiri atas area kerja atau bawah tengah, mobile atas. Isi: avatar/ikon + teks + aksi opsional (`Balikin`, `Buka`). Durasi 5 detik; toast dengan aksi 8 detik; pause saat hover/fokus. Maksimal 3 bertumpuk. |
| Banner | Inline di atas konten: info (lavender), peringatan (butter), error (merah muda). |
| Konfirmasi | Desktop modal, mobile bottom sheet. Contoh: keluar room, mulai countdown saat ada yang belum siap. |
| Error state | Selalu: apa yang salah + apa yang bisa dilakukan + satu tombol utama. |
| Loading | Skeleton bergaya surface; spinner hanya di dalam tombol. |
| Pesan safeguard | Batas teknis (shot, cell, ukuran output, sesi, storage) disampaikan sebagai batas teknis sementara, bukan aturan produk: apa batasnya + alternatif. Contoh sesi: "Room ini udah 20 sesi. Bikin room baru buat lanjut." (DEC-053, PROPOSED). |
