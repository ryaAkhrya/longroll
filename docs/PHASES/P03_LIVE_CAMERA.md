# P03 — Live Camera & WebRTC

| Atribut | Nilai |
|---|---|
| Dokumen | `PHASES/P03_LIVE_CAMERA.md` |
| Versi | 1.1.0 |
| Status fase | NOT STARTED |
| Bergantung pada | P02 (DONE) |
| Dokumen wajib dibaca | [09_CAMERA_CAPTURE_RETAKE.md](../09_CAMERA_CAPTURE_RETAKE.md) §1–§6, [13_SYSTEM_ARCHITECTURE.md](../13_SYSTEM_ARCHITECTURE.md) §4–§5, [15_SECURITY_PRIVACY_LIFECYCLE.md](../15_SECURITY_PRIVACY_LIFECYCLE.md) §5, [06_RESPONSIVE_MOBILE_UX.md](../06_RESPONSIVE_MOBILE_UX.md) §9, [04_SCREEN_SPECIFICATIONS.md](../04_SCREEN_SPECIFICATIONS.md) SCR-04, SCR-05, SCR-08, SCR-12, SCR-20 |

> **Gerbang sebelum mulai (v1.1):**
> 1. **DEC-073 (penyedia TURN)** dipilih di awal fase. Kredensial TURN produksi tidak boleh di-hardcode.
> 2. **DEC-076 (voice chat) tetap OPEN QUESTION dan tidak memblokir P03.** P03 dibangun **video-only**: `audio: false`, tidak ada prompt mikrofon, `Permissions-Policy: microphone=()`. Mikrofon **tidak** masuk scope. Antarmuka `MediaTransport` dirancang agar track audio bisa ditambahkan nanti tanpa mengubah kontrak signaling (titik ekstensi saja, tanpa implementasi). Jika pemilik produk kelak menyetujui voice chat, itu menjadi perubahan scope baru dengan rencana tersendiri (izin, bandwidth, UI mute).

## 1. Identitas & tujuan fase

P03 menghadirkan kamera live yang **nyata**: izin kamera, pemilihan device, preview lokal, ganti depan/belakang, cermin, framing pra-capture lokal, dan streaming video 4 arah via WebRTC full mesh (DEC-034) dengan STUN/TURN. Juga state error kamera dan pemulihan media dasar. Setelah P03, feed kamera tidak boleh lagi berupa placeholder.

Bersama P02, P03 menyelesaikan milestone **M1 — Room hidup**: 4 perangkat nyata saling melihat feed live selama 15 menit.

## 2. Prasyarat & dependensi

| Prasyarat | Catatan |
|---|---|
| P02 DONE | Room, token, WS gateway, presence, resume |
| DEC-076 | OPEN, tidak memblokir. Default video-only (lihat gerbang di atas) |
| DEC-073 dipilih | TURN terkelola atau coturn; secret di env (`TURN_SHARED_SECRET`) |
| DEC-034, DEC-072, DEC-049, DEC-064, DEC-068, DEC-077 | RECOMMENDED/PROPOSED; implementasikan sebagai default terpusat |
| Perangkat uji | ≥ 1 iPhone (iOS 17+), ≥ 1 Android, 2 desktop (06 §15, 17 §5) |
| HTTPS di dev/staging | `getUserMedia` butuh konteks aman |

## 3. Kondisi awal yang diharapkan

- Lobby SCR-05 menampilkan peserta dengan state "Kamera belum aktif".
- Alur create/join langsung ke lobby (SCR-04 dilewati sementara di P02).
- Tidak ada kode media, signaling, atau endpoint TURN.

## 4. Requirement dalam scope

