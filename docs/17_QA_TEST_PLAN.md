# 17 — QA Test Plan

| Atribut | Nilai |
|---|---|
| Versi | 1.1.0 |
| Status | Rencana tes. **Belum ada tes yang dijalankan.** Hasil tes hanya boleh dicatat setelah benar-benar dijalankan, lengkap dengan bukti. |

## 1. Strategi

| Level | Cakupan | Alat (RECOMMENDED) | Otomatis? |
|---|---|---|---|
| Unit | Fungsi murni: resolusi vote, state machine shot/attempt, validasi, binding layout, adaptasi frame, fractional index | Vitest | Ya |
| Integrasi | Room actor + Redis + storage (lokal/minio), HTTP API, event WS | Vitest + container Redis/minio | Ya |
| E2E multi-peserta | Alur di browser dengan 2–4 konteks sekaligus | Playwright, Chromium dengan `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` | Ya (dengan media palsu) |
| WebRTC nyata | Koneksi P2P/TURN di jaringan berbeda | Perangkat nyata + `chrome://webrtc-internals` / `getStats` | Sebagian manual |
| Perangkat nyata | Kamera, gestur, share sheet, safe area | iOS & Android fisik (§5) | **Manual** |
| Visual | Kesesuaian dengan Visual Baseline V1 | Screenshot Playwright + review manusia | Semi |
| Aksesibilitas | Kontras, keyboard, screen reader | axe-core (otomatis) + VoiceOver/TalkBack (manual) | Semi |
| Performa | Latensi event, skew capture, fps, bundle | Skrip beban WS, metrik `getStats`, Lighthouse | Semi |
| Keamanan | Otorisasi, upload, rate limit, cleanup | Tes integrasi + pemeriksaan manual | Semi |

Label tipe di tabel skenario: **A** = otomatis, **M** = manual/manusia, **D** = butuh perangkat nyata.

## 2. Tes sepanjang fase

Setiap fase wajib menambahkan tes untuk fitur yang dibangunnya. P10 menjalankan semuanya, tapi **tidak menggantikan** tes per fase.

| Fase | Minimal yang harus ada di akhir fase |
|---|---|
| P01 | Unit komponen dasar, tes visual landing, axe-core di halaman statis |
| P02 | Unit actor (join/kapasitas/hold/grace), integrasi API, E2E 4 konteks join + presence, TC-ROOM-*, TC-SEC-001/003/020/022/023/030 |
| P03 | E2E media palsu 4 konteks, uji manual perangkat (TC-RTC-*), TC-CAM-007 |
| P04 | Unit resolusi vote (tabel kasus), E2E voting + seri |
| P05 | Unit adaptasi frame & binding (TC-FRAME-005..007, kedua strategi), integrasi upload frame (TC-SEC-016/017), E2E sinkron studio |
| P06 | Unit state machine shot/attempt + invariant accept, E2E retake 4 konteks, uji perangkat nyata TC-CAP-010 |
| P07 | Unit konvergensi Yjs (simulasi operasi bersamaan), E2E edit 4 konteks, uji gestur perangkat |
| P08 | Unit render (golden image), TC-EXP-012, E2E galeri/multi-sesi, uji unduh perangkat, Drive manual |
| P09 | Semua TC-SEC, uji kegagalan (IC-6, TC-ROOM-027), uji beban, TC-PERF-022 |
| P10 | Seluruh rangkaian + regresi + matriks perangkat |

## 3. Lingkungan

| Lingkungan | Kegunaan |
|---|---|
| Lokal | Unit & integrasi (Redis + minio via container) |
| Staging | E2E, perangkat nyata, TURN nyata, data terpisah dari produksi |
| Produksi | Smoke test pasca-deploy + verifikasi cleanup (dengan room uji) |

Perintah verifikasi (contoh, **dijalankan oleh/atas izin pengguna**, 00 §4.1): `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm lint`.

## 4. Format skenario

| Kolom | Isi |
|---|---|
| ID | `TC-{AREA}-{nnn}` |
| Prio | P0/P1/P2 (sesuai requirement) |
| Tipe | A / M / D |
| Langkah & ekspektasi | Ringkas, bisa diulang |
| PASS | Kondisi yang harus benar |
| FAIL | Kondisi yang membuat gagal |

