# 18 — Decisions & Open Questions Register

| Atribut | Nilai |
|---|---|
| Dokumen | `18_DECISIONS_AND_OPEN_QUESTIONS.md` |
| Versi | 1.1.0 |
| Pemilik | Product owner LONGROLL (keputusan), Engineering lead (usulan teknis) |

Register ini mencatat semua keputusan produk dan teknis. Aturannya:

1. **Jangan mengubah status tanpa persetujuan.** Hanya pemilik produk yang boleh mengubah `PROPOSED`/`OPEN QUESTION` menjadi `CONFIRMED`.
2. **Agen coding boleh mengimplementasikan default `PROPOSED`**, tapi harus membuatnya mudah diganti (konfigurasi/konstanta terpusat), lalu mencatat di handoff fase bahwa keputusan itu masih PROPOSED.
3. **`OPEN QUESTION` yang memblokir** ditandai 🔴 di kolom "Blokir fase". Fase tersebut tidak boleh ditandai selesai sebelum pertanyaan dijawab, atau sebelum pemilik produk menyetujui default sementara secara eksplisit.
4. **Keputusan baru** ditambahkan dengan nomor berikutnya. Nomor tidak pernah dipakai ulang.

## Status

| Status | Arti |
|---|---|
| CONFIRMED | Dari brief produk atau disetujui eksplisit. |
| RECOMMENDED | Rekomendasi teknis yang menunggu persetujuan (PENDING APPROVAL). Diperlakukan seperti PROPOSED. |
| PROPOSED | Usulan default untuk mengisi celah produk. |
| OPEN QUESTION | Butuh jawaban pemilik produk. |
| DEFERRED | Sengaja ditunda ke luar rilis pertama. |
| REJECTED | Ditolak dan tidak boleh diimplementasikan. |

---

## 1. CONFIRMED

| ID | Topik | Keputusan | Sumber / Rasional | Dokumen terdampak | Fase |
|---|---|---|---|---|---|
| DEC-001 | Akun | Tidak ada registrasi atau login LONGROLL. Cukup display name sementara. | Brief §2.1 | 02, 07, 15 | P02 |
| DEC-002 | Host | Tidak ada host. Pembuat room tidak punya hak khusus. Semua peserta punya izin kolaboratif setara. | Brief §2.1 | 02, 07, 08, 11 | P02–P08 |
| DEC-003 | Kapasitas | Maksimal 4 peserta per room. | Brief §2.1 | 07, 13, 14 | P02 |
| DEC-004 | Voting | Voting mode dilakukan sebelum konfigurasi & capture. Mode terkunci per sesi. Kustomisasi internal tetap bebas. | Brief §2.3 | 08, 10 | P04, P05 |
| DEC-005 | Retake | Accept/Retake individual. Retake satu peserta tidak pernah mereset foto accepted peserta lain. | Brief §2.6 | 09, 14 | P06 |
| DEC-006 | Auto-accept | **Tidak ada** auto-accept berbasis timer. | Brief §2.6 | 09 | P06 |
| DEC-007 | Visibilitas retake | Foto gagal dan aktivitas retake live terlihat oleh peserta lain. | Brief §2.6 | 09, 04 | P06 |
| DEC-008 | Galeri | Retake gagal tidak otomatis masuk galeri. Tidak ada galeri khusus take gagal. | Brief §2.8 | 12 | P08 |
| DEC-009 | Drive | Export ke Google Drive pribadi lewat otorisasi Google terpisah, tanpa registrasi LONGROLL. | Brief §2.9 | 12, 15 | P08 |
| DEC-010 | Lifecycle | Room dihancurkan setelah kosong + grace period habis. Data room dihapus. File unduhan dan Drive di luar lifecycle. | Brief §2.2 | 07, 12, 15 | P02, P09 |
| DEC-011 | Visual | 17 gambar `LONGROLL_FINAL_VISUAL_REVIEW.zip` adalah Visual Baseline V1, sumber visual utama. Requirement produk mengalahkan teks/perilaku insidental di mockup. | Brief §1.2 | 04, 05, 06 | Semua |
| DEC-012 | Mobile | Mobile adalah platform kelas satu dengan fullscreen kamera, bottom sheet kontekstual, dan gestur. | Brief §2.10 | 06 | Semua |
| DEC-013 | Multi-sesi | Satu room bisa punya banyak sesi; tiap sesi baru dimulai dari voting. | Brief §2.3, §2.8 | 08, 12 | P04, P08 |
| DEC-014 | Tipografi | Bricolage Grotesque (brand/display), Figtree (UI), Instrument Serif (aksen editorial). Ketiganya berlisensi SIL Open Font License 1.1. | Brief §1.2; lisensi dari repositori google/fonts (`ofl/`) | 05 | P01 |

