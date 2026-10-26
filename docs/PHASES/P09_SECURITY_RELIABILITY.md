# P09 — Security, Privacy & Reliability

| Atribut | Nilai |
|---|---|
| Dokumen | `PHASES/P09_SECURITY_RELIABILITY.md` |
| Versi | 1.1.0 |
| Status fase | NOT STARTED |
| Bergantung pada | P02–P08 (semua fitur sudah ada dan punya kontrol keamanan dasar) |
| Dokumen wajib dibaca | [15_SECURITY_PRIVACY_LIFECYCLE.md](../15_SECURITY_PRIVACY_LIFECYCLE.md), [13_SYSTEM_ARCHITECTURE.md](../13_SYSTEM_ARCHITECTURE.md) §9–§14, [17_QA_TEST_PLAN.md](../17_QA_TEST_PLAN.md) §6.10–§6.11, [14_DATA_MODEL_AND_EVENTS.md](../14_DATA_MODEL_AND_EVENTS.md) §8, §11, [18_DECISIONS_AND_OPEN_QUESTIONS.md](../18_DECISIONS_AND_OPEN_QUESTIONS.md) |

## 1. Identitas & tujuan fase

Hardening menyeluruh dan verifikasi keamanan, privasi, dan reliabilitas sebelum QA rilis.

> **P09 bukan fase pertama yang menyentuh keamanan.** Setiap fase sebelumnya wajib sudah menerapkan kontrol yang relevan (15 §14): token & rate limit di P02, TURN sementara di P03, validasi vote di P04, validasi upload frame di P05, kepemilikan accept/retake di P06, validasi skema editor di P07, scope Drive minimal di P08. P09 **mengaudit, melengkapi, dan membuktikan** kontrol-kontrol itu secara menyeluruh, lalu menambah lapisan reliabilitas (failover, sweeper, alarm, uji beban).

Milestone: bagian pertama **M4 — Siap rilis**.

## 2. Prasyarat & dependensi

| Prasyarat | Sumber |
|---|---|
| Alur F-01..F-19 berjalan end-to-end (IC-5 lulus) | P08 |
| Inventaris aset per room lengkap (attempt, frame, result preview, doc snapshot) | Handoff P08, 14 §11 |
| Lingkungan staging setara produksi (Redis AOF, bucket privat, TURN nyata) | 13 §10 |
| Daftar kontrol per fase dari handoff P02–P08 | Handoff tiap fase |
| Jawaban/keputusan sementara pemilik produk untuk DEC-056. DEC-052 (umur room) boleh tetap OPEN; default tanpa batas umur dipertahankan kecuali pemilik produk menyetujui kebijakan lain | 18 |

## 3. Kondisi awal yang diharapkan

- Fitur lengkap, tapi kontrol keamanan tersebar per fase dan belum diaudit bersama.
- Cleanup room dasar ada sejak P02, tapi verifikasi pasca-hapus, sweeper, dan alarm belum tentu lengkap.
- Restart instance realtime tunggal (DEC-088) belum diuji dengan beban nyata.

## 4. Requirement dalam scope

