# 02 — Product Requirements Document (PRD)

| Atribut | Nilai |
|---|---|
| Dokumen | `02_PRODUCT_REQUIREMENTS.md` |
| Versi | 1.1.0 |
| Status | Draft untuk review (belum ada implementasi) |
| Sumber kebenaran | Brief produk yang dikonfirmasi pemilik produk + Visual Baseline V1 |
| Registry keputusan | [18_DECISIONS_AND_OPEN_QUESTIONS.md](18_DECISIONS_AND_OPEN_QUESTIONS.md) |

Dokumen ini adalah **registry requirement** LONGROLL. Setiap requirement punya ID stabil yang dipakai di seluruh dokumen, test case, dan fase. ID **tidak boleh diganti nomornya**; requirement yang dibatalkan ditandai `REJECTED` di dokumen 18, bukan dihapus.

---

## 1. Label status

| Label | Arti |
|---|---|
| **CONFIRMED** | Berasal langsung dari brief produk. Tidak boleh diubah tanpa persetujuan pemilik produk. |
| **PROPOSED** | Usulan tim dokumentasi untuk mengisi celah. Boleh diimplementasikan sebagai default, tapi wajib tercatat di dokumen 18 dan bisa diganti. |
| **OPEN QUESTION** | Butuh keputusan pemilik produk sebelum fase terkait selesai. |
| **DEFERRED** | Sengaja ditunda ke luar rilis pertama. |

## 2. Prioritas

| Prioritas | Arti |
|---|---|
| **P0** | Wajib untuk rilis pertama (MVP). Produk tidak layak rilis tanpanya. |
| **P1** | Wajib untuk rilis publik, boleh menyusul setelah MVP internal. |
| **P2** | Diinginkan, bisa ditunda tanpa merusak konsep produk. |

## 3. Konvensi ID

| Prefix | Area | Dokumen pemilik | Fase utama |
|---|---|---|---|
| `REQ-ROOM` | Akun, room, identitas, presence | 07 | P02 |
| `REQ-LIFE` | Lifecycle room | 07, 15 | P02, P09 |
| `REQ-VOTE` | Voting mode & sesi | 08 | P04 |
| `REQ-CAM` | Kamera live | 09 | P03 |
| `REQ-FRAME` | Frame, kanvas, layout | 10 | P05 |
| `REQ-CAP` | Capture & retake individual | 09 | P06 |
| `REQ-EDIT` | Editor kolaboratif | 11 | P07 |
| `REQ-GAL` | Multi-sesi & galeri | 12 | P08 |
| `REQ-EXP` | Export & Google Drive | 12 | P08 |
| `REQ-MOB` | Pengalaman mobile | 06 | Semua fase UI |
| `REQ-UI` | Identitas visual | 05 | P01 + semua fase UI |
| `NFR` | Non-functional | 13, 15, 17 | Lintas fase |

ID layar (`SCR-xx`) ada di [04_SCREEN_SPECIFICATIONS.md](04_SCREEN_SPECIFICATIONS.md). ID test (`TC-xxx`) ada di [17_QA_TEST_PLAN.md](17_QA_TEST_PLAN.md). ID keputusan (`DEC-xxx`) ada di dokumen 18.

---

## 4. Functional requirements

### 4.1 Akun, room, dan identitas — `REQ-ROOM`