- SCR-04 Cek kamera (DEC-077) dengan semua state izin (09 §1.1).
- Preview lokal, enumerasi & pilih device, `facingMode` mobile, `replaceTrack` (09 §2).
- Cermin preview + flag `mirrored` di presence (09 §3).
- Panel Kameraku SCR-12 (lokal, "Cuma kamu"): device, ganti, cermin, reset, zoom/geser/kecerahan/kehangatan sebagai transform tampilan (09 §4, §4.1); `cameraPresentation` disinkron, hanya pemilik yang boleh menulis.
- Masuk tanpa kamera (DEC-068).
- WebRTC mesh, signaling `rtc.*`, perfect negotiation, STUN + TURN dengan kredensial sementara (09 §5; 13 §5).
- Batas encoding preview & adaptasi bandwidth (DEC-072).
- Pemulihan media 09 §5.2 dan background/foreground mobile.
- Kartu kamera live di lobby (SCR-05) dan studio SCR-08 dalam tata letak grid default (tanpa frame/layout engine).
- SCR-20 varian (a) peer putus dan (c) kamera sendiri off.
- Kontrol keamanan P03 (15 §14).

## 5. Di luar scope (eksplisit)

- Audio/voice chat dan izin mikrofon (DEC-076 OPEN; hanya titik ekstensi `MediaTransport`, tanpa implementasi).
- Capture foto, upload attempt, countdown (P06).
- Frame, layout, binding slot, renderer Konva (P05).
- Voting & sesi (P04).
- SFU (hanya disiapkan antarmuka `MediaTransport`; implementasi SFU di luar scope kecuali uji TC-RTC-005 gagal → **usulkan sebagai DEC baru di 18** dan minta persetujuan).
- `ImageCapture`/foto resolusi tinggi (P06).

## 6. ID requirement terkait

REQ-CAM-01..08, REQ-CAM-11..13 (REQ-CAM-09 framing lokal dasar; penempatan di slot REQ-CAM-10 di P05), REQ-MOB-03, REQ-MOB-08, REQ-MOB-12 (bagian kamera), NFR-03, NFR-06, NFR-11. Keputusan: DEC-034, DEC-049, DEC-050, DEC-064, DEC-068, DEC-072, DEC-073, DEC-076, DEC-077.

## 7. Referensi dokumentasi

- [09_CAMERA_CAPTURE_RETAKE.md](../09_CAMERA_CAPTURE_RETAKE.md) §1–§6 — sumber utama.
- [13_SYSTEM_ARCHITECTURE.md](../13_SYSTEM_ARCHITECTURE.md) §4–§5, §12 (metrik `rtc_*`).
- [14_DATA_MODEL_AND_EVENTS.md](../14_DATA_MODEL_AND_EVENTS.md) §3 (`CameraState`, `CameraPresentation`), §4 (`/api/turn-credentials`), §5.3.
- [06_RESPONSIVE_MOBILE_UX.md](../06_RESPONSIVE_MOBILE_UX.md) §7, §9.
- [03_USER_FLOWS.md](../03_USER_FLOWS.md) F-05, F-06, F-17.

## 8. Referensi visual yang disetujui

| Layar | Referensi |
|---|---|
| SCR-05 Lobby dengan feed live | `02_Desktop/02_Lobby.webp`, `03_Mobile/02_Lobby.webp` |
| SCR-08 Studio (grid feed, tanpa frame engine) | `02_Desktop/04_Live_Photobooth.webp`, `03_Mobile/04_Live_Photobooth.webp` |
| Kartu kamera & state | `01_Design_System/Brand_Identity.webp`, 05 §10 |
| SCR-04, SCR-12, SCR-20 | DERIVED — wajib review visual |

## 9. Tugas implementasi fungsional

1. **SCR-04**: penjelasan izin sebelum `getUserMedia`, tombol **Nyalain kamera**, preview dengan oval panduan, daftar status (izin, device, cermin), slider kecerahan/zoom, **Masuk ke lobby**, **Masuk tanpa kamera**. Langkah pemulihan `denied` per platform (desktop / iOS / Android).
2. **Lobby & studio**: kartu kamera live untuk semua peserta; kartu sendiri dengan ring warna & tag `LIVE`; state `connecting`, `camera_off`, `permission`, `reconnecting`, `empty`.
3. **Kameraku (SCR-12)**: perubahan framing langsung terlihat di feed sendiri dan di klien lain (via `cameraPresentation`); tombol **Reset**.
4. **Ganti kamera** di mobile tanpa memutus peer (TC-CAM-004).
5. **Kamera off/on**: tombol di kartu sendiri; presence `camera` berubah; **Nyalain lagi** memakai gesture baru.
6. **Peer gagal**: kartu "Gak bisa nyambung ke kamera Raka" + **Coba lagi** (restart ICE/PC).
7. **Badge kualitas** "Kualitas diturunkan" hanya untuk pemilik saat adaptasi bandwidth aktif.