1. **Audit kontrol** 15 §14 untuk P01–P08: ada, benar, dan teruji.
2. **Otorisasi & token**: hash token, constant-time compare, pencabutan, scope room, auth pesan pertama WS (15 §2).
3. **Enumerasi & rate limit**: DEC-067 lengkap di semua endpoint & event; hash IP dengan salt yang dirotasi (15 §9).
4. **Keamanan web**: CSP final, header, CORS, cek Origin WS, batas ukuran pesan (15 §6).
5. **Upload**: batas piksel decoder, magic bytes, signed PUT terbatas, batas storage per room DEC-085 (15 §7, §12).
6. **Media**: kredensial TURN sementara, blokir relay ke IP privat/loopback/metadata (15 §5.3, TH-09).
7. **Lifecycle & cleanup**: prosedur 15 §8.2 lengkap dengan verifikasi, sweeper 15 menit, sweeper objek yatim harian, lifecycle bucket 24 jam, metrik & alarm.
8. **Reliabilitas**: restart instance tunggal + resume dari snapshot Redis (DEC-088), restart Redis, TURN down, storage gagal (13 §13, IC-6). Failover multi-instance (lease) **hanya** jika pemicu 13 §15.2 tercapai dan disetujui.
9. **Observability**: metrik 13 §12, alarm, scrubbing log & error klien (NFR-09).
10. **Performa & beban**: uji beban room tanpa media, verifikasi target NFR-01, NFR-02, NFR-11; tetapkan target N untuk TC-PERF-030.
11. **Audit copy privasi** terhadap 15 §11 di semua layar, FAQ, dan kebijakan privasi.
12. **Penyelesaian keputusan**: DEC-056 (analitik). Status DEC-052 (umur maks. room) dicatat apa adanya; agen tidak mengaktifkan batas umur tanpa persetujuan eksplisit. Status DEC-075 (enkripsi at-rest provider) diverifikasi.

## 5. Di luar scope (eksplisit)

- Fitur produk baru, termasuk tombol kick/kunci room (15 §3, §9 mencatat ini sebagai OPEN; jika dibutuhkan → usulkan sebagai DEC baru di 18).
- Moderasi konten otomatis.
- Migrasi ke SFU (hanya jika data P09/P10 menunjukkan kebutuhan; keputusan via DEC-034).
- Multi-region (DEC-098).
- Deploy produksi (P10, butuh persetujuan eksplisit pengguna).
- Klaim "end-to-end encrypted" atau "dihapus permanen dari semua backup" (15 §8.4, §11).

## 6. ID requirement terkait

REQ-ROOM-06, REQ-ROOM-13, REQ-LIFE-01..06, REQ-CAM-13, REQ-CAP-10, REQ-FRAME-13, REQ-EXP-05, NFR-01, NFR-02, NFR-06, NFR-07, NFR-08, NFR-09, NFR-10, NFR-11, DEC-020, DEC-036, DEC-041, DEC-052, DEC-056, DEC-067, DEC-073, DEC-075, DEC-082, DEC-085, DEC-088, TH-01..TH-13.

## 7. Referensi dokumentasi

- [15_SECURITY_PRIVACY_LIFECYCLE.md](../15_SECURITY_PRIVACY_LIFECYCLE.md) — seluruh dokumen.
- [13_SYSTEM_ARCHITECTURE.md](../13_SYSTEM_ARCHITECTURE.md) §7 (actor & recovery), §8 (storage), §11–§14.
- [07_ROOM_AND_MULTIPLAYER.md](../07_ROOM_AND_MULTIPLAYER.md) §10, §12 (reconnect, lifecycle).
- [17_QA_TEST_PLAN.md](../17_QA_TEST_PLAN.md) §6.10, §6.11, §9.
- [16_IMPLEMENTATION_ROADMAP.md](../16_IMPLEMENTATION_ROADMAP.md) §7 (RK-05, RK-06), §8 (IC-6).

## 8. Referensi visual yang disetujui

P09 tidak membuat layar baru. Perubahan UI terbatas pada copy dan state error/peringatan, yang harus konsisten dengan `01_Design_System/Brand_Identity.webp` dan layar terkait:

| Area | Referensi |
|---|---|
| Banner retensi galeri | `02_Desktop/08_Gallery.webp`, `03_Mobile/08_Gallery.webp` |
| Copy landing (catatan retensi) | `02_Desktop/01_Landing.webp`, `03_Mobile/01_Landing.webp` |
| SCR-21, peringatan umur room, `ROOM_STORAGE_LIMIT` | DERIVED (04 SCR-21, SCR-22); perubahan visual perlu review |

## 9. Tugas implementasi fungsional

