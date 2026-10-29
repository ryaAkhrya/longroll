# TURN / relay WebRTC (DEC-073 OPEN — pemilihan penyedia butuh persetujuan pemilik)

Status: **kode siap, TURN nyata belum dikonfigurasi, TC-SEC-019 NOT VERIFIED.** Tanpa TURN, peserta yang jaringannya tidak bisa
membuat jalur langsung (NAT simetris/CGNAT operator seluler, UDP diblokir, Wi‑Fi kantor/kampus) **tidak akan pernah** tersambung.
STUN hanya membantu NAT yang "ramah".

## Tiga cara konfigurasi (semua lewat env di server realtime; tidak ada kredensial di repo)
| Cara | Env | Kapan |
|---|---|---|
| REST penyedia terkelola (disarankan) | `TURN_CREDENTIALS_URL` (https, berisi kunci API) | Penyedia punya endpoint yang mengembalikan daftar ICE sementara (mis. Metered). Server memanggilnya, men-cache 10 menit, dan meneruskan hanya URL+kredensial sementara ke peserta sah. Kunci API tidak pernah sampai ke klien. |
| Kredensial statis | `TURN_URLS` + `TURN_USERNAME` + `TURN_CREDENTIAL` | Penyedia memberi satu akun tetap. Diteruskan apa adanya ke peserta sah (terlihat di DevTools mereka): pakai akun khusus dengan kuota rendah. |
| Secret bersama (coturn) | `TURN_URLS` + `TURN_SHARED_SECRET` | coturn sendiri (`turnserver.conf`): kredensial HMAC per peserta, TTL `TURN_TTL_SECONDS`. |

`TURN_URLS` contoh: `turn:host:80,turn:host:443?transport=tcp,turns:host:443?transport=tcp` — **sertakan `turns:`/TCP di 443**,
satu-satunya jalur yang lolos di banyak jaringan yang memblokir UDP. Guard produksi (`deployCheck.ts`) menolak konfigurasi tak lengkap
dan memberi peringatan bila tidak ada transport TCP/TLS.

## Evaluasi penyedia (dicek 2026-10-29 dari dokumen resmi; angka bisa berubah — verifikasi di dasbor sebelum memilih)
| Opsi | Biaya | Port/TLS | Catatan |
|---|---|---|---|
| **Metered Open Relay** | 20 GB/bulan gratis (halaman Open Relay). Halaman harga Metered menulis paket Free **500 MB** — **tidak konsisten, cek di dasbor** | 80, 443; TURNS (TLS) didukung | Butuh akun + API key; kredensial lewat REST (cocok dengan `TURN_CREDENTIALS_URL`). Kartu kredit untuk paket gratis: halaman harga menyebut "tidak perlu". Izin pemakaian produksi pada paket gratis **belum diverifikasi** (baca ToS). |
| Cloudflare Realtime TURN | **$0,05/GB** keluar; gratis hanya bila dipakai bersama Realtime SFU; tidak ada kuota gratis yang tertulis | UDP 3478/443, TCP 3478/80, **TLS 5349/443** | Berbayar → perlu persetujuan. Kredensial lewat POST (belum didukung `TURN_CREDENTIALS_URL`; perlu adapter kecil). |
| coturn di VPS ECER | gratis | — | **Tidak realistis**: IPv4 bersama dengan port-forward TCP rentang 10020–10039 saja. Relay TURN butuh rentang port UDP publik yang bisa dijangkau peer; ini tidak tersedia/ tidak terverifikasi. UDP *keluar* dari VPS berfungsi (diuji), UDP *masuk* tidak ada. RAM 1 GB / 1 vCPU juga tipis. |
| Twilio NTS / Xirsys / ExpressTURN | tidak dievaluasi | — | Belum diperiksa. |

**Rekomendasi:** coba Metered Open Relay (gratis, TLS 443) untuk validasi 3 hari; putuskan DEC-073 setelah mengukur rasio relay dan
kuota nyata. Tidak ada layanan berbayar diaktifkan oleh saya.

## Perkiraan bandwidth relay
Kirim video maksimal 500 kbps per arah per pasangan (`media/quality.ts`; turun otomatis bila jaringan lemah). Satu pasangan yang
**di-relay** ≈ 0,9 GB/jam (ingress+egress, kedua arah). Mesh 4 orang: peserta jauh yang harus di-relay ke 3 lainnya ≈ **2,7 GB/jam**
terburuk. Kuota 20 GB ≈ 7 jam sesi 4 orang terburuk; jauh lebih lama bila hanya 1–2 pasangan yang butuh relay. Hanya pasangan yang gagal
jalur langsung memakai relay (ICE memilih jalur langsung bila ada).

## Mengaktifkan di VPS (pemilik mengisi rahasianya sendiri)
1. Buat akun penyedia, salin URL kredensial/API key **langsung ke server** (jangan lewat chat):
   `nano /etc/longroll/realtime.env` → tambahkan `TURN_CREDENTIALS_URL=https://…` (atau pasangan statis) → `systemctl restart longroll-realtime`.
2. Cek tanpa melihat rahasia: `curl` endpoint `/api/rooms/<kode>/turn-credentials` dengan cookie peserta → `"turn":true`.
3. **Uji TURN sungguhan** dari browser: buka room dengan `?rtcdebug=1` di dua perangkat, centang **"Paksa relay (uji TURN)"** → video harus
   tetap tersambung dan diagnosis menyebut "Tersambung lewat relay". Bila gagal: diagnosis `relay-unavailable` = TURN tak terjangkau/kredensial salah.
4. Deny-list peer privat (anti-SSRF) wajib di sisi penyedia/`turnserver.conf` (loopback, 10.x, 169.254.169.254, dst).