| ID | Requirement | Status | Prio | Acceptance criteria (terukur) | Owner doc / Fase |
|---|---|---|---|---|---|
| REQ-ROOM-01 | Tidak ada registrasi wajib dan tidak ada sistem login LONGROLL. | CONFIRMED | P0 | Pengguna baru bisa membuat room dan masuk booth tanpa mengisi email, password, atau OAuth apa pun. Tidak ada endpoint/halaman "daftar"/"masuk". | 07 / P02 |
| REQ-ROOM-02 | Pengguna mengisi display name sementara. | CONFIRMED | P0 | Nama wajib diisi sebelum masuk room. Panjang 1–20 karakter setelah trim (batas: PROPOSED DEC-043). Nama tampil di kamera, daftar peserta, kursor. | 07 / P02 |
| REQ-ROOM-03 | Pengguna bisa membuat room. | CONFIRMED | P0 | Dari landing, ≤ 2 langkah (isi nama → "Bikin room") menghasilkan room baru dan pembuat langsung masuk lobby. | 07 / P02 |
| REQ-ROOM-04 | Setiap room punya kode unik yang bisa dibagikan. | CONFIRMED | P0 | Kode unik di antara room aktif. Format: PROPOSED DEC-022. Kode bisa disalin dengan satu tap dan ditampilkan di lobby & header room. | 07 / P02 |
| REQ-ROOM-05 | Join lewat kode atau link undangan. | CONFIRMED | P0 | Membuka `/r/{KODE}` langsung ke alur join (isi nama) tanpa mengetik kode. Input kode manual menerima huruf kecil dan menormalkannya. | 07 / P02 |
| REQ-ROOM-06 | Maksimal 4 peserta per room. | CONFIRMED | P0 | Join ke-5 ditolak server dengan state "Room penuh" (SCR-03). Penolakan terjadi di server, bukan hanya di UI. Test: TC-ROOM-004. | 07 / P02 |
| REQ-ROOM-07 | Pembuat room tidak punya hak administratif khusus. Tidak ada host. | CONFIRMED | P0 | Tidak ada field `isHost`/`owner` yang mempengaruhi otorisasi. Semua aksi yang bisa dilakukan pembuat bisa dilakukan peserta lain. Test: TC-ROOM-010. | 07 / P02 |
| REQ-ROOM-08 | Setiap peserta punya izin kolaboratif setara. | CONFIRMED | P0 | Server memvalidasi aksi berdasarkan keanggotaan room, bukan peran. Pengecualian satu-satunya: aksi atas **perangkat/foto milik sendiri** (REQ-CAM-13, REQ-CAP-10). | 07 / P02 |
| REQ-ROOM-09 | Peserta punya warna pemain yang berbeda secara visual. | CONFIRMED | P0 | 4 warna (Peach, Butter, Mint, Lilac; lihat 05). Tidak ada dua peserta aktif dengan warna sama. | 05, 07 / P02 |
| REQ-ROOM-10 | Desktop: kursor multiplayer real-time berwarna dengan label nama. | CONFIRMED | P0 | Pada pointer `fine`, kursor peserta lain tampil di area kolaboratif (voting, studio, editor) dengan warna & nama. Target latensi: NFR-01. | 07, 11 / P02, P07 |
| REQ-ROOM-11 | Kolaborasi mobile ramah sentuh. | CONFIRMED | P0 | Pada pointer `coarse`, tidak ada kursor; elemen yang sedang dipegang peserta lain diberi garis warna + avatar mini (05 §11). Semua aksi kolaboratif bisa dilakukan dengan sentuhan. | 06, 11 / P02, P07 |
| REQ-ROOM-12 | Presence peserta tersinkron real-time. | CONFIRMED | P0 | Masuk/keluar/putus/kamera-mati tampil di semua klien ≤ 2 detik (p95) dalam kondisi jaringan normal. | 07 / P02 |
| REQ-ROOM-13 | Identitas teknis sementara / token room boleh dipakai internal, tapi tidak menjadi sistem akun. | CONFIRMED | P0 | Token hanya berlaku untuk satu room, tidak bisa dipakai lintas room, tidak menyimpan email/PII, dan hilang bersama room. | 07, 15 / P02 |

### 4.2 Lifecycle room — `REQ-LIFE`

| ID | Requirement | Status | Prio | Acceptance criteria | Owner / Fase |
|---|---|---|---|---|---|
| REQ-LIFE-01 | Room tetap tersedia selama ≥ 1 peserta terhubung. | CONFIRMED | P0 | Room tidak masuk grace period selama ada minimal satu koneksi aktif yang lolos heartbeat. **Tidak ada batas umur maksimal room** kecuali pemilik produk menyetujui kebijakan lain (DEC-052, OPEN). Test: TC-ROOM-026. | 07 / P02 |
| REQ-LIFE-02 | Diskoneksi sementara ditangani dengan baik. | CONFIRMED | P0 | Peserta yang reload/berpindah jaringan dan kembali dalam batas hold slot (PROPOSED DEC-021) mendapatkan kembali slot, warna, nama, dan foto yang sudah accepted. Test: TC-ROOM-020. | 07 / P02, P09 |
| REQ-LIFE-03 | Saat semua peserta keluar/putus, grace period reconnect dimulai. | CONFIRMED | P0 | Timer grace period dimulai saat koneksi terakhir hilang. Durasi: OPEN QUESTION, default PROPOSED 120 detik (DEC-020). | 07, 15 / P02 |
| REQ-LIFE-04 | Jika tidak ada yang reconnect sebelum kedaluwarsa, room dihancurkan. | CONFIRMED | P0 | Setelah grace period habis: kode room tidak valid lagi, token ditolak, link membuka SCR-21. | 07, 15 / P02, P09 |
| REQ-LIFE-05 | Foto sementara dan data sesi milik room dihapus. | CONFIRMED | P0 | Semua objek storage di prefix room dan semua state room dihapus. Penghapusan diverifikasi oleh job (15 §8). Backstop lifecycle storage: DEC-036. Test: TC-SEC-030. | 15 / P02, P09 |
| REQ-LIFE-06 | File yang sudah diunduh dan file yang disimpan ke Google Drive pribadi berada di luar lifecycle room. | CONFIRMED | P0 | Copy UI tidak pernah menyatakan file unduhan/Drive ikut terhapus. Sistem tidak mencoba menghapus file di Drive. | 12, 15 / P08 |
| REQ-LIFE-07 | Satu room bisa punya banyak sesi photobooth. | CONFIRMED | P0 | Setelah sesi selesai, peserta bisa memulai sesi baru di room yang sama tanpa membuat room baru. | 08, 12 / P04, P08 |

### 4.3 Voting mode — `REQ-VOTE`