1. **Default:** room yang masih punya peserta terhubung tidak pernah berakhir karena umur (TC-ROOM-026). Hanya jika pemilik produk menyetujui batas umur (DEC-052): peserta melihat peringatan 15 menit sebelum batas tercapai.
2. Upload baru setelah batas storage room ditolak dengan pesan untuk memulai room baru (DEC-085).
3. Rate limit menghasilkan pesan yang ramah dan konsisten di semua alur (create, join, kode salah, upload frame, nudge).
4. Setelah room kedaluwarsa, link selalu menampilkan SCR-21 dengan copy akurat ("dihapus"; kata "permanen" hanya setelah verifikasi 15 §8.4 di produksi).
5. Halaman FAQ/privasi menjelaskan: siapa pun yang punya link bisa masuk selama room belum penuh; foto disimpan sementara; file unduhan & Drive di luar kendali LONGROLL.

## 10. Tugas implementasi teknis

| Modul (PROPOSED) | Tugas |
|---|---|
| `apps/realtime/src/security/*` | Review token (hash, compare, revoke), auth WS, Origin check, batas pesan, rate limiter terpusat dengan hash IP + salt rotasi |
| `apps/realtime/src/cleanup/*` | Prosedur 15 §8.2 dengan langkah verifikasi; retry backoff 1m/5m/15m/1j; sweeper `EXPIRING` macet & room grace terlewat (tiap 15 menit); sweeper objek yatim harian; metrik `cleanup_duration_ms`, `cleanup_failures_total`, `storage_orphan_objects` |
| `apps/realtime/src/room/recovery.ts` | MVP: muat ulang actor dari snapshot Redis setelah restart; timer dihitung dari timestamp tersimpan; ukur waktu restart → resume |
| `apps/realtime/src/room/lease.ts` (kondisional) | Lease owner multi-instance (TTL 10 detik) **hanya** jika pemicu 13 §15.2 tercapai dan disetujui; jika tidak, tidak dibuat |
| `infra/storage/*` | Aturan lifecycle 24 jam pada prefix `rooms/`, bucket privat, CORS ketat |
| `infra/turn/*` | Konfigurasi deny relay ke rentang privat/loopback/link-local/metadata cloud; kredensial HMAC TTL 1 jam |
| `apps/web/next.config.*` / middleware | CSP final dengan nonce/hash, header 15 §6 |
| `apps/*/observability/*` | Metrik 13 §12, alarm (cleanup gagal, objek yatim > 0 setelah 24 jam, `rtc_failed` melonjak, `capture_skew_ms` p95 > 300), scrubbing log & error klien |
| `tools/load/*` | Skrip beban WS (room sintetis tanpa media) untuk TC-PERF-030 |
| `tools/security/*` | Skrip uji TC-SEC (enumerasi, flood, decompression bomb, SVG menyamar) |

## 11. Dependensi data model & event

| Kebutuhan | Kontrak |
|---|---|
| Status room & timer | `Room.status`, `emptySinceMs`, `expiresAtMs`, `room.expiring`, `room.expired` (14 §2, §5.2) |
| Indeks aset | `TempAsset`, set `room:{id}:assets` (14 §11) |
| Error | `RATE_LIMITED`, `AUTH_INVALID`, `ROOM_STORAGE_LIMIT`, `SERVICE_UNAVAILABLE` (14 §8.3) |
| Close code WS | `4401` (auth), `4426` (upgrade required) |
| Validasi | 14 §8.2 |

## 12. Requirement UI/UX

- Pesan rate limit: menjelaskan apa yang terjadi dan kapan bisa mencoba lagi, tanpa detail teknis.
- Pesan `SERVICE_UNAVAILABLE`: "Lagi ada gangguan. Aksimu dicoba lagi otomatis." + status retry.
- Copy privasi hanya dari kolom "Boleh" di 15 §11.
- Peringatan umur room memakai banner peringatan (05 §8), bukan modal yang memblokir capture.

