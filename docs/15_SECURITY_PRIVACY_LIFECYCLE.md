# 15 — Security, Privacy & Lifecycle

| Atribut | Nilai |
|---|---|
| Versi | 1.1.0 |
| Requirement | REQ-ROOM-13, REQ-LIFE-03..06, REQ-CAM-13, REQ-CAP-10, NFR-07..09 |
| Fase | **Setiap fase** menerapkan kontrol yang relevan (§14). P09 = hardening & verifikasi menyeluruh. |

> Prinsip: **jangan pernah menjanjikan privasi lebih kuat dari yang benar-benar diberikan arsitektur.** LONGROLL tidak end-to-end encrypted untuk foto yang diunggah, dan foto memang disimpan sementara di server.

## 1. Aset & batas kepercayaan

| Aset | Sensitivitas | Lokasi |
|---|---|---|
| Video live peserta | Tinggi (wajah, ruangan) | P2P/TURN, tidak disimpan |
| Foto attempt (accepted/rejected) | Tinggi | Object storage sementara |
| Display name | Sedang | Redis (state room) |
| Token peserta | Tinggi (kunci akses room) | Browser (cookie HttpOnly, DEC-082) + hash di server |
| Frame upload | Sedang (bisa berisi konten pengguna) | Object storage sementara |
| Token Google | Tinggi | Memori tab saja |

Batas kepercayaan: browser peserta ↔ realtime service ↔ Redis/storage; browser ↔ peer lain (WebRTC); browser ↔ Google.

## 2. Otorisasi room anonim

| Kontrol | Spesifikasi |
|---|---|
| Token | 32 byte CSPRNG, base64url. Hanya **hash SHA-256** yang disimpan di server. |
| Scope | Satu token = satu peserta di satu room. Tidak berlaku di room lain. |
| Pengiriman | Cookie `HttpOnly; Secure; SameSite=Strict` saat upgrade WebSocket & request API, dengan validasi `Origin`. Fallback: pesan WebSocket pertama atau header `Authorization`. **Tidak** di URL/query string. |
| Pencabutan | Saat `LEFT`, room `EXPIRING`, atau tab lain mengambil alih (07 §10). |
| Penyimpanan klien | Cookie HttpOnly (tidak terbaca JavaScript, DEC-082) + CSP ketat (§6). Hapus saat keluar/kedaluwarsa. Fallback `sessionStorage` (bukan `localStorage`). |
| Pembandingan | Constant-time compare untuk hash token. |
| Rotasi | PROPOSED: token baru diterbitkan saat resume setelah `RECONNECTING`, token lama dicabut (membatasi umur token yang bocor). |
| Setiap event | Diotorisasi berdasarkan (token valid) ∧ (peserta anggota room) ∧ (aturan kepemilikan bila relevan). Tidak ada peran host. |

## 3. Kode room & enumerasi

- Kode 6 karakter dari 32 simbol (≈1,07 × 10⁹ kombinasi), dibuat dengan CSPRNG (DEC-022).
- Kode **bukan** rahasia kuat: siapa pun yang tahu kode bisa join selama ada slot. Ini sesuai produk (link undangan), dan harus dijelaskan di FAQ/privasi: "Siapa pun yang punya link bisa masuk selama room belum penuh."
- Mitigasi enumerasi: rate limit kode salah (DEC-067), respons `preview` dengan waktu konstan, kode tidak dipakai ulang selama tombstone (24 jam), dan room berumur pendek.
- OPEN untuk masa depan (bukan scope sekarang): opsi "kunci room" saat sudah lengkap. Tidak diimplementasikan karena tidak ada di brief.

## 4. Kontrol akses & minimisasi data

| Endpoint/event | Yang boleh dilihat tanpa token | Dengan token |
|---|---|---|
| `preview` | Ada/tidak, status, jumlah peserta, **inisial** | — |
| Feed kamera | Tidak | Peserta room |
| Foto/galeri | Tidak | Peserta room via signed URL |
| Nama lengkap peserta | Tidak | Peserta room |

- Calon peserta di SCR-03 **tidak** melihat feed atau foto sebelum join.
- Signed URL hanya diterbitkan untuk key di bawah `rooms/{roomId}/` milik room token tersebut.

## 5. Media

### 5.1 Batas izin kamera browser