---

## 2. PROPOSED / RECOMMENDED

| ID | Topik | Status | Usulan | Rasional | Dokumen | Fase |
|---|---|---|---|---|---|---|
| DEC-020 | Durasi grace period | OPEN QUESTION (default PROPOSED) | Default **120 detik** setelah koneksi terakhir hilang. Dibuat konfigurasi `ROOM_GRACE_PERIOD_SECONDS`. | Brief menyebut durasi masih harus difinalisasi. 120 detik cukup untuk reload/ganti jaringan, tidak terlalu lama menahan data. | 07, 15 | P02 |
| DEC-021 | Hold slot peserta putus | PROPOSED | Saat room masih aktif, slot peserta yang putus ditahan **60 detik**. Lewat dari itu status menjadi `LEFT`, slot & warna dibebaskan. Foto accepted miliknya tetap di sesi. | Mencegah slot terkunci selamanya, tapi tetap toleran terhadap reload. | 07, 09 | P02 |
| DEC-022 | Format kode room | PROPOSED | 6 karakter dari alfabet 32 karakter tanpa karakter ambigu: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (≈1,07 miliar kombinasi). Dibuat dengan CSPRNG. Input dinormalkan ke huruf besar. | Mudah diucapkan dan diketik. Ruang kombinasi besar + rate limit (DEC-067) membuat enumerasi tidak praktis. | 07, 15 | P02 |
| DEC-023 | Penutupan voting | PROPOSED + OPEN | (a) Voting otomatis diselesaikan saat **semua peserta terhubung** sudah memilih. (b) Setelah **mayoritas** (> 50% peserta terhubung) memilih, siapa pun bisa menekan "Tutup vote"; semua klien melihat pemberitahuan 5 detik dan masih bisa memilih/mengubah suara di jendela itu. Tidak ada timer otomatis yang menutup voting. | Menghindari deadlock karena satu orang AFK tanpa menciptakan host. Pertanyaan terbuka: apakah pemilik produk ingin batas waktu opsional. | 08 | P04 |
| DEC-024 | Seri | PROPOSED | Ronde ulang **satu kali** hanya di antara opsi yang seri. Jika masih seri, server memilih acak (CSPRNG) dari opsi yang seri. Hasil acak diumumkan dengan jelas ("Booth lempar koin: Photo Strip") dan dicatat di event log sesi. | Adil, transparan, dan tidak butuh host. | 08 | P04 |
| DEC-025 | Minimal peserta untuk mulai | OPEN QUESTION (default PROPOSED) | Default **1** peserta boleh mulai voting dan sesi (solo diperbolehkan). | Mencegah produk tidak bisa dipakai saat teman telat. Pemilik produk perlu konfirmasi apakah solo boleh. | 08 | P04 |
| DEC-026 | Pemicu countdown | PROPOSED | Siapa pun bisa menekan shutter. Jika ada peserta terhubung yang belum "Siap", muncul konfirmasi "2 orang belum siap — tetap mulai?". Selama countdown berjalan, **siapa pun** bisa menekan "Tunggu!" untuk membatalkan countdown (sebelum T0). | Sesuai prinsip tanpa host; "Tunggu!" mencegah satu orang memaksa capture. | 09 | P06 |
| DEC-027 | Durasi countdown | PROPOSED | Pilihan 3 / 5 / 10 detik, default 5. Pengaturan ini bersama (shared). | Sesuai mockup (seg "3 dtk / 5 dtk / 10 dtk"). | 09, 10 | P06 |
| DEC-028 | Aturan lanjut ke shot berikutnya | PROPOSED + OPEN | Shot maju otomatis saat semua **peserta wajib** berstatus `ACCEPTED`. Peserta wajib = peserta yang terhubung **dan** punya kamera aktif saat T0 shot tersebut. Jika peserta wajib putus: shot menunggu selama hold slot (DEC-021). Setelah 15 detik terputus, siapa pun bisa menekan "Lanjut tanpa dia"; slot peserta itu untuk shot tersebut berstatus `SKIPPED`. Pertanyaan terbuka: bolehkah peserta yang kembali mengisi shot `SKIPPED` belakangan? | REQ-CAP-08 mewajibkan penyelesaian acceptance tanpa auto-accept. Aturan ini menghindari deadlock tanpa menerima foto atas nama orang lain. | 09 | P06 |
| DEC-029 | Retensi attempt gagal | PROPOSED | Jumlah retake tidak dibatasi. Attempt `REJECTED` disimpan sementara dan terlihat oleh peserta selama shot itu aktif. Saat shot maju (semua accepted/skipped), attempt `REJECTED` dihapus dari storage. Tidak pernah masuk galeri. | Memenuhi visibilitas retake (REQ-CAP-06) sekaligus meminimalkan data yang disimpan. | 09, 12, 15 | P06 |
| DEC-030 | Join terlambat | OPEN QUESTION (default PROPOSED) | Peserta yang join saat sesi `CAPTURING` masuk sebagai peserta room, tapi **baru ikut capture di sesi berikutnya**. Mereka bisa menonton feed live, ikut editor (`EDITING`), dan ikut voting sesi berikutnya. Join saat `VOTING` langsung ikut voting. | Menjaga binding slot sesi tetap konsisten. Perlu konfirmasi pemilik produk. | 07, 08, 09 | P02, P06 |
| DEC-031 | Sinkronisasi editor | RECOMMENDED | Dokumen editor berbasis CRDT (**Yjs**). Properti elemen disimpan di `Y.Map` (last-writer-wins per properti), teks di `Y.Text`, urutan layer di `Y.Array`. Server realtime me-relay update dan menyimpan snapshot. | Edit simultan tanpa lock, konvergensi terjamin, dan reconnect mudah via state vector. | 11, 13, 14 | P07 |
| DEC-032 | Undo & riwayat | PROPOSED | (a) **Undo/Redo pribadi**: hanya membatalkan operasi milik peserta itu sendiri (Yjs `UndoManager` dengan tracked origin lokal). (b) **Riwayat bersama**: daftar langkah semua peserta; siapa pun bisa menekan "Balikin" pada langkah mana pun (operasi pembalik baru, bukan menghapus histori). (c) Saat perubahan peserta lain menimpa elemen yang baru kamu ubah, muncul toast dengan tombol "Balikin". | Sesuai mockup ("siapa aja bisa balikin") dan prinsip setara, tanpa undo saling menimpa. | 11 | P07 |
| DEC-033 | Indikasi elemen sedang dipegang | PROPOSED | Saat peserta drag/resize/edit elemen, elemen itu diberi garis warna peserta + avatar (soft lock). Peserta lain **tetap boleh** mengedit (tidak dikunci). | Mengurangi tabrakan tanpa membatasi kesetaraan. | 11 | P07 |
| DEC-034 | Topologi WebRTC | RECOMMENDED | **Full mesh P2P** (maks. 3 peer connection per klien) dengan STUN + TURN. Preview dikirim di resolusi terbatas (DEC-072). SFU (misal LiveKit) disiapkan sebagai opsi jika uji P03/P10 gagal di HP. | Untuk 4 peserta, mesh paling murah dan sederhana. Risiko upload HP dicatat di 13 §4. | 09, 13 | P03 |
| DEC-035 | Sumber foto capture | RECOMMENDED | Setiap klien mengambil foto **dari kamera lokalnya sendiri** di resolusi penuh, lalu mengunggahnya ke storage sementara. Foto tidak diambil dari stream remote yang sudah terkompresi. | Kualitas export (REQ-EXP-03, NFR-12). | 09, 12, 13 | P06 |
| DEC-036 | Storage sementara | RECOMMENDED | Object storage S3-compatible dengan prefix per room (`rooms/{roomId}/…`). Penghapusan aktif saat room hancur + aturan lifecycle bucket sebagai backstop (hapus objek > 24 jam). | Biaya rendah, bisa diverifikasi, dan backstop kalau job cleanup gagal. | 13, 15 | P02, P06, P09 |
| DEC-037 | State room | RECOMMENDED | Layanan realtime **otoritatif** (Node.js + TypeScript, WebSocket) memegang state room di memori dan menulis snapshot ke **Redis** (dengan TTL) untuk pemulihan. Room di-route ke satu instance (sticky by roomId). | Room kecil (4 orang) dan berumur pendek cocok dengan model actor per room. | 13, 14 | P02 |
| DEC-038 | Frontend | RECOMMENDED | **Next.js (App Router) + TypeScript + React**. Token desain lewat CSS custom properties. Tailwind boleh dipakai jika disetujui di P01 (DEC-078). | Ekosistem matang, routing jelas, deploy mudah. | 13 | P01 |
| DEC-039 | Mesin kanvas | RECOMMENDED | **Konva** (`react-konva`) untuk scene graph studio & editor, termasuk export render. Alternatif: Fabric.js atau Canvas2D custom. | Scene graph, transformer handle, event sentuh, dan `toCanvas` dengan pixelRatio sudah tersedia. | 10, 11, 13 | P05, P07 |
| DEC-040 | Integrasi Drive | RECOMMENDED | Google Identity Services (token model) di browser, scope **`drive.file`** saja, upload langsung dari browser ke Drive API. Server LONGROLL tidak menyimpan token Google. | Scope minimal dan tanpa penyimpanan kredensial di server. | 12, 15 | P08 |
| DEC-041 | Batas upload frame | PROPOSED (technical safeguard) | Format: PNG atau WebP (statis, boleh alpha). Ukuran ≤ 10 MB. Sisi terpanjang 600–6000 px. Ditolak: SVG, GIF/animasi, HEIC. Server memvalidasi dan **re-encode** file. Maks. 20 frame custom per room. **Technical safeguard**: konfigurasi terpusat, bukan batas produk; menurunkan nilainya butuh persetujuan pemilik produk. | Keamanan (tanpa SVG/skrip), memori, dan kualitas. | 10, 15 | P05 |
| DEC-042 | Batas layout & output | PROPOSED (technical safeguard) | Shot per sesi: 1–8 (`MAX_SHOTS`). Photo cell per sesi ≤ `MAX_SHOTS × 4` = 32. Slot per plan: ≤ 8 untuk strategi grup per shot, ≤ 32 untuk strategi individual/freeform. Grid: baris × kolom ≤ 32, masing-masing ≤ 8. Sisi terpanjang output 600–8192 px (render per tile). Preset: Strip 2×6" (600×1800 & 1200×3600), Postcard 4×6" (1200×1800), Square 1:1 (1600×1600), Story 9:16 (1080×1920). **v1.1:** mengganti batas lama "12 slot / grid 4×3" yang bertentangan dengan 4 peserta × 4–8 shot. Semua batas saling diturunkan dari `MAX_SHOTS` dan batas 4 peserta. **Technical safeguard**: konfigurasi terpusat, bukan batas produk; menurunkan nilainya butuh persetujuan pemilik produk. | Menjaga memori render & upload wajar tanpa mengurangi fleksibilitas yang sudah dijanjikan. | 02, 10, 12, 14, 17 | P05, P06, P08 |
| DEC-043 | Display name | PROPOSED | 1–20 karakter setelah trim; huruf, angka, spasi, emoji. Unik di dalam room (duplikat diberi sufiks " 2"). Disanitasi saat render (escape HTML). | Mencegah nama panjang merusak layout dan injeksi. | 07, 15 | P02 |
| DEC-044 | Alokasi warna pemain | PROPOSED | Warna P1→P4 diberikan berdasarkan indeks kosong terkecil saat join. Warna dipertahankan saat reconnect dalam hold slot. | Deterministik dan konsisten. | 05, 07 | P02 |
| DEC-045 | Unduh semua (.zip) | PROPOSED (P2) | Galeri menyediakan "Unduh semua (.zip)" berisi hasil semua sesi. | Tampil di mockup galeri desktop. | 12 | P08 |
| DEC-046 | Timer voting di mockup | OPEN QUESTION | Angka "0:18 / Sisa waktu" di mockup voting **tidak dianggap requirement**. Implementasi awal tidak memakai timer penutup otomatis (lihat DEC-023). Pemilik produk perlu memutuskan apakah timer opsional diinginkan. | Brief melarang menganggap voting berbasis countdown sebagai keputusan final. | 04, 08 | P04 |
| DEC-047 | Tampilan "Per orang" di galeri | PROPOSED (P1) | Galeri boleh menampilkan foto individual yang **accepted** per sesi. Tidak pernah menampilkan attempt `REJECTED`. | Brief mengizinkan foto accepted ditampilkan (REQ-GAL-06); mockup menampilkan section "Per orang". | 12 | P08 |
| DEC-048 | Reaksi foto | PROPOSED (P2, opsional) | Reaksi cepat ("lucu", "cakep", "wkwk") pada foto di layar Accept/Retake. Hanya ephemeral, tidak disimpan ke galeri. | Muncul di mockup, tidak ada di brief. Boleh ditunda tanpa merusak konsep. | 09 | P06 |
| DEC-049 | Pemisahan kontrol lokal vs bersama | PROPOSED | **Lokal saja (pemilik perangkat):** izin, pilih device, depan/belakang, on/off, cermin, serta framing pra-capture feed sendiri (zoom/posisi/kecerahan di panel "Kameraku"). **Bersama (siapa pun):** frame, layout, kanvas, filter grup, durasi countdown, serta transform foto setelah capture di editor (crop/zoom/posisi/filter per foto). | Memenuhi REQ-CAM-12 dan REQ-CAM-13 dengan garis yang jelas. | 09, 10, 11 | P03, P05, P07 |
| DEC-050 | Browser yang didukung | PROPOSED | Chrome/Edge & Android Chrome 2 versi stabil terakhir, Firefox 2 versi terakhir, Safari macOS 17+, iOS Safari 17+. | Dukungan `getUserMedia`, `replaceTrack`, `OffscreenCanvas`/`createImageBitmap` memadai. | 06, 17 | P01, P10 |
| DEC-051 | Region hosting | PROPOSED | Satu region dekat pengguna utama (Asia Tenggara, misal Singapura) di rilis awal. | Copy berbahasa Indonesia. Latensi realtime dan TURN lebih baik. | 13 | P10 |
| DEC-052 | Batas umur room | OPEN QUESTION | **Default v1.1: tidak ada batas umur.** Room tetap hidup selama ≥ 1 peserta terhubung (REQ-LIFE-01), lalu mengikuti grace period. Opsi yang bisa dipilih pemilik produk: batas umur maksimal (misal 12 jam) dengan peringatan sebelum berakhir. Tidak boleh diaktifkan tanpa persetujuan eksplisit. Implementasi hanya menyiapkan konfigurasi `ROOM_MAX_LIFETIME_HOURS` dengan nilai default **nonaktif**. | Batas umur bertentangan dengan "room tersedia selama ada peserta" kecuali disetujui. Penyalahgunaan storage dibatasi oleh safeguard lain (DEC-053, DEC-085, lifecycle storage). | 07, 13, 14, 15 | P02, P09 |
| DEC-053 | Batas sesi per room | PROPOSED (technical safeguard) | Maksimal 20 sesi per room. **Technical safeguard**: konfigurasi terpusat, bukan batas produk; menurunkan nilainya butuh persetujuan pemilik produk. | Membatasi storage. | 08, 12 | P08 |
| DEC-054 | Frame custom room-scoped | PROPOSED | Frame upload hanya berlaku di room itu dan ikut dihapus bersama room. | Konsekuensi REQ-LIFE-05 (data milik room). | 10, 15 | P05 |
| DEC-055 | Lisensi aset stiker | OPEN QUESTION | Mockup memakai emoji sebagai stiker. Rekomendasi: **bundel aset stiker sendiri** (SVG/PNG) dengan lisensi jelas, misalnya set open-license dengan atribusi, atau set buatan sendiri. Jangan bergantung pada emoji font sistem untuk hasil export karena tampilannya beda antar platform. | Konsistensi export + kepastian lisensi. | 05, 11 | P07 |
| DEC-056 | Analitik | OPEN QUESTION | Jika dipakai, hanya event agregat tanpa media, tanpa display name, dan tanpa ID yang bisa dipakai lintas room. | Konsisten dengan prinsip privasi. | 15 | P09 |
| DEC-057 | Konfirmasi keluar | PROPOSED | Jika keluarnya peserta membuat room kosong, tampilkan peringatan + tombol "Unduh semua dulu". | Mencegah kehilangan hasil tanpa sengaja. | 04, 12 | P08 |
| DEC-058 | Orientasi mobile | PROPOSED | Portrait adalah orientasi utama. Booth dan editor tetap berfungsi di landscape dengan toolbar di sisi kanan. | Kamera HP sering dipakai landscape untuk group. | 06 | P05 |
| DEC-059 | Menyelesaikan editing | PROPOSED | Siapa pun bisa menekan "Selesai edit" → semua peserta pindah ke Hasil Akhir (SCR-17) dengan banner "Diselesaikan oleh Raka". Siapa pun bisa "Balik edit" sampai sesi baru dimulai. | Tanpa host, tetap bisa dibatalkan. | 08, 11, 12 | P07, P08 |
| DEC-060 | Aset hasil sesi | PROPOSED | Saat sesi difinalisasi, klien yang memfinalisasi merender **preview** (sisi terpanjang ≤ 1600 px) dan mengunggahnya. Server menyimpan snapshot dokumen editor. Render resolusi penuh untuk unduhan dibuat di klien saat diminta, dari snapshot + foto asli. | Hemat compute server; kualitas penuh tetap bisa dihasilkan. | 12, 13 | P08 |
| DEC-061 | Strategi binding foto ke slot per mode | 🔴 OPEN QUESTION | Belum diputuskan apakah tiap mode memakai **grup per shot** (satu slot berisi semua peserta pada satu shot) atau **foto individual per shot** (satu slot per peserta per shot), atau keduanya sebagai pilihan pengguna. Model data DEC-087 mendukung keduanya. Dokumen ini **tidak** memilih default final. | Menentukan UX default output, bukan struktur data. | 10, 11, 12, 14 | P05 (keduanya wajib didukung), keputusan wajib sebelum P10 |
| DEC-062 | Komposisi Group Shot | PROPOSED | Empat foto disusun berdampingan dengan masker tepi lembut, seperti mockup. Segmentasi/hapus latar ditunda (DEC-095). | Bisa dikerjakan tanpa ML di klien. | 10 | P05 |
| DEC-063 | Memulai sesi baru | PROPOSED | Siapa pun bisa menekan "Sesi baru". Sesi baru langsung dibuat dalam state `VOTING`. Peserta lain melihat ajakan (SCR-19) dengan "Ikut" atau "Bentar". "Bentar" hanya menunda tampilan; peserta tetap bisa masuk dan memilih kapan saja. Aturan penutupan vote tetap DEC-023. | Tidak ada yang dipaksa pindah layar saat sedang mengunduh. | 08 | P04, P08 |
| DEC-064 | Cermin pada foto hasil | OPEN QUESTION (default PROPOSED) | Default: foto disimpan **sesuai yang terlihat di preview** (WYSIWYG). Jika cermin aktif saat T0, foto ikut dicerminkan. | Ekspektasi umum pengguna photobooth/selfie. Perlu konfirmasi. | 09 | P03, P06 |
| DEC-065 | Kunci struktur setelah shot pertama | PROPOSED | Setelah shot pertama diambil, jumlah shot dan binding slot tidak bisa diubah. Frame, warna, jarak, rasio tampilan, dan transform tetap bisa diubah. | Mencegah foto yang sudah diambil kehilangan tempat. | 10 | P05, P06 |
| DEC-066 | Ukuran library frame | PROPOSED | MVP: ≥ 6 frame (1 per kategori). Rilis publik: ≥ 24 frame. Ini target minimum, bukan batas atas. | "Extensive library" butuh angka yang bisa diuji. | 10 | P05 |
| DEC-067 | Rate limit | PROPOSED | Buat room: 10/jam/IP. Percobaan join: 30/10 menit/IP. Kode tidak valid: 20/10 menit/IP lalu backoff eksponensial. Upload frame: 20/jam/participant. Event WebSocket: 60/detik/koneksi (kursor sudah di-throttle). | Mencegah enumerasi kode dan spam. | 15 | P02, P09 |
| DEC-068 | Masuk tanpa kamera | PROPOSED | Peserta boleh masuk room tanpa kamera (ditolak/tidak ada). Mereka tetap ikut voting dan editor; slot fotonya berstatus "tanpa kamera" dan tidak dihitung sebagai peserta wajib capture. | Inklusif dan mencegah deadlock. | 09 | P03, P06 |
| DEC-069 | Status "Siap" | PROPOSED | Status "Siap" otomatis aktif saat kamera live dan tab terlihat. Peserta bisa menekan "Bentar" untuk menandai belum siap. | Mengurangi klik tanpa menyembunyikan status. | 09 | P06 |
| DEC-071 | Cakupan kursor | PROPOSED | Kursor multiplayer tampil di Voting, Studio, dan Editor. Tidak tampil di Lobby & Galeri. | Mengurangi trafik dan noise. | 07 | P02 |
| DEC-072 | Resolusi preview & foto | PROPOSED | Preview WebRTC: target 640×480 @ 24–30 fps, bitrate adaptif. Foto capture: resolusi asli kamera hingga sisi terpanjang 4096 px, JPEG kualitas 0.92. | Menyeimbangkan upload HP (mesh) dan kualitas cetak. | 09, 13 | P03, P06 |
| DEC-073 | Penyedia TURN | OPEN QUESTION | Pilihan: TURN terkelola (berbayar per GB) atau coturn self-hosted. Rekomendasi awal: TURN terkelola untuk reliabilitas, evaluasi biaya setelah P10. | Biaya TURN adalah komponen biaya terbesar yang tidak bisa diprediksi tanpa data. | 13 | P03 |
| DEC-074 | Sinkronisasi waktu countdown | RECOMMENDED | Offset jam klien dihitung via ping-pong WebSocket (gaya NTP, ambil median dari ≥ 5 sampel, refresh tiap 30 detik). Server mengirim `t0ServerMs`; klien menjadwalkan capture pada `t0ServerMs - offset`. | Dibutuhkan untuk NFR-02. | 09, 13 | P06 |
| DEC-075 | Enkripsi at-rest | PROPOSED | Gunakan enkripsi at-rest bawaan provider storage & Redis (harus diverifikasi saat memilih provider). Jangan menyatakan "end-to-end encrypted". | Klaim privasi harus sesuai arsitektur. | 15 | P09 |
| DEC-076 | Audio / voice chat | OPEN QUESTION | Brief tidak menyebut audio. **Tidak masuk scope sampai pemilik produk memutuskan.** LONGROLL tidak meminta izin mikrofon dan `Permissions-Policy` menonaktifkan mikrofon. Arsitektur media menyediakan titik ekstensi (antarmuka `MediaTransport` mendukung track tambahan) agar keputusan "ya" tidak memaksa penulisan ulang. **v1.1:** tidak lagi memblokir dimulainya P03 (P03 dibangun video-only); wajib dijawab sebelum P10. | Mempengaruhi izin, bandwidth, dan privasi. Video-only adalah satu-satunya perilaku yang sesuai brief saat ini. | 09, 13, 15 | P03 (titik ekstensi), P10 (keputusan) |
| DEC-077 | Cek kamera sebelum lobby | PROPOSED | Setelah isi nama, peserta melihat SCR-04 (cek kamera) sebelum lobby. Bisa dilewati ("Masuk tanpa kamera"). | Mengurangi masalah izin di tengah sesi. | 03, 04 | P03 |
| DEC-078 | Tailwind CSS | PROPOSED | Boleh dipakai jika agen P01 menilai lebih cepat. Token tetap bersumber dari CSS custom properties di 05. | Fleksibel, token tetap satu sumber. | 05, 13 | P01 |
| DEC-079 | Mengubah keputusan accept | PROPOSED | Pemilik foto boleh menekan "Ganti pilihanku" setelah accept **selama shot belum `DONE`**. Foto yang sudah accepted tetap tersimpan sampai pemilik memutuskan lagi. Peserta lain tidak bisa memicu ini. | Mencegah salah tap tanpa melanggar REQ-CAP-07 (stabil terhadap aksi pihak lain). | 09, 14 | P06 |
| DEC-080 | "Colek" | PROPOSED (P2) | Peserta bisa mengirim notifikasi lembut ke peserta yang belum memutuskan/belum siap. Maks. 1× per 20 detik per pengirim. Tidak mengubah state apa pun. | Alternatif sosial pengganti auto-accept. | 09 | P06 |
| DEC-081 | Masuk studio setelah hasil vote | PROPOSED | Semua peserta otomatis masuk studio 3 detik setelah hasil vote diumumkan; tombol **Masuk booth** mempercepat. | Transisi, bukan keputusan pengguna. Tidak terkait auto-accept foto. | 04, 08 | P04 |
| DEC-082 | Penyimpanan token peserta | RECOMMENDED (v1.1) | **MVP: cookie `HttpOnly; Secure; SameSite=Strict`** per room (`lr_p_{roomId}`), di-set oleh API pada domain yang sama dengan realtime service (misal `rt.longroll.app` di bawah `longroll.app`), dikirim otomatis saat upgrade WebSocket dan request API. Server memvalidasi `Origin`. JavaScript tidak bisa membaca token → XSS tidak bisa mencurinya. Max-Age = umur room + grace; dihapus saat keluar/kedaluwarsa. **Fallback** jika arsitektur domain tidak memungkinkan cookie first-party: `sessionStorage` (bukan `localStorage`) + token dikirim di pesan `auth` pertama. | Token anonim adalah satu-satunya kunci akses room; cookie HttpOnly mengurangi dampak XSS dan tetap mengizinkan resume setelah tab ditutup selama grace period. | 07, 14, 15 | P02 |
| DEC-083 | Multi-tab | PROPOSED | Token yang sama di tab baru mengambil alih koneksi; tab lama menerima `session.replaced`. | Mencegah dua koneksi untuk satu slot. | 07, 14 | P02 |
| DEC-084 | Tombstone kode | PROPOSED | Setelah room `EXPIRED`, simpan `{code: EXPIRED}` selama 24 jam (tanpa data pribadi) agar link lama menampilkan SCR-21, dan kode tidak dipakai ulang di periode itu. | UX jelas + mencegah salah masuk room baru. | 07, 15 | P02 |
| DEC-085 | Batas storage per room | PROPOSED (technical safeguard) | Batas lunak 1 GB per room. Saat terlampaui, upload baru ditolak `ROOM_STORAGE_LIMIT` dengan pesan untuk mulai room baru. **Technical safeguard**: konfigurasi terpusat, bukan batas produk; menurunkan nilainya butuh persetujuan pemilik produk. | Mencegah penyalahgunaan sebagai penyimpanan. | 14, 15 | P06, P09 |
| DEC-086 | Membatalkan sesi yang sedang berjalan | OPEN QUESTION | Brief tidak menyebut pembatalan sesi di tengah jalan (misal grup ingin ganti mode saat `CAPTURING`). Default sementara: **tidak ada aksi batal**; sesi harus diselesaikan sampai `FINAL` sebelum sesi baru. Alternatif: aksi "Batalkan sesi" oleh siapa pun dengan konfirmasi semua peserta. | Menghindari kehilangan foto tanpa sengaja tanpa memperkenalkan host. | 08 | P04, P08 |
| DEC-087 | Model data binding generik | RECOMMENDED (v1.1) | `BindingPlan` berisi slot dengan binding `CELL` (satu peserta × satu shot), `SHOT_GROUP` (semua peserta pada satu shot), atau `FREE` (collage). Strategi aktif per sesi disimpan di `studio.bindingStrategy`. Generator layout wajib mendukung strategi `PER_SHOT_GROUP` dan `PER_PARTICIPANT_SHOT` untuk Strip/Group/Grid, serta `FREEFORM` untuk Collage. | Membuka pengembangan P05–P08 tanpa memutuskan DEC-061. | 10, 11, 12, 14 | P05–P08 |
| DEC-088 | Topologi deployment MVP | RECOMMENDED (v1.1) | MVP memakai **satu instance** realtime service (room actor di memori + snapshot Redis), Redis terkelola, object storage, TURN terkelola, dan frontend di platform Next.js. Multi-instance (routing room, lease takeover), SFU, dan render server **tidak** dibangun di MVP; dipicu oleh ambang di 13 §15. | Mengurangi kompleksitas dan biaya awal; desain tetap memungkinkan scale-out tanpa mengubah kontrak klien. | 13, 16 | P02, P09 |