## 5. Matriks perangkat & browser (DEC-050)

| Kombinasi | Peserta 1 | Peserta 2 | Peserta 3 | Peserta 4 |
|---|---|---|---|---|
| K1 (desktop) | Chrome Windows | Chrome macOS | Firefox | Edge |
| K2 (campuran) | Chrome desktop | Safari macOS | iPhone Safari | Android Chrome |
| K3 (mobile semua) | iPhone (iOS 17+) | iPhone lama yang didukung | Android menengah | Android flagship |
| K4 (jaringan) | Wi-Fi rumah | 4G seluler | Jaringan ketat (UDP diblokir → TURN TCP/TLS) | Wi-Fi publik |

## 6. Skenario per area

### 6.1 Room & lifecycle — `TC-ROOM`

| ID | Prio | Tipe | Skenario | PASS | FAIL |
|---|---|---|---|---|---|
| TC-ROOM-001 | P0 | A | Buat room dengan nama valid | Respons berisi kode 6 karakter dari alfabet DEC-022; pembuat masuk SCR-04 | Kode di luar alfabet / gagal |
| TC-ROOM-002 | P0 | A | Join via kode huruf kecil | Kode dinormalkan, join sukses | Ditolak |
| TC-ROOM-003 | P0 | A | Join via `/r/{code}` | Kode terisi & terkunci, langsung ke input nama | Diminta mengetik kode |
| TC-ROOM-004 | P0 | A | Peserta ke-5 join | `409 ROOM_FULL`; UI "Udah 4 orang di dalem."; jumlah peserta tetap 4 | 5 peserta di room |
| TC-ROOM-005 | P0 | A | 2 join bersamaan untuk slot terakhir | Tepat satu sukses | Dua sukses |
| TC-ROOM-010 | P0 | A | Pembuat room vs peserta lain: jalankan semua aksi bersama (mulai vote, tutup vote, ganti frame, shutter, Tunggu!, edit, finalisasi, sesi baru) dari peserta **bukan** pembuat | Semua aksi berhasil sama | Ada aksi yang hanya bisa dilakukan pembuat |
| TC-ROOM-011 | P0 | A | Warna unik | 4 peserta mendapat P1..P4 berbeda | Duplikat warna |
| TC-ROOM-012 | P0 | A | Presence join/leave | Klien lain melihat perubahan ≤ 2 s | > 2 s / tidak muncul |
| TC-ROOM-013 | P0 | A | Kursor desktop | Kursor & label muncul di voting/studio/editor, tidak di lobby | Muncul di lobby / tidak muncul |
| TC-ROOM-020 | P0 | A+D | Reload di tengah sesi (setelah accept shot 1) | Peserta kembali dengan warna, nama, & foto accepted sama ≤ 10 s | Kehilangan slot/foto |
| TC-ROOM-021 | P0 | A | Putus > hold (60 s) | Status `LEFT`, slot bebas, foto accepted tetap di sesi | Slot tertahan / foto hilang |
| TC-ROOM-022 | P0 | A | Semua keluar lalu satu kembali dalam grace | Room pulih penuh | Room hilang |
| TC-ROOM-023 | P0 | A | Semua keluar, tunggu > grace | Link membuka SCR-21; token ditolak | Room masih bisa dimasuki |
| TC-ROOM-024 | P1 | A | Token yang sama dibuka di tab kedua | Tab lama menerima `session.replaced` | Dua koneksi aktif untuk satu peserta |
| TC-ROOM-025 | P0 | A | Tidak ada login | Tidak ada halaman/endpoint akun; alur lengkap tanpa email | Ada permintaan akun |
| TC-ROOM-026 | P0 | A | Room aktif > 12 jam dengan ≥ 1 peserta terhubung (jam disimulasikan), konfigurasi default | Room tetap `ACTIVE`; tidak ada `room.expiring`/peringatan umur; `expiresAtMs = null` (DEC-052 default) | Room diperingatkan/dihancurkan karena umur |
| TC-ROOM-027 | P0 | A | Restart proses realtime tunggal saat sesi `CAPTURING` (DEC-088) | Setelah restart, klien resume; peserta, vote, attempt accepted, dan doc pulih dari snapshot Redis | Data yang sudah di-ack hilang |