| ID | Requirement | Status | Prio | Acceptance criteria | Owner / Fase |
|---|---|---|---|---|---|
| REQ-VOTE-01 | Peserta wajib voting mode sebelum mengonfigurasi dan mengambil foto. | CONFIRMED | P0 | Studio (SCR-08) tidak bisa dibuka untuk sesi yang belum punya mode terkunci. | 08 / P04 |
| REQ-VOTE-02 | Empat mode: Photo Strip, Group Shot, Photo Grid, Freeform Collage. | CONFIRMED | P0 | Keempat mode tampil sebagai opsi voting. Definisi konseptual mode: 10 §3. | 08, 10 / P04, P05 |
| REQ-VOTE-03 | Voting demokratis: satu peserta satu suara, bobot sama. | CONFIRMED | P0 | Server menyimpan maksimal satu suara aktif per peserta per ronde. | 08 / P04 |
| REQ-VOTE-04 | Tidak ada host yang bisa meng-override hasil. | CONFIRMED | P0 | Tidak ada endpoint/aksi untuk memaksa hasil. Hasil hanya dari aturan resolusi (08 §6). | 08 / P04 |
| REQ-VOTE-05 | Situasi seri ditangani dengan jelas. | CONFIRMED | P0 | Saat seri, semua klien melihat state seri yang sama dan opsi yang seri. Mekanisme: PROPOSED DEC-024. | 08 / P04 |
| REQ-VOTE-06 | Mode terkunci untuk sesi tersebut dan tidak bisa diganti di tengah sesi. | CONFIRMED | P0 | Setelah lock, server menolak perubahan mode untuk sesi itu. UI menampilkan ikon gembok. | 08 / P04 |
| REQ-VOTE-07 | Mode terkunci tetap mengizinkan kustomisasi luas atas layout internal, kanvas, frame, dan pengaturan foto. | CONFIRMED | P0 | Panel Frame, Layout & kanvas, dan Kamera tetap bisa dipakai setelah mode terkunci. | 10 / P05 |
| REQ-VOTE-08 | Untuk mode lain, peserta memulai sesi baru di room yang sama dan voting lagi. | CONFIRMED | P0 | Aksi "Sesi baru" membuat sesi baru dalam state `VOTING`. | 08 / P04, P08 |

> Catatan: penutupan voting otomatis berbasis countdown **tidak dikonfirmasi**. Angka timer "0:18" di mockup bersifat insidental (DEC-046). Aturan penutupan voting ada di 08 §5 sebagai PROPOSED.

### 4.4 Kamera live — `REQ-CAM`

| ID | Requirement | Status | Prio | Acceptance criteria | Owner / Fase |
|---|---|---|---|---|---|
| REQ-CAM-01 | LONGROLL memakai stream kamera live yang nyata. | CONFIRMED | P0 | Pada P03 ke atas, tidak ada placeholder permanen untuk feed kamera. | 09 / P03 |
| REQ-CAM-02 | Peserta saling melihat lewat pengalaman photobooth bersama. | CONFIRMED | P0 | Dengan 4 peserta, setiap klien menampilkan 3 feed remote + 1 feed lokal. | 09, 13 / P03 |
| REQ-CAM-03 | Penanganan izin kamera. | CONFIRMED | P0 | State `prompt`, `granted`, `denied`, `unavailable`, `in-use` masing-masing punya UI dan langkah pemulihan (SCR-04). | 09 / P03 |
| REQ-CAM-04 | Preview kamera live. | CONFIRMED | P0 | Preview lokal tampil ≤ 2 detik setelah izin diberikan (perangkat normal). | 09 / P03 |
| REQ-CAM-05 | Pemilihan kamera yang didukung. | CONFIRMED | P0 | Daftar `videoinput` dari `enumerateDevices` bisa dipilih; pilihan bertahan selama room. | 09 / P03 |
| REQ-CAM-06 | Switch kamera depan/belakang pada perangkat yang mendukung. | CONFIRMED | P0 | Di HP dengan ≥ 2 kamera, tombol "Ganti kamera" mengganti track tanpa memutus koneksi peer (pakai `replaceTrack`). | 09 / P03 |
| REQ-CAM-07 | Mirroring. | CONFIRMED | P0 | Toggle cermin untuk preview lokal. Aturan apakah hasil foto ikut dicerminkan: DEC-064. | 09 / P03 |
| REQ-CAM-08 | Penyesuaian kamera individual. | CONFIRMED | P1 | Kecerahan/kehangatan per peserta (diterapkan sebagai transform tampilan, bukan setting hardware, kecuali didukung). | 09 / P03, P05 |
| REQ-CAM-09 | Crop dan zoom kamera. | CONFIRMED | P0 | Peserta bisa mengatur framing (zoom 1–2× minimum, geser) atas feed-nya di dalam slot. | 09, 10 / P05 |
| REQ-CAM-10 | Penempatan video peserta di dalam layout bersama. | CONFIRMED | P0 | Feed tiap peserta dirender di slot layout sesuai binding (10 §5). | 10 / P05 |
| REQ-CAM-11 | State kamera tidak tersedia dan terputus. | CONFIRMED | P0 | Kartu kamera menampilkan state "Kamera off", "Ngizinin kamera…", "Nyambung lagi…" sesuai 05 §10. | 09 / P03 |
| REQ-CAM-12 | Kontrol kamera fisik lokal dibedakan dari presentasi foto bersama yang bisa diatur kolaboratif. | CONFIRMED | P0 | Panel diberi tag "Cuma kamu" (lokal) atau "Bareng" (shared). Tabel pemisahan: 09 §4. | 09 / P03, P05 |
| REQ-CAM-13 | Peserta lain tidak bisa mengaktifkan kamera fisik seseorang atau meng-override izin browser. | CONFIRMED | P0 | Tidak ada event yang memicu `getUserMedia`, ganti device, atau mute/unmute di klien lain. Test: TC-SEC-012. | 09, 15 / P03 |