- Izin kamera dikelola browser per origin. LONGROLL tidak bisa dan **tidak boleh** mencoba mengaktifkan kamera orang lain (REQ-CAM-13). Tidak ada event jaringan yang memicu `getUserMedia`, ganti device, atau unmute di klien lain.
- Indikator kamera aktif dari browser/OS tetap tampil. UI juga menampilkan status "Kamera kamu nyala" di kartu sendiri.
- Mikrofon tidak diminta (DEC-076 default).

### 5.2 Transport

| Jalur | Proteksi |
|---|---|
| Web/API/WebSocket | TLS (HTTPS/WSS), HSTS |
| Video WebRTC | DTLS-SRTP (wajib di WebRTC). Saat lewat TURN, relay meneruskan paket terenkripsi SRTP. **Catatan:** ini bukan "end-to-end" dalam arti aplikasi, karena peer adalah browser lain di room yang memang berhak melihat. |
| Upload/unduh foto | HTTPS ke object storage dengan signed URL berumur pendek (PUT ≤ 5 menit, GET ≤ 10 menit) |
| At-rest | Enkripsi at-rest bawaan provider (DEC-075). Harus diverifikasi saat memilih provider; jangan diklaim sebelum diverifikasi. |

### 5.3 TURN

- Kredensial sementara (HMAC, TTL 1 jam) hanya untuk pemegang token room.
- Batasi relay ke rentang port & alamat publik (hindari TURN dipakai untuk mengakses jaringan internal: blokir relay ke IP privat/loopback/metadata cloud).

## 6. Keamanan web

| Kontrol | Spesifikasi |
|---|---|
| CSP | `default-src 'self'`; `script-src 'self' https://accounts.google.com/gsi/client` (+ hash/nonce untuk Next.js); `connect-src 'self' wss://<realtime> https://<storage> https://www.googleapis.com`; `img-src 'self' blob: data: https://<storage>`; `media-src 'self' blob:`; `frame-src https://accounts.google.com`; `object-src 'none'`; `base-uri 'none'`; `frame-ancestors 'none'`. |
| XSS | Semua teks pengguna (nama, teks editor, nama file frame) dirender sebagai teks. Tidak ada `dangerouslySetInnerHTML` untuk data pengguna. |
| CORS | API & storage hanya mengizinkan origin LONGROLL (`ALLOWED_ORIGINS`). |
| Header | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()`. |
| WebSocket | Cek header `Origin`; batas ukuran pesan (14 §8.2); batas jumlah koneksi per IP. |
| Dependensi | Lockfile, audit rutin, tanpa dependensi yang tidak perlu. |

## 7. Pembatasan upload

| Upload | Batas | Validasi server |
|---|---|---|
| Foto attempt | JPEG; ≤ 8 MB full, ≤ 400 KB preview; dimensi ≤ 4096 px | `HEAD` cek `Content-Length` & `Content-Type`; signed PUT terikat pada key, content-type, dan ukuran maksimal; magic bytes dicek secara sampling atau saat dipakai di galeri |
| Frame | DEC-041 | Magic bytes, decode aman, dimensi, re-encode, buang metadata, tolak SVG/animasi |
| Preview hasil | WebP ≤ 1 MB | `HEAD` + content-type |

Decoder gambar server dijalankan dengan batas memori/piksel (misal `limitInputPixels` di sharp) untuk mencegah decompression bomb.

## 8. Retensi, kedaluwarsa, cleanup

### 8.1 Jadwal retensi

| Data | Retensi |
|---|---|
| Attempt `REJECTED` | Sampai shot `DONE` (DEC-029) |
| Semua data room lain | Sampai room `EXPIRING` (grace habis, DEC-020). Umur maksimal room **tidak** berlaku kecuali DEC-052 disetujui. |
| Tombstone kode | 24 jam, hanya `{code, status: EXPIRED}` |
| Log operasional | Sesuai kebijakan log (misal 14 hari), tanpa PII (NFR-09) |
| Backstop storage | Lifecycle rule: objek `rooms/` > 24 jam dihapus otomatis (DEC-036) |

### 8.2 Prosedur cleanup room

```text
onRoomExpiring(roomId):
  1. tandai status EXPIRING (tolak join/resume/event baru), cabut semua token
  2. tutup semua WebSocket room dengan room.expired
  3. list objek prefix rooms/{roomId}/ → batch delete (maks 1000/request)
  4. hapus key Redis room:{roomId}:* (state, assets, docs, rate-limit spesifik room)
  5. tulis tombstone code:{CODE} = EXPIRED (TTL 24 jam)
  6. VERIFIKASI: list prefix lagi → harus 0 objek; EXISTS key Redis → harus 0
  7. jika verifikasi gagal → retry dengan backoff (1m, 5m, 15m, 1j); catat metric cleanup_failures_total
  8. sukses → status EXPIRED, metric cleanup_duration_ms