## 13. Pertimbangan desktop & mobile

- Verifikasi CSP & header tidak memblokir GIS popup di Safari iOS dan Android Chrome.
- Uji reconnect setelah restart instance pada HP yang berpindah Wi-Fi ↔ seluler.
- Uji beban klien: HP menengah dengan 4 feed tetap ≥ 24 fps setelah semua hardening (TC-PERF-020).
- Pastikan rate limit berbasis IP tidak salah memblokir grup di balik NAT yang sama (4 peserta dari satu Wi-Fi): batas join per IP harus ≥ kebutuhan 1 room penuh + reconnect.

## 14. Pertimbangan keamanan & privasi

Ini adalah inti fase. Gunakan tabel ancaman 15 §13 sebagai daftar kerja:

| Ancaman | Bukti yang harus ada di akhir P09 |
|---|---|
| TH-01 | TC-SEC-001 PASS + log rate limit |
| TH-02 | Copy FAQ tentang link; tidak ada klaim "privat sepenuhnya" |
| TH-03 | TC-SEC-020, TC-SEC-021 PASS; CSP tanpa `unsafe-inline` untuk script |
| TH-04 | TC-SEC-014 PASS |
| TH-05 | TC-SEC-012 PASS |
| TH-06 | TC-SEC-016 PASS |
| TH-07 | TC-SEC-017 PASS |
| TH-08 | TC-SEC-018 PASS |
| TH-09 | TC-SEC-019 PASS |
| TH-10 | TC-SEC-030, -031, -032 PASS |
| TH-11 | TC-SEC-040 PASS |
| TH-12 | TC-SEC-041 PASS |
| TH-13 | TC-SEC-023 PASS |

Tambahan:

- DEC-075: verifikasi enkripsi at-rest provider storage & Redis secara tertulis (dokumentasi provider). Jangan klaim jika tidak terverifikasi.
- DEC-082: audit cookie token (`HttpOnly`, `Secure`, `SameSite=Strict`, `Max-Age`, domain), validasi `Origin`, dan apakah mode fallback `sessionStorage` dipakai di lingkungan mana pun (TC-SEC-022/023); catat hasil.
- DEC-056: jika analitik dipakai, hanya agregat tanpa media, nama, atau ID lintas room.

## 15. Checklist tugas detail

- [ ] Audit kontrol 15 §14 untuk P01–P08; daftar temuan + perbaikan.
- [ ] Token: hash, constant-time compare, revoke, scope room diverifikasi.
- [ ] Rate limit DEC-067 di semua jalur + hash IP + salt rotasi + batas aman untuk NAT bersama.
- [ ] CSP final + header + CORS + Origin WS + batas pesan.
- [ ] Decoder upload dengan batas piksel; magic bytes; signed PUT terbatas ukuran & content-type.
- [ ] Batas storage room (DEC-085).
- [ ] TURN deny-list IP privat/metadata.
- [ ] Prosedur cleanup lengkap dengan verifikasi + retry + sweeper + sweeper objek yatim + lifecycle bucket.
- [ ] Recovery restart instance tunggal; timer dari timestamp tersimpan (TC-ROOM-027). Lease multi-instance hanya bila pemicu 13 §15.2 tercapai.
- [ ] Metrik & alarm 13 §12; dashboard minimal.
- [ ] Scrubbing log server & error klien; pindai log uji.
- [ ] Uji beban TC-PERF-030; tetapkan target N.
- [ ] Ukur `capture_skew_ms`, `rtc_relay_ratio`, fps HP; bandingkan dengan NFR.
- [ ] Audit copy privasi di semua layar + FAQ + kebijakan privasi.
- [ ] Konfirmasi DEC-056 bersama pemilik produk; catat status DEC-052 (tetap OPEN = tanpa batas umur); perbarui 18.
- [ ] Verifikasi TC-ROOM-026 (room > 12 jam dengan peserta tetap hidup).
- [ ] Runbook insiden: realtime down, Redis down, TURN down, cleanup gagal (dipakai di P10).