### 4.5 Frame, kanvas, layout — `REQ-FRAME`

| ID | Requirement | Status | Prio | Acceptance criteria | Owner / Fase |
|---|---|---|---|---|---|
| REQ-FRAME-01 | Photobooth sangat bisa dikustomisasi. | CONFIRMED | P0 | Dipenuhi oleh gabungan REQ-FRAME-02..14. | 10 / P05 |
| REQ-FRAME-02 | Format photo strip fleksibel, horizontal dan vertikal. | CONFIRMED | P0 | Template strip vertikal dan horizontal tersedia; orientasi bisa diganti dalam sesi Photo Strip. | 10 / P05 |
| REQ-FRAME-03 | Photo grid. | CONFIRMED | P0 | Grid N×M dalam safeguard DEC-042 (PROPOSED: ≤ 32 cell, sisi ≤ 8). | 10 / P05 |
| REQ-FRAME-04 | Komposisi freeform. | CONFIRMED | P0 | Mode Freeform Collage mengizinkan foto ditempatkan bebas (posisi, ukuran, rotasi). | 10, 11 / P05, P07 |
| REQ-FRAME-05 | Jumlah shot bisa diatur. | CONFIRMED | P0 | Stepper jumlah shot dalam safeguard DEC-042 (PROPOSED: 1–8). Perubahan hanya sebelum shot pertama diambil (DEC-065). Kombinasi shot × peserta (≤ 32 photo cell) selalu didukung oleh model binding (DEC-087). Test: TC-FRAME-005. | 10 / P05 |
| REQ-FRAME-06 | Aspect ratio foto berbeda. | CONFIRMED | P0 | Minimal 1:1, 4:3, 3:4, 16:9, 9:16 untuk slot. | 10 / P05 |
| REQ-FRAME-07 | Dimensi output fleksibel. | CONFIRMED | P0 | Preset (misal 2×6 inci, 4×6 inci, 1:1, 9:16) + custom dalam safeguard DEC-042 (PROPOSED: sisi terpanjang 600–8192 px). | 10 / P05 |
| REQ-FRAME-08 | Jumlah slot bisa diatur. | CONFIRMED | P0 | Jumlah slot template bisa ditambah/dikurangi dalam safeguard DEC-042. Jumlah slot diturunkan dari shot, peserta, dan strategi binding (10 §5–§6); melewati safeguard menampilkan alternatif, tidak memotong diam-diam. Test: TC-FRAME-006. | 10 / P05 |
| REQ-FRAME-09 | Posisi dan ukuran slot bisa diatur. | CONFIRMED | P0 | Slot bisa digeser/diubah ukurannya di editor layout; snapping opsional. | 10 / P05 |
| REQ-FRAME-10 | Live frame preview. | CONFIRMED | P0 | Perubahan frame/layout tampil di pratinjau semua peserta ≤ 1 detik (p95). | 10 / P05 |
| REQ-FRAME-11 | Library frame bawaan yang ekstensif. | CONFIRMED | P1 | Rilis publik minimal 24 frame bawaan (target PROPOSED DEC-066) dari 6 kategori Visual Baseline. | 10 / P05 |
| REQ-FRAME-12 | Tema dan kategori frame. | CONFIRMED | P0 | Filter kategori: Korean, Minimal, Retro, Scrapbook, Pastel, Grid + "Punyaku" untuk upload. | 10 / P05 |
| REQ-FRAME-13 | Upload frame custom. | CONFIRMED | P0 | Upload PNG/WebP transparan; validasi DEC-041; frame terlihat semua peserta room. | 10, 15 / P05 |
| REQ-FRAME-14 | Adaptasi frame custom menjaga kualitas & proporsi, tidak di-stretch. | CONFIRMED | P0 | Mode fit (contain/cover/9-slice/pola) tanpa scaling non-uniform. Test: TC-FRAME-020. | 10 / P05 |
| REQ-FRAME-15 | Batas teknis (shot, dimensi, upload) didokumentasikan sebagai constraint PROPOSED. | CONFIRMED | P0 | Batas tercantum di DEC-041, DEC-042, DEC-053, DEC-085 sebagai **PROPOSED technical safeguards**. Menurunkan batas (mengurangi fleksibilitas) butuh persetujuan pemilik produk. | 10, 18 / P05 |

### 4.6 Capture & retake individual — `REQ-CAP`

