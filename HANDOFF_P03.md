### Handoff P03 → P04 / P05

- **Status fase:** READY FOR REVIEW (otomatis lulus; uji perangkat nyata & TURN belum).
- **DEC-073 (TURN):** tetap OPEN.
  - Implementasi provider-neutral: `GET /api/rooms/{code}/turn-credentials` dengan kredensial HMAC sementara (skema REST `use-auth-secret`, TTL 1 jam).
  - Diaktifkan dengan `TURN_URLS` + `TURN_SHARED_SECRET`. Tanpa itu: STUN saja (`turn: false`).
  - Tidak ada TURN yang dikonfigurasi atau dibeli.
  - Path endpoint menyimpang dari 14 §4 (`/api/turn-credentials`) karena cookie kredensial bersifat per room.
- **DEC-076:** tetap OPEN. Video-only:
  - `audio: false` di semua constraint, tidak ada jalur kode mikrofon;
  - `Permissions-Policy: microphone=()`;
  - `MediaTransport.publishLocal(track)` generik sebagai titik ekstensi.
- **Pekerjaan selesai:**
  - Modul kamera dengan pemetaan error 09 §1.1, fallback 1080→720→480p, dan preferensi `lr:camDeviceId`.
  - SCR-04 Cek kamera, termasuk pemulihan `denied` per platform.
  - Masuk tanpa kamera (DEC-068).
  - Kartu kamera live dengan state live/connecting/permission/off/none/in_use/failed/reconnecting/empty, tag LIVE, ring.
  - Kameraku (SCR-12): device / ganti depan-belakang, cermin, zoom/geser/kecerahan/kehangatan, reset.
  - `cameraPresentation` & `mirrored` hanya bisa ditulis pemilik: server menolak `FORBIDDEN_NOT_OWNER`.
  - Full-mesh WebRTC dengan perfect negotiation (`pc`/`rpc` membedakan PC lama vs baru), ICE restart setelah `disconnected` 3 s, rebuild ≤ 3× saat `failed`, kartu "Gak bisa nyambung … · Coba lagi".
  - `replaceTrack` untuk ganti kamera / on-off tanpa renegosiasi.
  - Encoding ≤ 640×480 @ 500 kbps; adaptasi ke 320×240 lalu 12 fps dari `availableOutgoingBitrate`, dengan badge "Kualitas diturunkan" hanya untuk pemilik.
  - Lifecycle `visibilitychange`, dan pemulihan otomatis kamera setelah reload bila izin sudah granted.
- **Migrasi:** `db/migrations/0002_p03_camera.sql` (kolom `mirrored`, `camera_presentation`) diterapkan di Neon `development`.
- **Bug yang ditemukan & diperbaiki saat verifikasi:**
  1. Pemrosesan sinyal paralel membuang kandidat ICE → diganti antrean serial.
  2. Server membuang field `rpc`.
  3. Rebuild dari offer memakai ulang PC yang sudah ditutup.
  4. Sinyal pertama ditolak karena status `CONNECTED` belum selesai di-commit → relay kini mensyaratkan socket terautentikasi.
- **Tes:**

| Tes | Hasil |
|---|---|
| Unit web | 21 |
| Unit realtime | 39 |
| Unit shared | 7 |
| Integrasi (relay rtc intra-room, `from` dari server, lintas-room ditolak, TURN 401/STUN/HMAC) | 14/14 |
| E2E Playwright Chrome dengan **kamera palsu Chromium**: TC-RTC-001 (4 konteks, 3 feed remote), TC-CAM-007 (tanpa audio), on/off, Kameraku lintas klien, kontrol hanya di kartu sendiri, reload + renegosiasi, ICE restart + rebuild terkontrol, TC-CAM-002 denied + masuk tanpa kamera | 4/4 (2× berturut-turut) |

- **BELUM / NOT VERIFIED:**
  - Perangkat nyata iOS/Android (TC-CAM-001..006, TC-RTC-005 fps 15 menit).
  - NAT ketat / UDP diblokir / relay TURN (TC-RTC-002/003).
  - `rtc_relay_ratio` nyata.
  - Safari/Firefox.
  - ICE `failed` alami (hanya disimulasikan lewat kait dev).
- **Masalah diketahui:** filter kehangatan adalah aproksimasi CSS (sama dengan yang dipakai `ctx.filter` nanti). Video lokal 1920 px diskalakan saat kirim.
- **Kesiapan P04/P05:** YA (fondasi media stabil di uji otomatis).