## 16. Checkpoint integrasi

| Checkpoint | Isi |
|---|---|
| **IC-6** | Kill/restart instance realtime tunggal di tengah capture & editor; restart Redis; matikan TURN; paksa error storage saat cleanup. Semua pulih sesuai 13 §13 tanpa melanggar invariant accept (09 §9.4). |
| Regresi IC-4/IC-5 | Setelah hardening, alur capture → editor → galeri tetap lulus |

## 17. Edge case

| Kasus | Perilaku yang diverifikasi |
|---|---|
| Instance mati saat room `GRACE` | Grace dihitung dari `emptySinceMs`, bukan diulang |
| Instance mati saat `COUNTDOWN` | Countdown dibatalkan aman atau dilanjutkan dengan `t0ServerMs` yang sama; tidak ada attempt ganda (SY-05) |
| Restart instance saat peserta di `DECIDING` | `acceptedAttemptId` semua peserta tetap |
| 4 peserta satu Wi-Fi | Tidak terkena rate limit join/resume |
| Room mencapai batas storage di tengah shot | Upload ditolak `ROOM_STORAGE_LIMIT` dengan pesan; attempt lain tetap |
| Cleanup berjalan saat ada peserta resume | Room `EXPIRING` menolak resume; klien menampilkan SCR-21 |

## 18. Skenario kegagalan

| Kegagalan | Pemulihan yang harus terbukti |
|---|---|
| Realtime instance crash | Auto-restart + resume dari snapshot Redis; ukur waktu total. NFR-06 diukur dari proses/jaringan kembali |
| Redis down | Event kritis ditolak `SERVICE_UNAVAILABLE`, klien retry; kursor tetap jalan |
| Storage error saat cleanup | Retry + sweeper + alarm; data akhirnya terhapus (TC-SEC-031) |
| TURN down | Kartu "Gak bisa nyambung"; capture tetap jalan karena foto diambil lokal |
| Lonjakan event (flood) | Koneksi pelaku dibatasi; room lain tidak terdampak (TC-SEC-040) |

## 19. Acceptance criteria

| # | Kriteria | Tes |
|---|---|---|
| AC-1 | Semua TC-SEC P0 berstatus PASS dengan bukti | TC-SEC-001..003, -010, -012, -014, -016..018, -020..023, -030, -031, -040, -041 |
| AC-2 | Cleanup terverifikasi: storage & Redis kosong untuk room uji setelah grace | TC-SEC-030 |
| AC-3 | Cleanup gagal pulih via retry/sweeper + alarm tercatat | TC-SEC-031 |
| AC-4 | Lifecycle bucket menghapus objek > 24 jam | TC-SEC-032 |
| AC-5 | Reconnect ≤ 10 detik tanpa kehilangan state yang sudah di-ack; restart instance memulihkan semua room dari snapshot | TC-ROOM-020, TC-ROOM-027 + skenario IC-6 |
| AC-6 | Latensi kursor/presence p95 ≤ 150 ms; event p95 ≤ 150 ms pada target N | TC-PERF-001, TC-PERF-030 |
| AC-7 | Skew capture p95 ≤ 150 ms | TC-CAP-001 |
| AC-8 | Log & error klien bebas nama, token, signed URL, gambar | TC-SEC-041 |
| AC-9 | Copy privasi lolos audit 15 §11 | TC-UX-011 (bagian copy) |
| AC-10 | TURN tidak me-relay ke IP privat | TC-SEC-019 |
| AC-11 | Invariant accept tetap setelah restart instance | TC-CAP-010 diulang dengan restart |
| AC-12 | Room dengan peserta terhubung tidak berakhir karena umur (default DEC-052) | TC-ROOM-026 |
| AC-13 | Studio/editor/export dengan 32 cell stabil di perangkat target | TC-PERF-022 |