### 6.2 Voting — `TC-VOTE`

| ID | Prio | Tipe | Skenario | PASS | FAIL |
|---|---|---|---|---|---|
| TC-VOTE-001 | P0 | A | 4 vote: 3 Strip, 1 Grid | `LOCKED PHOTO_STRIP`, method `MAJORITY` | Hasil lain |
| TC-VOTE-002 | P0 | A | Ganti suara sebelum tutup | Hanya suara terakhir dihitung | Dua suara dihitung |
| TC-VOTE-003 | P0 | A | Seri 2–2 | Ronde 2 hanya dengan 2 opsi seri; semua klien melihat state sama | Opsi lain muncul / beda state |
| TC-VOTE-004 | P0 | A | Masih seri di ronde 2 | Hasil `RANDOM`, sama di semua klien, tercatat di eventLog | Klien berbeda hasil |
| TC-VOTE-005 | P0 | A | Tidak ada timer otomatis | Voting tetap terbuka > 5 menit tanpa semua memilih dan tanpa "Tutup vote" | Voting tertutup otomatis |
| TC-VOTE-006 | P0 | A | "Tutup vote" sebelum mayoritas | Ditolak `CLOSE_NOT_ALLOWED` | Tertutup |
| TC-VOTE-007 | P0 | A | Peserta `LEFT` saat voting | Suaranya dihapus, tally dihitung ulang | Suara tetap dihitung |
| TC-VOTE-008 | P0 | A | Ubah mode setelah lock | Ditolak `MODE_LOCKED` | Mode berubah |
| TC-VOTE-009 | P0 | A | Sesi baru | Sesi n+1 di `VOTING`; sesi n `CLOSED` | Mode terbawa |

### 6.3 Kamera & WebRTC — `TC-CAM`, `TC-RTC`

| ID | Prio | Tipe | Skenario | PASS | FAIL |
|---|---|---|---|---|---|
| TC-CAM-001 | P0 | D | Izin diberikan | Preview ≤ 2 s | > 2 s / gagal |
| TC-CAM-002 | P0 | D | Izin ditolak (iOS, Android, desktop) | State `denied` + langkah pemulihan sesuai platform | Layar kosong/error mentah |
| TC-CAM-003 | P0 | D | Kamera dipakai app lain | State `in_use` | Crash/hang |
| TC-CAM-004 | P0 | D | Ganti depan/belakang saat terhubung | Peer melihat feed baru tanpa reconnect | Peer putus |
| TC-CAM-005 | P0 | D | Cermin | Preview tercermin; foto sesuai DEC-064 | Tidak konsisten |
| TC-CAM-006 | P0 | M | Tab ke background lalu kembali (mobile) | Status "Kamera off" selama background; pulih otomatis | Feed beku permanen |
| TC-CAM-007 | P0 | A | Alur kamera di semua layar (DEC-076 default) | `getUserMedia` dipanggil dengan `audio: false`; tidak ada prompt mikrofon; `Permissions-Policy: microphone=()` | Mikrofon diminta |
| TC-RTC-001 | P0 | A | 4 konteks media palsu | Tiap klien menerima 3 track remote ≤ 5 s | Track hilang |
| TC-RTC-002 | P0 | D | Kombinasi K2 | Semua feed tampil | Ada pasangan yang gagal |
| TC-RTC-003 | P0 | D | Kombinasi K4 (UDP diblokir) | Koneksi via TURN TCP/TLS berhasil | Gagal |
| TC-RTC-004 | P1 | A | ICE gagal disimulasikan | `restartIce` → pulih ≤ 10 s, atau kartu error + Coba lagi | Hang tanpa status |
| TC-RTC-005 | P0 | D | 4 peserta, 2 HP menengah, 15 menit | Preview ≥ 24 fps di HP (NFR-11), tanpa crash, suhu wajar | fps < 24 berkelanjutan / crash |

### 6.4 Frame & layout — `TC-FRAME`