## 10. Tugas implementasi teknis

| Tugas | Detail (PROPOSED) |
|---|---|
| Modul kamera | `apps/web/src/media/camera.ts`: `getUserMedia` dengan constraint 09 §1 (audio: false), fallback resolusi, pemetaan error 09 §1.1, `enumerateDevices`, preferensi `lr:camDeviceId` |
| MediaTransport | `apps/web/src/media/transport.ts` antarmuka `publishLocal`, `onRemoteTrack`, `setQuality` (13 §4); implementasi `MeshTransport`. `publishLocal` menerima `MediaStreamTrack` generik (bukan khusus video) sebagai titik ekstensi DEC-076; P03 hanya mem-publish track video |
| Peer manager | Satu `RTCPeerConnection` per peer; peserta dengan `participantId` lebih kecil membuat offer; perfect negotiation; `restartIce` setelah 3 s `disconnected`; rebuild PC saat `failed` (maks. 3×) |
| Signaling server | Relay `rtc.offer/answer/ice/restart` hanya ke `to` di room yang sama; validasi `from` = pengirim; SDP/kandidat tidak dilog |
| TURN | `GET /api/turn-credentials` (butuh token): HMAC `username = expiry:participantId`, TTL 1 jam; UDP + TCP + TLS/443 |
| Encoding | `RTCRtpSender.setParameters`: ≤ 640×480, `maxBitrate` ≈ 500 kbps, `degradationPreference: 'maintain-framerate'`; turun ke 320×240 lalu 12 fps berdasarkan `getStats` tiap 2 s |
| Framing | Transform CSS/WebGL ringan di elemen video berdasarkan `CameraPresentation`; zoom optik `applyConstraints({zoom})` hanya jika didukung & dipilih pengguna |
| Lifecycle mobile | `visibilitychange` → presence `camera: off`; saat terlihat cek `track.readyState`, restart bila `ended` |
| Video element | `playsInline muted autoPlay`; video di DOM (09 §6) |
| Metrik | `rtc_connect_ms`, `rtc_relay_ratio`, `rtc_failed_total` (13 §12) |

## 11. Dependensi data model & event

- `Participant.camera`, `Participant.mirrored`, `Participant.cameraPresentation` (14 §3); penulisan hanya oleh pemilik (`FORBIDDEN_NOT_OWNER`).
- `presence.set` untuk camera/mirrored/cameraPresentation/ready (14 §5.2).
- `rtc.offer`, `rtc.answer`, `rtc.ice`, `rtc.restart` (14 §5.3).
- `GET /api/turn-credentials` (14 §4).

## 12. Requirement UI/UX

- Tag `Cuma kamu` di Kameraku; keterangan "Pengaturan ini cuma ngubah kamera kamu…" (04 SCR-12).
- Label nama di glass pill kiri-bawah; `LIVE` hanya pada kartu sendiri di lobby (04 SCR-05).
- Skeleton kartu maks. 15 s sebelum state error.
- Copy persetujuan sebelum izin kamera mengikuti 15 §11 (kamera untuk feed live ke peserta room).
- Tidak ada indikasi bahwa peserta lain bisa mengontrol kamera.

## 13. Pertimbangan desktop & mobile

- Desktop: dropdown device. Mobile: tombol **Ganti kamera** (`facingMode`).
- Booth mobile SCR-08: feed edge-to-edge 2×2 (gap 3 px), overlay atas glass, dock bawah; tata letak 1/2/3 peserta mengikuti 06 §7.
- iOS: tidak ada `ImageCapture`; label device muncul setelah izin; video wajib `playsInline`.
- Background/foreground dan kamera dipakai app lain diuji di perangkat nyata.
- Orientasi berubah: sesuaikan rasio track bila berubah (06 §9).

## 14. Pertimbangan keamanan & privasi