| ID | Requirement | Status | Prio | Acceptance criteria | Owner / Fase |
|---|---|---|---|---|---|
| REQ-CAP-01 | Peserta mengambil foto secara tersinkron. | CONFIRMED | P0 | Satu countdown bersama; selisih waktu capture antar peserta memenuhi NFR-02. | 09 / P06 |
| REQ-CAP-02 | Setelah capture, peserta bisa ACCEPT hasil miliknya sendiri. | CONFIRMED | P0 | Tombol "Pakai ini" hanya aktif untuk foto milik peserta itu. | 09 / P06 |
| REQ-CAP-03 | Setelah capture, peserta bisa RETAKE hasil miliknya sendiri. | CONFIRMED | P0 | Tombol "Ulang" memulai countdown retake hanya untuk peserta itu. | 09 / P06 |
| REQ-CAP-04 | Retake satu peserta tidak mengubah foto accepted milik peserta lain. | CONFIRMED | P0 | Setelah peserta X retake, `acceptedAttemptId` peserta lain untuk shot yang sama byte-identik dengan sebelumnya. Test: TC-CAP-010. | 09 / P06 |
| REQ-CAP-05 | Retake tidak memaksa seluruh grup mengulang shot. | CONFIRMED | P0 | Retake tidak memicu countdown/capture di klien lain. | 09 / P06 |
| REQ-CAP-06 | Peserta lain bisa melihat foto gagal dan aktivitas retake live peserta tersebut. | CONFIRMED | P0 | Di SCR-14, kartu peserta yang retake menampilkan attempt yang ditolak + feed live + status "Ngulang · percobaan n". | 09 / P06 |
| REQ-CAP-07 | Foto accepted harus stabil. | CONFIRMED | P0 | Attempt yang sudah accepted tidak bisa ditimpa oleh event lain, termasuk retry jaringan (idempotensi: 14 §8). | 09, 14 / P06 |
| REQ-CAP-08 | Lanjut ke shot berikutnya butuh penyelesaian proses acceptance individual. | CONFIRMED | P0 | Shot berikutnya tidak bisa dimulai sebelum semua peserta yang wajib (definisi: 09 §8, DEC-028) berstatus `ACCEPTED`. | 09 / P06 |
| REQ-CAP-09 | Tidak ada auto-accept berbasis timer. | CONFIRMED | P0 | Tidak ada timer yang mengubah status ke `ACCEPTED`. Diamnya peserta tidak pernah diartikan setuju. Test: TC-CAP-015. | 09 / P06 |
| REQ-CAP-10 | Hanya peserta pemilik yang mengontrol accept/retake fotonya. | CONFIRMED | P0 | Server menolak `capture.accept`/`capture.retake` dari participantId yang bukan pemilik attempt. Test: TC-SEC-014. | 09, 15 / P06 |

### 4.7 Editor kolaboratif — `REQ-EDIT`

| ID | Requirement | Status | Prio | Acceptance criteria | Owner / Fase |
|---|---|---|---|---|---|
| REQ-EDIT-01 | Setelah capture, peserta masuk workspace editing bersama. | CONFIRMED | P0 | Setelah shot terakhir accepted, semua peserta diarahkan ke SCR-16. | 11 / P07 |
| REQ-EDIT-02 | Move, resize, rotate, crop, zoom, reposition. | CONFIRMED | P0 | Operasi tersedia untuk foto dan elemen; handle di desktop, gestur di mobile. | 11 / P07 |
| REQ-EDIT-03 | Filter. | CONFIRMED | P0 | Minimal 6 preset filter (05 §12). | 11 / P07 |
| REQ-EDIT-04 | Stiker dan elemen dekoratif. | CONFIRMED | P0 | Library stiker berkategori. Lisensi aset: DEC-055. | 11 / P07 |
| REQ-EDIT-05 | Teks. | CONFIRMED | P0 | Tambah/edit teks, pilihan gaya font, warna. | 11 / P07 |
| REQ-EDIT-06 | Doodle. | CONFIRMED | P0 | Coretan bebas dengan warna & ketebalan. | 11 / P07 |
| REQ-EDIT-07 | Penyesuaian frame. | CONFIRMED | P0 | Frame bisa diganti/diatur di editor. | 11 / P07 |
| REQ-EDIT-08 | Interaksi layer. | CONFIRMED | P0 | Naik/turun/depan/belakang, sembunyikan. | 11 / P07 |
| REQ-EDIT-09 | Undo dan riwayat. | CONFIRMED | P0 | Semantik: DEC-032 (PROPOSED). | 11 / P07 |
| REQ-EDIT-10 | Semua peserta berkolaborasi real-time. | CONFIRMED | P0 | Perubahan tampil di klien lain ≤ 500 ms (p95, jaringan normal). | 11 / P07 |
| REQ-EDIT-11 | Edit simultan diizinkan. | CONFIRMED | P0 | Tidak ada lock eksklusif yang mencegah peserta lain mengedit. | 11 / P07 |
| REQ-EDIT-12 | State bersama tetap konsisten dan bisa dipulihkan. | CONFIRMED | P0 | Setelah operasi bersamaan, semua klien konvergen ke state identik. Snapshot bisa dipulihkan setelah reconnect. Test: TC-EDIT-020. | 11, 14 / P07 |
| REQ-EDIT-13 | Tidak ada batasan editing khusus host. | CONFIRMED | P0 | Lihat REQ-ROOM-07. | 11 / P07 |
| REQ-EDIT-14 | UX tetap mudah untuk pemula. | CONFIRMED | P0 | Uji usability: 4 dari 5 penguji baru bisa menambah stiker, teks, dan memindahkan foto tanpa bantuan ≤ 2 menit (TC-UX-010). | 11 / P07, P10 |