| ID | Prio | Tipe | Skenario | PASS | FAIL |
|---|---|---|---|---|---|
| TC-FRAME-001 | P0 | A | Ganti frame "Pasang buat semua" | Klien lain melihat perubahan ≤ 1 s + toast | Tidak sinkron |
| TC-FRAME-002 | P0 | A | Pratinjau frame lokal | Tidak mengubah frame klien lain | Ikut berubah |
| TC-FRAME-003 | P0 | A | Ubah jumlah shot sebelum shot 1 | Sukses | — |
| TC-FRAME-004 | P0 | A | Ubah jumlah shot setelah shot 1 | Ditolak `STRUCTURE_LOCKED` | Berubah |
| TC-FRAME-005 | P0 | A | Generator BindingPlan untuk setiap mode Strip/Group/Grid × strategi `PER_SHOT_GROUP` & `PER_PARTICIPANT_SHOT` × 1–8 shot × 1–4 peserta, plus Freeform | Setiap kombinasi menghasilkan plan valid (validator bersama lulus), semua cell terpetakan tepat sekali, dan pratinjau ter-render tanpa error | Ada kombinasi yang gagal/ter-truncate |
| TC-FRAME-006 | P0 | A | Pengaturan yang melewati safeguard (misal shot = 9, grid 9×4, output > 8192 px) | Ditolak `INVALID_PATCH {reason:'SAFEGUARD'}`; UI menampilkan batas + alternatif; nilai sebelumnya tidak dipotong diam-diam | Nilai dipotong tanpa pemberitahuan |
| TC-FRAME-007 | P0 | A | Ubah `bindingStrategy` sebelum & sesudah shot 1 | Sebelum: sukses & tersinkron; sesudah: `STRUCTURE_LOCKED` | Berubah setelah shot 1 |
| TC-FRAME-010 | P0 | A | Upload PNG 9 MB valid | Diterima, re-encode, lubang terdeteksi | Ditolak |
| TC-FRAME-011 | P0 | A | Upload 14 MB | `FRAME_TOO_LARGE` + pesan | Diterima |
| TC-FRAME-020 | P0 | A | Adaptasi frame rasio 1:3 ke output 1:1 | Skala artwork seragam (rasio sumbu sama ±0.1%); tidak ada stretch | Stretch non-uniform |
| TC-FRAME-021 | P1 | A | Mode `NINE_SLICE` | Sudut tidak berubah ukuran relatif; tepi di-tile | Sudut terdistorsi |

### 6.5 Capture & retake — `TC-CAP`

| ID | Prio | Tipe | Skenario | PASS | FAIL |
|---|---|---|---|---|---|
| TC-CAP-001 | P0 | A+D | Skew capture 4 peserta (K1, K2) | p95 `capturedAtServerMs` selisih ≤ 150 ms (NFR-02) | > 150 ms |
| TC-CAP-002 | P0 | A | Tunggu! sebelum T0 | Semua klien membatalkan; tidak ada attempt | Ada yang capture |
| TC-CAP-003 | P0 | A | Tunggu! setelah T0 | `TOO_LATE`, capture berlaku | Capture batal |
| TC-CAP-004 | P0 | A | Shutter saat ada yang belum siap | Konfirmasi muncul sebelum countdown | Langsung countdown tanpa konfirmasi |
| TC-CAP-010 | P0 | A+D | **Retake independen:** shot 2, Nadia/Raka/Sasa accept, Bimo retake 3× lalu accept | `acceptedAttemptId` & hash file Nadia/Raka/Sasa **identik** sebelum dan sesudah; tidak ada countdown di klien mereka saat Bimo retake | Ada perubahan di foto peserta lain / countdown muncul di klien lain |
| TC-CAP-011 | P0 | A | Visibilitas retake | Klien lain menerima `retake.started` dengan preview attempt ditolak + countdown Bimo | Tidak terlihat |
| TC-CAP-012 | P0 | A | Accept attempt milik orang lain | `FORBIDDEN_NOT_OWNER` | Diterima |
| TC-CAP-013 | P0 | A | Shot maju | Maju hanya saat semua wajib `ACCEPTED/SKIPPED` | Maju lebih awal |
| TC-CAP-014 | P0 | A | Peserta wajib putus > 15 s | "Lanjut tanpa dia" tersedia; setelah ditekan status `SKIPPED` | Tidak tersedia / auto-skip tanpa aksi |
| TC-CAP-015 | P0 | A | **Tanpa auto-accept:** peserta diam 10 menit di `DECIDING` | Status tetap `DECIDING`; shot tidak maju | Status berubah ke `ACCEPTED` |
| TC-CAP-016 | P0 | A | Upload gagal 3× | `FAILED` + Coba lagi; peserta lain melihat status | Hang |
| TC-CAP-017 | P0 | A | Attempt `REJECTED` setelah shot `DONE` | Objek storage terhapus | Masih ada |
| TC-CAP-018 | P1 | A | Ganti pilihan setelah accept, sebelum shot maju | Kembali `DECIDING`, foto lama tetap tersimpan sampai keputusan baru | Foto hilang |