- Tidak ada event yang memicu `getUserMedia`, ganti device, atau on/off di klien lain (REQ-CAM-13, TC-SEC-012).
- Mikrofon tidak diminta; `Permissions-Policy` tetap `microphone=()` (DEC-076 default).
- Kredensial TURN sementara, hanya untuk pemegang token; blokir relay ke IP privat/loopback/metadata (15 §5.3, TC-SEC-019 di P09 sebagai verifikasi lanjut).
- Signaling hanya intra-room; tidak ada log SDP/kandidat (NFR-09).
- DTLS-SRTP default WebRTC; jangan klaim "end-to-end encrypted" (15 §5.2, §11).

## 15. Checklist tugas detail

- [ ] Pilihan DEC-073 dicatat di handoff; status DEC-076 (masih OPEN / dijawab) dicatat tanpa mengubah scope.
- [ ] TC-CAM-007: tidak ada permintaan mikrofon.
- [ ] Modul kamera + pemetaan error + fallback resolusi.
- [ ] SCR-04 lengkap + aktifkan kembali langkah SCR-04 di alur create/join.
- [ ] Enumerasi & pilih device (desktop), `facingMode` (mobile), `replaceTrack`.
- [ ] Cermin + flag presence.
- [ ] SCR-12 Kameraku + `cameraPresentation` owner-only (server validasi).
- [ ] Endpoint TURN credentials.
- [ ] Peer manager mesh + perfect negotiation + restart/rebuild.
- [ ] Encoding & adaptasi bandwidth + badge kualitas.
- [ ] Lifecycle visibility mobile.
- [ ] Kartu kamera semua state di lobby & studio grid default.
- [ ] SCR-20 (a) & (c).
- [ ] Masuk tanpa kamera (DEC-068).
- [ ] Metrik `rtc_*`.
- [ ] Tes (§20) + handoff (§24).

## 16. Checkpoint integrasi

**IC-2**: room ↔ signaling ↔ TURN; kamera di 4 perangkat (kombinasi K2 dari 17 §5) + uji K4 (UDP diblokir → TURN TCP/TLS). Pastikan resume P02 tetap bekerja dan memicu renegosiasi WebRTC setelah `CONNECTED`.

## 17. Edge case

- Peserta tanpa kamera fisik (desktop tanpa webcam) → `unavailable` → masuk tanpa kamera.
- Izin ditolak lalu diubah di pengaturan → tombol coba lagi/muat ulang.
- Peserta join saat 3 peer sudah terhubung → 3 PC baru dibuat oleh pihak yang benar (tanpa glare).
- Dua peserta reconnect bersamaan → negosiasi ulang tidak deadlock (perfect negotiation).
- Device kamera dicabut (USB) saat live → `camera_off` + **Nyalain lagi**.
- Ganti kamera bersamaan dengan renegosiasi ICE.
- SY-10 (ganti kamera di tengah countdown) disiapkan agar track aktif selalu yang terbaru.

## 18. Skenario kegagalan

| Kegagalan | Perilaku |
|---|---|
| TURN tidak tersedia | Peer di belakang NAT ketat: kartu error + Coba lagi; room & presence tetap jalan |
| `NotReadableError` | State `in_use` + instruksi tutup aplikasi lain |
| ICE `failed` 3× | Kartu "Gak bisa nyambung…" permanen sampai Coba lagi |
| Uplink HP lemah | Adaptasi ke 320×240/12 fps; jika tetap gagal → catat sebagai temuan RK-01 |
| Tab mobile lama di background | Track `ended` → restart saat kembali |

## 19. Acceptance criteria