### 4.8 Multi-sesi & galeri — `REQ-GAL`

| ID | Requirement | Status | Prio | Acceptance criteria | Owner / Fase |
|---|---|---|---|---|---|
| REQ-GAL-01 | Setelah sesi selesai, peserta bisa melihat hasil. | CONFIRMED | P0 | SCR-17 tampil untuk semua peserta. | 12 / P08 |
| REQ-GAL-02 | Peserta bisa mengunduh hasil. | CONFIRMED | P0 | Lihat REQ-EXP-01. | 12 / P08 |
| REQ-GAL-03 | Sesi selesai tetap ada di galeri sementara room. | CONFIRMED | P0 | Galeri (SCR-18) menampilkan semua sesi selesai, urut waktu. | 12 / P08 |
| REQ-GAL-04 | Peserta bisa memulai sesi baru. | CONFIRMED | P0 | Aksi "Sesi baru" tersedia di SCR-17 dan SCR-18. | 08, 12 / P08 |
| REQ-GAL-05 | Sesi baru dimulai dari voting mode lagi. | CONFIRMED | P0 | Lihat REQ-VOTE-08. | 08 / P04 |
| REQ-GAL-06 | Foto accepted/selesai boleh ditampilkan di galeri. | CONFIRMED | P1 | Tampilan "Per orang" (DEC-047, PROPOSED) hanya berisi attempt `ACCEPTED`. | 12 / P08 |
| REQ-GAL-07 | Retake gagal tidak otomatis menjadi entri galeri permanen. | CONFIRMED | P0 | Query galeri tidak pernah mengembalikan attempt `REJECTED`. Test: TC-GAL-005. | 12 / P08 |
| REQ-GAL-08 | Tidak ada galeri "take gagal" khusus tanpa persetujuan. | CONFIRMED | P0 | Tidak ada filter/section/route untuk take gagal. | 12 / P08 |

### 4.9 Export — `REQ-EXP`

| ID | Requirement | Status | Prio | Acceptance criteria | Owner / Fase |
|---|---|---|---|---|---|
| REQ-EXP-01 | Download komposisi foto final. | CONFIRMED | P0 | Tombol "Unduh" menghasilkan file gambar di perangkat (desktop: unduhan; iOS/Android: share sheet/simpan). | 12 / P08 |
| REQ-EXP-02 | Pengaturan export yang sesuai. | CONFIRMED | P0 | Format (PNG/JPG) dan ukuran (preset) bisa dipilih. | 12 / P08 |
| REQ-EXP-03 | Rendering menjaga kualitas. | CONFIRMED | P0 | Render memakai foto resolusi penuh hasil capture lokal (DEC-035), bukan screenshot UI. | 12 / P08 |
| REQ-EXP-04 | Export ke Google Drive pribadi. | CONFIRMED | P1 | File tersimpan di Drive pengguna; respons sukses menampilkan nama file. | 12 / P08 |
| REQ-EXP-05 | Drive butuh otorisasi Google terpisah, tanpa registrasi LONGROLL. | CONFIRMED | P1 | Otorisasi hanya muncul saat pengguna memilih "Simpan ke Drive"; tidak membuat akun LONGROLL. | 12, 15 / P08 |

### 4.10 Mobile — `REQ-MOB`

| ID | Requirement | Status | Prio | Acceptance criteria | Owner / Fase |
|---|---|---|---|---|---|
| REQ-MOB-01 | Mobile adalah platform kelas satu, bukan desktop yang diperkecil. | CONFIRMED | P0 | Setiap SCR punya spesifikasi mobile terpisah di 04. | 06 / semua |
| REQ-MOB-02 | Kontrol ramah sentuh. | CONFIRMED | P0 | Target sentuh ≥ 44×44 px. | 06 / semua |
| REQ-MOB-03 | Preview kamera/foto besar. | CONFIRMED | P0 | Di SCR-08 mobile, feed kamera mengisi ≥ 70% tinggi viewport. | 06 / P03, P05 |
| REQ-MOB-04 | Bottom sheet kontekstual. | CONFIRMED | P0 | Panel frame/layout/kamera/teks muncul sebagai bottom sheet, bukan modal tengah. | 06 / P05, P07 |
| REQ-MOB-05 | Bottom toolbar yang sesuai. | CONFIRMED | P0 | Shutter, timer, alat di zona jempol bawah. | 06 / P05, P06 |
| REQ-MOB-06 | Fokus kanvas fullscreen. | CONFIRMED | P0 | Booth dan editor punya mode layar penuh; toolbar bisa dilipat. | 06 / P05, P07 |
| REQ-MOB-07 | Gestur sentuh. | CONFIRMED | P0 | Pinch-zoom, rotate dua jari, drag pada elemen editor dan framing kamera. | 06, 11 / P05, P07 |
| REQ-MOB-08 | Switch kamera di mobile. | CONFIRMED | P0 | Lihat REQ-CAM-06. | 09 / P03 |
| REQ-MOB-09 | Layout sadar safe-area. | CONFIRMED | P0 | Memakai `env(safe-area-inset-*)`; tidak ada kontrol tertutup notch/home indicator. | 06 / P01 |
| REQ-MOB-10 | Presence peserta ringkas. | CONFIRMED | P0 | Stack avatar di header mobile, maksimal 1 baris. | 06 / P02 |
| REQ-MOB-11 | Aksi capture, accept, retake aksesibel. | CONFIRMED | P0 | Tombol besar (≥ 56 px tinggi) di zona bawah, label teks + ikon. | 06 / P06 |
| REQ-MOB-12 | Semua fungsi utama realistis dipakai di HP. | CONFIRMED | P0 | Uji E2E alur penuh di iOS Safari & Android Chrome fisik (TC-MOB-001). | 06, 17 / P10 |