### 6.6 Editor — `TC-EDIT`

| ID | Prio | Tipe | Skenario | PASS | FAIL |
|---|---|---|---|---|---|
| TC-EDIT-001 | P0 | A | Tambah stiker | Muncul di 3 klien lain ≤ 500 ms | > 500 ms / tidak muncul |
| TC-EDIT-002 | P0 | A | Move/resize/rotate/crop/zoom/filter/teks/doodle/layer | Tiap operasi tersinkron & tersimpan | Ada operasi yang tidak sinkron |
| TC-EDIT-010 | P0 | A | Dua peserta menggeser elemen sama bersamaan | State akhir identik di semua klien; penulis yang kalah dapat toast | Divergen |
| TC-EDIT-011 | P0 | A | Hapus vs edit bersamaan | Elemen terhapus; editor dapat toast "Balikin" yang memulihkan elemen | Elemen muncul lagi tanpa aksi / crash |
| TC-EDIT-012 | P0 | A | Undo pribadi | Hanya membatalkan operasi sendiri | Membatalkan operasi orang lain |
| TC-EDIT-013 | P0 | A | Balikin di riwayat oleh peserta lain | Properti kembali; entri baru ditambahkan | Riwayat terhapus |
| TC-EDIT-020 | P0 | A | Fuzz: 4 klien × 500 operasi acak + putus-sambung | Semua dokumen konvergen identik (`encodeStateAsUpdate` setara) | Divergen |
| TC-EDIT-021 | P0 | D | Gestur mobile (pinch, rotate, drag, coret) | Bekerja tanpa scroll halaman | Halaman ikut scroll / gestur salah |
| TC-EDIT-022 | P0 | A | Update tidak valid (attemptId bukan accepted) | Ditolak | Diterima |

### 6.7 Galeri & export — `TC-GAL`, `TC-EXP`

| ID | Prio | Tipe | Skenario | PASS | FAIL |
|---|---|---|---|---|---|
| TC-GAL-001 | P0 | A | Finalisasi sesi | Entri galeri dengan preview | Tidak muncul |
| TC-GAL-002 | P0 | A | 3 sesi | Galeri berisi 3 entri urut | Hilang/urutan salah |
| TC-GAL-005 | P0 | A | Attempt `REJECTED` | Tidak pernah ada di `gallery.view` (termasuk Per orang) | Muncul |
| TC-GAL-006 | P0 | A | Tidak ada filter take gagal | UI & API tidak punya filter/route take gagal | Ada |
| TC-EXP-001 | P0 | D | Unduh PNG di desktop, Android, iOS | File tersimpan/bisa disimpan | Gagal di salah satu platform |
| TC-EXP-002 | P0 | A | JPG vs PNG | Format & ekstensi benar | Salah |
| TC-EXP-010 | P0 | A | Kualitas export Cetak 300 dpi | Dimensi sesuai preset; sumber foto resolusi penuh; tanpa upscaling > 1.25× tanpa peringatan | Buram tanpa peringatan |
| TC-EXP-011 | P0 | A | Golden image | Render export = render referensi (selisih piksel ≤ ambang yang ditetapkan) | Berbeda |
| TC-EXP-012 | P0 | A+D | Export plan 32 cell (8 shot × 4 peserta, strategi foto per orang) di desktop & HP menengah | File ter-render via tiling dengan dimensi ≤ safeguard; peringatan kualitas muncul jika cell < 240 px | Crash / cell hilang / tanpa peringatan |
| TC-EXP-020 | P1 | M | Simpan ke Drive (akun uji) | File ada di folder LONGROLL di Drive | Gagal |
| TC-EXP-021 | P1 | M | Drive ditolak / penuh (simulasi) | Pesan sesuai 12 §6 | Error mentah |
| TC-EXP-022 | P0 | A | Token Google tidak dikirim ke server | Tidak ada request ke backend LONGROLL yang berisi token Google | Ada |