---

## 3. DEFERRED

| ID | Topik | Keterangan | Fase target |
|---|---|---|---|
| DEC-095 | Hapus latar / segmentasi untuk Group Shot | Butuh model ML di klien; berat di HP. | Pasca-rilis |
| DEC-096 | Capture video/GIF/boomerang | Tidak ada di brief. | Pasca-rilis |
| DEC-097 | Lebih dari 4 peserta / penonton | Bertentangan dengan batas 4 untuk peserta; mode penonton tidak ada di brief. | Pasca-rilis |
| DEC-098 | Multi-region | Satu region dulu (DEC-051). | Pasca-rilis |

## 4. REJECTED

| ID | Topik | Alasan penolakan |
|---|---|---|
| DEC-090 | Peran host/owner room | Bertentangan dengan REQ-ROOM-07. |
| DEC-091 | Auto-accept setelah 10–12 detik diam (muncul di artefak desain lama) | Bertentangan dengan REQ-CAP-09. |
| DEC-092 | Galeri/filter "Take gagal" (muncul di iterasi desain sebelumnya) | Bertentangan dengan REQ-GAL-08. |
| DEC-093 | Copy "Gak ada yang disimpan di server" | Tidak benar: foto disimpan sementara di storage room. |
| DEC-094 | Akun/login sosial untuk LONGROLL | Bertentangan dengan REQ-ROOM-01. Login Google **hanya** untuk Drive. |
| DEC-099 | Room permanen / riwayat lintas room | Bertentangan dengan lifecycle sementara. |