### 4.11 Identitas visual — `REQ-UI`

| ID | Requirement | Status | Prio | Acceptance criteria | Owner / Fase |
|---|---|---|---|---|---|
| REQ-UI-01 | UI mengikuti Visual Baseline V1 (17 gambar). | CONFIRMED | P0 | Review visual per layar terhadap file referensi (04 kolom "Referensi"). | 05 / semua |
| REQ-UI-02 | Identitas: logo roll-strip, Bricolage Grotesque, Figtree, Instrument Serif, warm neutral + deep plum, aksen terkontrol. | CONFIRMED | P0 | Token & font sesuai 05. | 05 / P01 |
| REQ-UI-03 | Workspace photobooth lebih gelap dan fokus. | CONFIRMED | P0 | SCR-08, SCR-09..15 memakai tema `stage`. | 05 / P01, P05 |
| REQ-UI-04 | Fullscreen kamera mobile dan bottom sheet kontekstual. | CONFIRMED | P0 | Lihat REQ-MOB-04, REQ-MOB-06. | 06 / P05 |

---

## 5. Non-functional requirements — `NFR`

Semua target angka di bawah adalah **PROPOSED** kecuali dinyatakan lain, karena brief tidak menetapkan angka. Target divalidasi di P09/P10.

| ID | Kategori | Requirement | Target (PROPOSED) | Verifikasi |
|---|---|---|---|---|
| NFR-01 | Latensi realtime | Kursor & presence terasa langsung. | p95 ≤ 150 ms antar klien di region yang sama; kursor di-throttle ≤ 20 Hz. | TC-PERF-001 |
| NFR-02 | Sinkronisasi capture | Foto semua peserta diambil "di detik yang sama". | Selisih waktu capture antar peserta p95 ≤ 150 ms setelah koreksi clock offset. | TC-CAP-001 |
| NFR-03 | Kompatibilitas browser | Browser yang didukung. | Chrome/Edge 2 versi stabil terakhir, Firefox 2 versi terakhir, Safari macOS 17+, iOS Safari 17+, Android Chrome 2 versi terakhir. (DEC-050) | TC-XB-001 |
| NFR-04 | Aksesibilitas | Standar aksesibilitas. | Target WCAG 2.2 AA untuk UI non-kamera; kontras teks kecil ≥ 4.5:1. | TC-A11Y-001 |
| NFR-05 | Performa muat | Halaman awal cepat. | LCP ≤ 2.5 s di 4G kelas menengah untuk landing; JS awal landing ≤ 200 KB gzip. | TC-PERF-010 |
| NFR-06 | Reliabilitas koneksi | Reconnect memulihkan state. | Reconnect ≤ 10 s setelah jaringan kembali; state room, vote, attempt accepted, dan dokumen editor pulih tanpa kehilangan data yang sudah di-ack server. | TC-ROOM-020 |
| NFR-07 | Retensi data | Data room tidak hidup lebih lama dari lifecycle. | Penghapusan aktif ≤ 5 menit setelah room expired; backstop lifecycle storage ≤ 24 jam (DEC-036). | TC-SEC-030 |
| NFR-08 | Keamanan | Token dan kode room tidak bisa ditebak/disalahgunakan murah. | Lihat 15. Rate limit join & create (DEC-067). | TC-SEC-* |
| NFR-09 | Observability | Bisa didiagnosis tanpa membocorkan media/PII. | Log tidak memuat gambar, URL bertanda tangan, token, atau display name lengkap. | TC-SEC-040 |
| NFR-10 | Biaya | Infrastruktur proporsional dengan skala. | Komponen biaya utama (TURN bandwidth, storage, compute realtime) bisa dimonitor per hari. | 13 §11 |
| NFR-11 | Performa render | Booth tetap lancar di HP menengah. | Preview kamera ≥ 24 fps saat 4 feed tampil di HP kelas menengah 2022+. | TC-PERF-020 |
| NFR-12 | Kualitas export | Hasil tidak buram. | Export memakai sumber resolusi ≥ resolusi slot output; tidak ada upscaling > 1.25× tanpa peringatan. | TC-EXP-010 |

---

## 6. Aturan produk lintas fitur