```

### 8.3 Pemulihan cleanup yang gagal

- Job cleanup idempoten dan aman diulang.
- Sweeper berkala (tiap 15 menit) mencari room `EXPIRING` lebih dari 30 menit dan room di Redis yang `emptySinceMs` + grace sudah lewat tapi belum `EXPIRING` (misal karena instance mati).
- Sweeper harian: membandingkan prefix `rooms/*` di storage dengan room yang masih ada → objek yatim dihapus dan dihitung (`storage_orphan_objects`).
- Lifecycle bucket 24 jam sebagai lapisan terakhir.

### 8.4 Verifikasi penghapusan (untuk QA & audit)

- TC-SEC-030: buat room → upload foto → semua keluar → tunggu grace → cek storage & Redis kosong untuk room itu.
- Laporan P09 mencantumkan bukti verifikasi.
- Copy "dihapus permanen" hanya boleh dipakai setelah §8.2 langkah 6 terbukti berjalan di produksi. Sebelum itu gunakan "dihapus".
- Batasan yang harus jujur: provider storage bisa menyimpan salinan internal/backup sesuai kebijakan mereka. LONGROLL tidak mengklaim penghapusan dari backup provider kecuali provider menjaminnya.

## 9. Pencegahan penyalahgunaan & rate limit

| Vektor | Kontrol |
|---|---|
| Spam pembuatan room | 10 room/jam/IP (DEC-067); kuota global per menit sebagai pengaman |
| Enumerasi kode | 20 percobaan kode salah/10 menit/IP lalu backoff |
| Flood WebSocket | 60 event/detik/koneksi; event volatile di-throttle di klien dan diabaikan jika melebihi |
| Upload berlebih | Kuota frame per room/peserta; ukuran signed PUT dibatasi |
| Room sebagai penyimpanan gratis | Safeguard batas sesi (DEC-053) & storage per room (DEC-085), TTL storage. Batas umur room hanya jika DEC-052 disetujui. |
| Konten tidak pantas di frame upload | Frame hanya terlihat oleh peserta room itu dan terhapus bersama room. Moderasi otomatis tidak di scope (catat sebagai risiko di P09). |
| Peserta mengganggu di room | Tidak ada fitur kick (tidak ada host). Mitigasi: peserta bisa keluar & bikin room baru; link baru tidak diketahui pengganggu. **OPEN** jika dibutuhkan mekanisme lain (catat di 18 saat P09). |

Rate limit berbasis IP disimpan sebagai hash IP (dengan salt yang dirotasi), bukan IP mentah.

## 10. Otorisasi Google

- Google Identity Services token model, scope `drive.file` saja (DEC-040).
- Token hanya di memori tab; tidak dikirim ke server LONGROLL.
- Popup dipicu gesture; origin terdaftar di Google Cloud Console.
- Tombol "Putuskan Google Drive" → revoke token.
- Kebijakan privasi menjelaskan: LONGROLL hanya membuat file di Drive pengguna saat diminta dan tidak membaca file lain.

## 11. Pesan privasi & persetujuan (copy)

| Boleh (akurat) | Dilarang (tidak akurat) |
|---|---|
| "Room sementara: foto dan datanya dihapus setelah room kedaluwarsa." | "Gak ada yang disimpan di server." (DEC-093) |
| "Galeri ini sementara. Unduh yang kamu suka sebelum room bubar." | "End-to-end encrypted." |
| "Siapa pun yang punya link bisa masuk selama room belum penuh." | "Room kamu privat sepenuhnya." |
| "File yang udah kamu unduh atau simpan ke Drive tetap aman." | "Semua jejak kamu hilang." |
| "Kamera cuma nyala setelah kamu izinkan." | "Kami gak pernah lihat fotomu." (server memproses file) |

Persetujuan: sebelum meminta izin kamera (SCR-04), tampilkan penjelasan singkat: kamera dipakai untuk feed live ke peserta room dan untuk foto yang disimpan sementara sampai room bubar. Tautan ke halaman privasi.

## 12. Batas storage

| Batas | Nilai (PROPOSED) |
|---|---|
| Per attempt | 8 MB full + 400 KB preview |
| Per room (perkiraan atas) | 20 sesi × 8 shot × 4 peserta × ~3 MB ≈ 1,9 GB (skenario ekstrem). Batas lunak: 1 GB per room; lewat dari itu `ROOM_STORAGE_LIMIT` dan pesan untuk mulai room baru. |
| Frame custom | 20 × 10 MB |

## 13. Skenario ancaman

| ID | Ancaman | Dampak | Mitigasi | Test |
|---|---|---|---|---|
| TH-01 | Orang asing menebak kode room | Melihat feed/foto | Ruang kode besar + rate limit + umur pendek + kapasitas 4 | TC-SEC-001 |
| TH-02 | Link room tersebar ke publik | Orang tak diundang join | Batas 4; peserta bisa pindah room; copy jujur soal link | — |
| TH-03 | Token dicuri via XSS | Penyamaran peserta | Cookie HttpOnly (token tidak terbaca JS), CSP ketat, tanpa HTML dari pengguna, token terikat room & dicabut saat keluar | TC-SEC-020, TC-SEC-022 |
| TH-04 | Peserta mencoba accept/retake foto orang lain | Merusak foto | Validasi `ownerId` di server | TC-SEC-014 |
| TH-05 | Peserta memicu kamera orang lain | Pelanggaran privasi | Tidak ada event yang bisa memicu; tes negatif | TC-SEC-012 |
| TH-06 | Upload SVG/HTML berbahaya sebagai frame | XSS / SSRF | Tolak SVG, re-encode raster, magic bytes | TC-SEC-016 |
| TH-07 | Decompression bomb | DoS server | Batas piksel decoder | TC-SEC-017 |
| TH-08 | Signed URL bocor | Akses foto | TTL pendek, bucket privat, URL tidak dicatat | TC-SEC-018 |
| TH-09 | TURN disalahgunakan sebagai proxy | Penyalahgunaan bandwidth / akses jaringan internal | Kredensial sementara, blokir relay ke IP privat | TC-SEC-019 |
| TH-10 | Cleanup gagal, data tertinggal | Retensi melebihi janji | Verifikasi + sweeper + lifecycle 24 jam + alarm | TC-SEC-030..032 |
| TH-11 | Flood event | DoS room | Rate limit per koneksi, batas ukuran pesan | TC-SEC-040 |
| TH-12 | Log membocorkan data | Privasi | Aturan log NFR-09, scrubbing | TC-SEC-041 |
| TH-13 | Cross-site WebSocket hijacking / CSRF memakai cookie | Aksi atas nama peserta | `SameSite=Strict`, validasi `Origin` di upgrade WS & API, tanpa endpoint GET yang mengubah state | TC-SEC-023 |

## 14. Kontrol keamanan per fase (bukan hanya P09)

| Fase | Kontrol yang wajib ada di fase itu |
|---|---|
| P01 | Header keamanan dasar, CSP awal, tanpa `dangerouslySetInnerHTML`, lint aturan keamanan |
| P02 | Token CSPRNG + hash, cookie HttpOnly + cek `Origin` (DEC-082), rate limit create/join, validasi nama, kapasitas atomik, cleanup room dasar |
| P03 | Kredensial TURN sementara, relay signaling hanya intra-room, tanpa kontrol kamera remote |
| P04 | Validasi state vote di server, tanpa override |
| P05 | Validasi upload frame + re-encode + kuota, signed URL |
| P06 | Kepemilikan accept/retake, signed PUT terbatas, penghapusan attempt `REJECTED` |
| P07 | Validasi skema update editor, batas ukuran dokumen |
| P08 | Scope Drive minimal, token Google hanya di memori, signed URL galeri |
| P09 | Audit menyeluruh, uji penetrasi ringan, verifikasi cleanup produksi, review log |
| P10 | Verifikasi ulang semua TC-SEC sebelum rilis |