| # | Kriteria | Test |
|---|---|---|
| AC-1 | Preview ≤ 2 s setelah izin | TC-CAM-001 |
| AC-2 | State `denied` & `in_use` lengkap dengan pemulihan | TC-CAM-002, TC-CAM-003 |
| AC-3 | Ganti depan/belakang tanpa putus peer | TC-CAM-004 |
| AC-4 | Cermin konsisten | TC-CAM-005 |
| AC-5 | Background/foreground mobile pulih | TC-CAM-006 |
| AC-6 | 4 konteks media palsu: 3 track remote ≤ 5 s | TC-RTC-001 |
| AC-7 | Kombinasi K2 & K4 tersambung | TC-RTC-002, TC-RTC-003 |
| AC-8 | Pemulihan ICE | TC-RTC-004 |
| AC-9 | 4 peserta, 2 HP menengah, 15 menit, ≥ 24 fps | TC-RTC-005, TC-PERF-020 |
| AC-10 | Tidak bisa mengontrol kamera peserta lain | TC-SEC-012 |
| AC-11 | Tidak ada placeholder feed permanen | Review kode + demo M1 |
| AC-12 | Video-only: mikrofon tidak pernah diminta (DEC-076 default) | TC-CAM-007 |

## 20. Checklist pengujian

- [ ] Unit: pemetaan error, pemilihan role offer, logika adaptasi bitrate.
- [ ] E2E Playwright 4 konteks dengan `--use-fake-device-for-media-stream`.
- [ ] Otomatis: TC-CAM-007.
- [ ] Perangkat nyata (D): TC-CAM-001..006, TC-RTC-002, TC-RTC-003, TC-RTC-005 — catat perangkat, OS, browser, jaringan.
- [ ] Simulasi ICE gagal (TC-RTC-004).
- [ ] TC-SEC-012 negatif.
- [ ] Demo M1: 4 perangkat, 15 menit, data room terhapus setelah grace.

Perintah yang disarankan (dijalankan pengguna atau atas izin eksplisit): `pnpm test`, `pnpm test:e2e`. Agen tidak menjalankan typecheck/lint/build penuh atau Git tanpa instruksi, tidak commit/push/deploy otomatis, dan tidak mengarang hasil tes, terutama tes perangkat nyata.

## 21. Definition of Done

- Pilihan DEC-073 terdokumentasi; status DEC-076 tercatat (tidak memblokir).
- Checklist §15 lengkap dengan bukti.
- AC-1..AC-12 terverifikasi; tes D tercatat lengkap (siapa, kapan, perangkat).
- Feed kamera nyata di lobby & grid booth SCR-08; tidak ada mock media di jalur produksi.
- Handoff §24 disetujui → M1 tercapai bersama P02.

## 22. Deliverable

- Modul kamera, `MediaTransport` + `MeshTransport`, peer manager.
- Endpoint TURN credentials + konfigurasi TURN.
- SCR-04, SCR-12, SCR-20 (a/c), kartu kamera live di SCR-05 & SCR-08.
- Metrik `rtc_*`, tes E2E media palsu, laporan uji perangkat nyata.

## 23. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| RK-01 upload mesh berat di HP | Batas bitrate, adaptasi, ukur di TC-RTC-005; jika gagal → usulkan SFU sebagai DEC baru di 18 |
| RK-05 biaya TURN | Ukur `rtc_relay_ratio` sejak staging |
| RK-10 perbedaan kamera antar browser | Matriks perangkat sejak awal fase |
| Pemilik produk kelak menyetujui voice chat (DEC-076) | Jangan ditambahkan diam-diam di P03; catat sebagai perubahan scope baru, pakai titik ekstensi `MediaTransport`, rencanakan izin/bandwidth/UI mute terpisah |

## 24. Handoff ke fase berikutnya

```markdown
### Handoff P03 → P04 / P05
- Status fase: READY FOR REVIEW / DONE
- Pilihan DEC-073: …   Status DEC-076 (OPEN/dijawab): …
- Pekerjaan selesai: …
- Komponen/file yang diubah atau dibuat: …
- Keputusan teknis + status DEC (DEC-034, DEC-072, DEC-064 …): …
- Tes yang dijalankan (ID, tanggal, perangkat/OS/browser/jaringan, hasil + bukti): …
- Tes yang BELUM dijalankan dan alasannya: …
- Hasil ukur: rtc_connect_ms p75 …, rtc_relay_ratio …, fps HP …
- Masalah yang diketahui (per browser/perangkat): …
- Risiko yang masih terbuka: …
- Kesiapan untuk P04/P05 (ya/tidak + syarat): …
```