## 20. Checklist pengujian

- [ ] Jalankan semua TC-SEC (17 §6.11) di staging.
- [ ] Jalankan TC-PERF-001, -030; ukur TC-CAP-001, TC-PERF-020 di perangkat.
- [ ] Skenario IC-6 lengkap, didokumentasikan dengan waktu pemulihan.
- [ ] Regresi P0 A + TC-E2E-001 setelah hardening.
- [ ] Pindai log & error klien dari sesi uji.

Perintah verifikasi yang disarankan (dijalankan pengguna atau atas izin eksplisitnya): `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:security`, `pnpm load:ws --rooms=<N>`. Agen tidak menjalankan typecheck/lint/build penuh, commit, push, deploy, atau perubahan storage/Redis yang destruktif di lingkungan bersama tanpa instruksi pengguna, dan tidak pernah mengarang hasil tes.

## 21. Definition of Done

- [ ] AC-1..AC-13 terverifikasi dengan bukti.
- [ ] Laporan audit keamanan: temuan, tingkat risiko, status perbaikan, risiko yang diterima.
- [ ] DEC-056 berstatus final atau default sementara disetujui eksplisit; status DEC-052 tercatat (default tanpa batas umur); 18 diperbarui.
- [ ] Status verifikasi DEC-075 tercatat.
- [ ] Runbook insiden selesai.
- [ ] Tidak ada OPEN QUESTION 🔴 baru yang belum dijawab.
- [ ] Handoff §24 terisi.

## 22. Deliverable

- Laporan audit keamanan & privasi (temuan + bukti).
- Cleanup lengkap (verifikasi, sweeper, lifecycle) + alarm.
- Restart & recovery teruji (laporan IC-6); keputusan perlu/tidaknya scale-out dicatat terhadap pemicu 13 §15.2.
- Laporan performa & beban (target N, NFR terukur).
- CSP/header final, konfigurasi TURN & bucket.
- Audit copy privasi + teks FAQ/kebijakan privasi (draft untuk disetujui).
- Runbook insiden.

## 23. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| RK-06 cleanup tidak tuntas | Verifikasi + sweeper + lifecycle + alarm |
| RK-05 biaya TURN | Ukur `rtc_relay_ratio`, tetapkan batas bitrate, putuskan DEC-073 |
| CSP terlalu ketat memutus GIS/Next.js | Uji di semua browser DEC-050 sebelum final |
| Rate limit memblokir pengguna sah di NAT bersama | Batas berdasarkan kebutuhan 1 room + reconnect; uji skenario |
| Temuan keamanan besar di akhir | Kontrol sudah diterapkan per fase (15 §14); P09 memverifikasi |
| Klaim privasi berlebih | Audit copy wajib, daftar "Dilarang" 15 §11 |

## 24. Handoff ke fase berikutnya

```text
## Handoff P09 → P10
Tanggal / agen:
Status fase: READY FOR REVIEW | DONE

### Pekerjaan selesai
- ...

### Komponen/file/infra yang diubah
- ...

### Keputusan teknis penting (DEC-052, DEC-056, DEC-073, DEC-075, DEC-082: status akhir)
- ...

### Tes yang sudah dijalankan (ID, hasil, bukti, lingkungan)
- TC-SEC-...: PASS/FAIL — bukti: ...
- IC-6: waktu pemulihan per skenario: ...

### Tes yang BELUM dijalankan (dan alasannya)
- ...

### Temuan keamanan terbuka & risiko yang diterima
- ...

### Masalah yang diketahui
- ...

### Metrik dasar untuk P10
- capture_skew_ms p95: ...   rtc_relay_ratio: ...   target N beban: ...

### Kesiapan untuk P10
- [ ] Semua TC-SEC P0 PASS
- [ ] Cleanup terverifikasi di staging
- [ ] Runbook insiden tersedia
```