### 6.8 Mobile & UX — `TC-MOB`, `TC-UX`

| ID | Prio | Tipe | Skenario | PASS | FAIL |
|---|---|---|---|---|---|
| TC-MOB-001 | P0 | D | Alur penuh F-01..F-16 di iOS Safari & Android Chrome | Semua langkah selesai tanpa desktop | Ada langkah yang tidak bisa dilakukan |
| TC-MOB-002 | P0 | D | Safe area (iPhone ber-notch, landscape) | Tidak ada kontrol tertutup | Tertutup |
| TC-MOB-003 | P0 | A | Target sentuh | Semua kontrol ≥ 44×44 di `pointer: coarse` | < 44 |
| TC-MOB-004 | P0 | D | Keyboard virtual di sheet teks | Input & elemen teks terlihat | Tertutup keyboard |
| TC-UX-010 | P0 | M | Usability editor: 5 penguji baru | ≥ 4 dari 5 menambah stiker, teks, dan memindah foto ≤ 2 menit tanpa bantuan | < 4 |
| TC-UX-011 | P0 | M | Review visual terhadap V1 (16 layar) | Reviewer menyetujui tiap layar | Ada layar ditolak |

### 6.9 Aksesibilitas — `TC-A11Y`

| ID | Prio | Tipe | Skenario | PASS | FAIL |
|---|---|---|---|---|---|
| TC-A11Y-001 | P0 | A | axe-core di semua layar light & stage | 0 pelanggaran serious/critical | Ada |
| TC-A11Y-002 | P0 | M | Keyboard-only: buat room → vote → shutter → Pakai → editor (panel Layer) → unduh | Bisa diselesaikan | Terhambat |
| TC-A11Y-003 | P1 | D | VoiceOver & TalkBack | Shutter, Pakai/Ulang, voting dapat dioperasikan | Tidak bisa |
| TC-A11Y-004 | P0 | A | `prefers-reduced-motion` | Tanpa flash/animasi koin | Masih ada |

### 6.10 Performa — `TC-PERF`

| ID | Prio | Tipe | Skenario | PASS | FAIL |
|---|---|---|---|---|---|
| TC-PERF-001 | P0 | A | Latensi kursor/presence satu region | p95 ≤ 150 ms (NFR-01) | > 150 |
| TC-PERF-010 | P1 | A | Lighthouse landing (4G emulasi) | LCP ≤ 2.5 s, JS awal ≤ 200 KB gzip | Melebihi |
| TC-PERF-020 | P0 | D | fps preview 4 feed di HP menengah | ≥ 24 fps | < 24 |
| TC-PERF-021 | P1 | D | Drag di editor | ≥ 30 fps HP menengah, 60 fps desktop | Lebih rendah |
| TC-PERF-022 | P0 | D | Studio, editor, dan export dengan 32 photo cell di HP menengah & desktop | Studio ≥ 24 fps dengan 4 feed live; editor drag ≥ 30 fps HP; export selesai tanpa crash (fallback ukuran dengan pemberitahuan boleh) | Crash / freeze > 3 s |
| TC-PERF-030 | P1 | A | Beban: N room simulasi (tanpa media) | Event p95 ≤ 150 ms pada target N (ditetapkan P09) | Melebihi |

### 6.11 Keamanan & privasi — `TC-SEC`

