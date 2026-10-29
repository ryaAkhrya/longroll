# Diagnostik koneksi video (WebRTC)

Dipakai bila video peserta lain terus "Menyambungkan…" atau "Gak bisa nyambung". Aman dibagikan: laporan hanya berisi jumlah/jenis
kandidat, state, penghitung sinyal, dan statistik ringkas. **Tidak ada** SDP, alamat IP, kredensial TURN, token, kode room, atau nama.

## Mengumpulkan dari dua browser
1. Di **kedua** perangkat, buka link room dengan tambahan `?rtcdebug=1` (mis. `https://www.ldroll.web.id/r/ABC123?rtcdebug=1`).
   Saklar tersimpan di browser itu; `?rtcdebug=0` mematikannya.
2. Masuk room, nyalakan kamera, tunggu ±20 detik sampai kartu kamera lawan tersambung atau gagal.
3. Tekan tombol **Diagnostik** (pojok kiri bawah) → **Salin laporan** → tempel ke chat/catatan. Lakukan di kedua perangkat.
4. (Opsional, uji TURN) centang **Paksa relay** di kedua perangkat: ICE hanya memakai relay. Tersambung = TURN berfungsi.

## Membaca laporan
`peers[].verdict.code` adalah hipotesis otomatis (bukan bukti mutlak):
| Kode | Arti | Tindakan |
|---|---|---|
| `ok-direct` / `ok-relay` | Tersambung langsung / lewat TURN | — |
| `nat-traversal-failed` | Kandidat ada di kedua sisi tetapi jalur langsung gagal (NAT simetris/CGNAT/firewall) | **Butuh TURN** |
| `stun-blocked` | Hanya kandidat host; UDP ke STUN diblokir | Butuh TURN dengan TLS/443 |
| `relay-unavailable` | Mode paksa-relay aktif tetapi tak ada kandidat relay | TURN belum ada/salah konfigurasi |
| `no-answer` | Offer terkirim, tak ada jawaban | Sinyal tak sampai (lawan offline/belum siap) |
| `no-remote-candidates` | Tak ada kandidat dari lawan | Sinyal ICE lawan tak sampai |
| `no-local-candidates` | Tak ada kandidat lokal | WebRTC diblokir (ekstensi/VPN/kebijakan) |
| `no-media` | ICE tersambung, tak ada byte video | Kamera pengirim/track |
| `track-not-playing` | Track diterima, video tak diputar | Autoplay/format, bukan jaringan |
| `ice-failed-with-relay` | Gagal walau ada relay | Cek port/kredensial TURN |

Bandingkan kedua laporan: `local` suatu sisi harus muncul sebagai `remote` di sisi lain (jumlah mendekati). `signals.*In` = 0 di salah
satu sisi berarti sinyal di jalur itu tidak sampai. `ice.source` = `fallback-stun` berarti daftar ICE dari server gagal diambil.
Log server (tanpa isi pesan): `journalctl -u longroll-realtime | grep rtc.dropped`.

## Batasan
Hasil ini tidak menggantikan uji di perangkat dan jaringan nyata (operator seluler, Wi‑Fi kantor, Safari iOS).