---

## 5. Daftar pertanyaan terbuka (ringkas)

| ID | Pertanyaan | Blokir |
|---|---|---|
| DEC-020 | Berapa durasi grace period final? | P02 boleh pakai default; harus final sebelum P10. |
| DEC-023 / DEC-046 | Perlukah timer opsional untuk voting? | Tidak blokir (default tanpa timer). |
| DEC-025 | Bolehkah sesi solo? | Tidak blokir. |
| DEC-028 | Bolehkah shot `SKIPPED` diisi belakangan? | Tidak blokir P06 (default: tidak). |
| DEC-030 | Perilaku join terlambat saat capture. | Tidak blokir (default di atas). |
| DEC-052 | Perlukah batas umur room? (default: tidak ada) | Tidak blokir. Tidak boleh diaktifkan tanpa persetujuan. |
| DEC-055 | Sumber & lisensi aset stiker. | 🔴 Blokir rilis publik P10, bukan P07 (P07 boleh pakai set sementara berlisensi jelas). |
| DEC-056 | Pakai analitik atau tidak? | Tidak blokir. |
| **DEC-061** | **Strategi binding default per mode (grup per shot / individual per shot / pilihan pengguna).** | 🔴 Tidak memblokir P05 (keduanya wajib didukung, DEC-087), **wajib dijawab sebelum P10**. |
| DEC-064 | Foto dicerminkan atau tidak? | Tidak blokir (default WYSIWYG). |
| DEC-086 | Perlukah aksi membatalkan sesi yang sedang berjalan? | Tidak blokir (default: tidak ada). |
| DEC-073 | TURN terkelola atau self-hosted? | Harus dipilih di awal P03. |
| **DEC-076** | **Voice chat masuk scope?** | 🔴 Tidak memblokir P03 (video-only + titik ekstensi), **wajib dijawab sebelum P10**. |

## 6. Cara menambah keputusan

```text
| DEC-1xx | Topik | STATUS | Isi keputusan/usulan | Rasional | Dokumen terdampak | Fase |
```

Saat sebuah PROPOSED menjadi CONFIRMED: ubah status, tambahkan tanggal & siapa yang menyetujui di kolom rasional, lalu perbarui dokumen terdampak pada PR yang sama.