| ID | Prio | Tipe | Skenario | PASS | FAIL |
|---|---|---|---|---|---|
| TC-SEC-001 | P0 | A | 25 kode acak salah dari satu IP | Rate limit aktif setelah 20 | Tidak dibatasi |
| TC-SEC-002 | P0 | A | Token room A dipakai di room B | Ditolak `AUTH_INVALID` | Diterima |
| TC-SEC-003 | P0 | A | Upgrade WS tanpa cookie token valid; mode fallback: WS tanpa `auth` 5 s | Upgrade ditolak `401`; fallback: ditutup `4401` | Koneksi diterima |
| TC-SEC-010 | P0 | A | Preview room tanpa token | Hanya inisial & jumlah; tanpa nama lengkap/feed/foto | Data bocor |
| TC-SEC-012 | P0 | A | Kirim event mencoba mengubah kamera/presence peserta lain | Ditolak; tidak ada efek di klien target | Klien target berubah |
| TC-SEC-014 | P0 | A | `capture.accept`/`retake` untuk attempt orang lain | `FORBIDDEN_NOT_OWNER` | Diterima |
| TC-SEC-016 | P0 | A | Upload SVG/HTML yang diganti ekstensi `.png` | Ditolak (magic bytes) | Diterima |
| TC-SEC-017 | P0 | A | Decompression bomb PNG | Ditolak tanpa lonjakan memori | Server kehabisan memori |
| TC-SEC-018 | P0 | A | Signed URL setelah TTL | 403 | Masih bisa diakses |
| TC-SEC-019 | P1 | M | TURN relay ke IP privat | Diblokir | Terhubung |
| TC-SEC-020 | P0 | A | Nama berisi `<script>`/HTML | Ditampilkan sebagai teks | Dieksekusi/dirender |
| TC-SEC-021 | P0 | A | CSP & header keamanan | Header sesuai 15 §6 | Hilang |
| TC-SEC-022 | P0 | A | Atribut cookie token peserta (DEC-082) | `HttpOnly; Secure; SameSite=Strict`; `document.cookie` tidak memuat token; token tidak ada di URL, body respons (mode normal), maupun log | Token terbaca JS / bocor |
| TC-SEC-023 | P0 | A | Upgrade WS & request API dari `Origin` asing dengan cookie valid | Ditolak; tidak ada efek di room | Diterima |
| TC-SEC-030 | P0 | A | **Cleanup room:** buat room, upload foto & frame, semua keluar, tunggu grace | Prefix storage kosong, key Redis room kosong, tombstone ada tanpa data pribadi | Ada sisa |
| TC-SEC-031 | P0 | A | Cleanup gagal disimulasikan (storage error) | Retry & sweeper menghapus; metric gagal tercatat | Data tertinggal tanpa alarm |
| TC-SEC-032 | P1 | M | Lifecycle bucket 24 jam | Objek uji > 24 jam terhapus | Masih ada |
| TC-SEC-040 | P0 | A | Flood 500 event/detik | Koneksi dibatasi/ditutup; room lain tidak terganggu | Room lambat/crash |
| TC-SEC-041 | P0 | A | Pindai log uji | Tidak ada display name, token, signed URL, gambar | Ada |

### 6.12 Lintas browser — `TC-XB`

| ID | Prio | Tipe | Skenario | PASS | FAIL |
|---|---|---|---|---|---|
| TC-XB-001 | P0 | D | Alur inti di semua browser DEC-050 | Lulus di semua | Ada yang gagal tanpa workaround |

## 7. Skenario 4 peserta (E2E wajib)

| ID | Skenario | Kombinasi |
|---|---|---|
| TC-E2E-001 | Alur lengkap 1 sesi Photo Strip 4 shot dengan 2 retake dari peserta berbeda | K1 (A), K2 (D) |
| TC-E2E-002 | Dua sesi berbeda mode dalam satu room + unduh semua hasil | K2 |
| TC-E2E-003 | Peserta putus saat countdown, kembali saat review | K4 |
| TC-E2E-004 | Peserta join terlambat saat `CAPTURING` (DEC-030) | K1 |
| TC-E2E-005 | Semua keluar, satu kembali dalam grace, lanjut sesi | K2 |
| TC-E2E-006 | Edit chaos: 4 peserta mengedit 2 menit tanpa koordinasi | K1 (A), K3 (D) |

## 8. Regresi

- Setiap bug yang diperbaiki mendapat tes regresi dengan ID `TC-REG-{nnn}` yang merujuk ID bug.
- Rangkaian regresi minimum sebelum setiap rilis: semua P0 A + TC-E2E-001 di K2 (D).
- Tes visual: screenshot 16 layar V1 dibandingkan dengan baseline yang disetujui; perubahan perlu persetujuan manusia.