| ID | Aturan | Status |
|---|---|---|
| RULE-01 | Tidak ada host. Satu-satunya hak eksklusif adalah atas perangkat sendiri dan foto sendiri (accept/retake). | CONFIRMED |
| RULE-02 | Mode dipilih lewat voting sebelum konfigurasi; terkunci per sesi. | CONFIRMED |
| RULE-03 | Diam tidak pernah berarti setuju: tidak ada auto-accept foto. | CONFIRMED |
| RULE-04 | Retake terlihat oleh semua peserta, tapi attempt gagal tidak masuk galeri. | CONFIRMED |
| RULE-05 | Semua perubahan bersama bisa dibalikkan oleh siapa saja (lewat riwayat). | PROPOSED (DEC-032) |
| RULE-06 | Copy UI tidak boleh menjanjikan privasi lebih kuat dari arsitektur (15 §11). | CONFIRMED |

## 7. User stories (ringkas, terhubung ke ID)

| ID | Sebagai… | Saya ingin… | Supaya… | Requirement |
|---|---|---|---|---|
| US-01 | Pengunjung baru | bikin room tanpa daftar | bisa langsung foto bareng temen | REQ-ROOM-01..04 |
| US-02 | Teman yang diundang | buka link dan langsung masuk | gak perlu ngetik kode | REQ-ROOM-05 |
| US-03 | Peserta | ikut voting mode dengan suara yang sama | hasilnya adil | REQ-VOTE-01..05 |
| US-04 | Peserta | ganti frame & layout setelah mode terkunci | hasilnya sesuai selera grup | REQ-VOTE-07, REQ-FRAME-* |
| US-05 | Peserta yang merem | ulang fotoku sendiri | foto temen yang udah bagus gak ikut diulang | REQ-CAP-03..05 |
| US-06 | Peserta lain | lihat temen yang lagi ngulang | momen lucunya tetap dinikmati bareng | REQ-CAP-06 |
| US-07 | Peserta | nempel stiker & teks bareng secara bersamaan | prosesnya seru dan cepat | REQ-EDIT-* |
| US-08 | Peserta | unduh atau simpan ke Drive | punya salinan setelah room hilang | REQ-EXP-*, REQ-LIFE-06 |
| US-09 | Peserta | mulai sesi baru dengan mode lain | gak perlu bikin room baru | REQ-LIFE-07, REQ-VOTE-08 |
| US-10 | Pengguna HP | semua fitur nyaman dipakai dengan jempol | gak kalah dari pengguna laptop | REQ-MOB-* |
| US-11 | Peserta yang sinyalnya putus | balik ke room tanpa kehilangan foto | gak ngulang dari awal | REQ-LIFE-02, NFR-06 |

## 8. Edge case utama

| ID | Kasus | Perilaku yang diharapkan | Ref |
|---|---|---|---|
| EC-01 | Peserta ke-5 membuka link | Ditolak dengan SCR-03 "Room penuh". | REQ-ROOM-06 |
| EC-02 | Dua peserta join bersamaan saat slot tinggal 1 | Server memproses atomik; satu masuk, satu dapat "Room penuh". | 07 §4 |
| EC-03 | Semua vote masuk tapi seri | State seri → ronde ulang (DEC-024). | REQ-VOTE-05 |
| EC-04 | Peserta putus saat voting | Suaranya tetap tercatat selama slot di-hold; resolusi dihitung dari peserta yang tercatat. | 08 §7 |
| EC-05 | Peserta putus saat countdown | Capture peserta lain tetap jalan; peserta yang putus berstatus `MISSING` untuk shot itu. | 09 §10 |
| EC-06 | Peserta retake 10× | Tidak ada batas (DEC-029); semua attempt ditolak tetap terlihat selama shot berlangsung. | REQ-CAP-06 |
| EC-07 | Peserta tidak pernah menekan accept | Shot tidak maju. UI menampilkan siapa yang ditunggu + aksi "Colek" (PROPOSED). Tidak ada auto-accept. | REQ-CAP-09, DEC-028 |
| EC-08 | Dua peserta menggeser stiker yang sama bersamaan | Konvergen ke satu posisi; pihak yang "kalah" melihat toast dengan "Balikin". | REQ-EDIT-12, DEC-031 |
| EC-09 | Upload frame 14 MB | Ditolak dengan pesan ukuran. | DEC-041 |
| EC-10 | Semua peserta tutup tab lalu satu kembali dalam grace period | Room pulih penuh. | REQ-LIFE-03 |
| EC-11 | Kembali setelah grace period | SCR-21 Room bubar. | REQ-LIFE-04 |
| EC-12 | Kamera ditolak | Peserta tetap bisa masuk tanpa kamera (DEC-068) dan berpartisipasi di voting/editor; slot foto berstatus "tanpa kamera". | REQ-CAM-03 |
| EC-13 | Room dipakai > 12 jam dengan peserta tetap terhubung | Room tetap hidup; tidak ada peringatan atau penghancuran karena umur (DEC-052 OPEN, default tanpa batas). | REQ-LIFE-01 |
| EC-14 | 4 peserta memilih 8 shot | 32 photo cell; generator membuat plan untuk strategi binding aktif tanpa memotong shot/peserta (DEC-087). | REQ-FRAME-05, REQ-FRAME-08 |

## 9. Traceability ringkas

Matriks lengkap requirement → test ada di [17_QA_TEST_PLAN.md](17_QA_TEST_PLAN.md) §10. Matriks requirement → fase ada di [16_IMPLEMENTATION_ROADMAP.md](16_IMPLEMENTATION_ROADMAP.md) §4.