## 9. Pelaporan & bukti

| Aturan | Detail |
|---|---|
| Bukti | Tes A: output runner / laporan CI. Tes M/D: siapa, kapan, perangkat & versi OS/browser, hasil, screenshot/video bila relevan. |
| Status | `NOT RUN`, `PASS`, `FAIL`, `BLOCKED`. Default `NOT RUN`. |
| Larangan | **Tidak boleh** menandai PASS tanpa menjalankan tes. Tes yang belum dijalankan ditulis di handoff fase. |
| Flaky | Tes yang gagal intermiten ditandai & diperbaiki, tidak diabaikan. |

## 10. Matriks traceability requirement → test

| Requirement | Test |
|---|---|
| REQ-ROOM-01 | TC-ROOM-025 |
| REQ-ROOM-03..05 | TC-ROOM-001..003 |
| REQ-ROOM-06 | TC-ROOM-004, -005 |
| REQ-ROOM-07, -08 | TC-ROOM-010 |
| REQ-ROOM-09 | TC-ROOM-011 |
| REQ-ROOM-10 | TC-ROOM-013 |
| REQ-ROOM-11 | TC-EDIT-021, TC-MOB-001 |
| REQ-ROOM-12 | TC-ROOM-012 |
| REQ-ROOM-13 | TC-SEC-002, -022, -023 |
| REQ-LIFE-01..04 | TC-ROOM-020..023, TC-ROOM-026 |
| REQ-LIFE-05 | TC-SEC-030..032, TC-CAP-017 |
| REQ-LIFE-06 | TC-UX-011 (copy), 15 §11 review |
| REQ-LIFE-07 | TC-E2E-002 |
| REQ-VOTE-01..08 | TC-VOTE-001..009 |
| REQ-CAM-01..02 | TC-RTC-001..003 |
| REQ-CAM-03..07, -11 | TC-CAM-001..007 |
| REQ-CAM-08..10, -12 | TC-FRAME-001, TC-E2E-001 |
| REQ-CAM-13 | TC-SEC-012 |
| REQ-FRAME-01..12 | TC-FRAME-001..007 |
| REQ-FRAME-13..15 | TC-FRAME-006, -010, -011, -020, -021, TC-SEC-016, -017 |
| REQ-CAP-01 | TC-CAP-001..004 |
| REQ-CAP-02..07 | TC-CAP-010, -011, -018 |
| REQ-CAP-08 | TC-CAP-013, -014 |
| REQ-CAP-09 | TC-CAP-015 |
| REQ-CAP-10 | TC-CAP-012, TC-SEC-014 |
| REQ-EDIT-01..11, -13 | TC-EDIT-001, -002, -010..013 |
| REQ-EDIT-12 | TC-EDIT-020, -022 |
| REQ-EDIT-14 | TC-UX-010 |
| REQ-GAL-01..06 | TC-GAL-001, -002, TC-E2E-002 |
| REQ-GAL-07..08 | TC-GAL-005, -006 |
| REQ-EXP-01..03 | TC-EXP-001, -002, -010..012 |
| REQ-EXP-04..05 | TC-EXP-020..022 |
| REQ-MOB-01..12 | TC-MOB-001..004, TC-EDIT-021, TC-RTC-005 |
| REQ-UI-01..04 | TC-UX-011, TC-A11Y-001 |
| NFR-01 | TC-PERF-001 |
| NFR-02 | TC-CAP-001 |
| NFR-03 | TC-XB-001 |
| NFR-04 | TC-A11Y-001..004 |
| NFR-05 | TC-PERF-010 |
| NFR-06 | TC-ROOM-020, -027 |
| NFR-07 | TC-SEC-030..032 |
| NFR-08 | TC-SEC-001..023 |
| NFR-09 | TC-SEC-041 |
| NFR-10 | Bukan tes otomatis: laporan biaya per 1.000 sesi dari data uji P10 (13 §11, 16 §6) |
| NFR-11 | TC-PERF-020, -022, TC-RTC-005 |
| NFR-12 | TC-EXP-010, -012 |
