# P02 — Room & Multiplayer Presence

| Atribut | Nilai |
|---|---|
| Dokumen | `PHASES/P02_ROOM_MULTIPLAYER.md` |
| Versi | 1.1.0 |
| Status fase | NOT STARTED |
| Bergantung pada | P01 (DONE) |
| Dokumen wajib dibaca | [07_ROOM_AND_MULTIPLAYER.md](../07_ROOM_AND_MULTIPLAYER.md), [14_DATA_MODEL_AND_EVENTS.md](../14_DATA_MODEL_AND_EVENTS.md) §2–§5, [15_SECURITY_PRIVACY_LIFECYCLE.md](../15_SECURITY_PRIVACY_LIFECYCLE.md) §2–§4 & §8, [04_SCREEN_SPECIFICATIONS.md](../04_SCREEN_SPECIFICATIONS.md) SCR-01..05, SCR-20..21 |

## 1. Identitas & tujuan fase

P02 membangun inti multiplayer: membuat room, kode unik, join via kode/link, identitas anonim berbasis token, maksimal 4 peserta, presence real-time, warna pemain, kursor multiplayer desktop, reconnect dasar, dan lifecycle room (grace period → hancur → cleanup dasar). Tidak ada kamera di fase ini; kartu kamera di lobby menampilkan state avatar/"kamera belum aktif".

Bersama P03, P02 menghasilkan milestone **M1 — Room hidup**.

## 2. Prasyarat & dependensi

| Prasyarat | Catatan |
|---|---|
| P01 DONE | Komponen inti, AppShell + header desktop/mobile, landing SCR-01, kerangka layout SCR-02/03/05/21, realtime skeleton (`/api/health`). Layar lain dibangun oleh fase pemiliknya (v1.1). |
| DEC-037 (actor + Redis) | RECOMMENDED; dipakai sebagai default |
| DEC-020 grace period | OPEN; pakai default 120 s via `ROOM_GRACE_PERIOD_SECONDS` |
| DEC-021, DEC-022, DEC-043, DEC-044, DEC-067, DEC-071, DEC-083, DEC-084 | PROPOSED; implementasikan sebagai konfigurasi terpusat |
| DEC-082 token di cookie HttpOnly | RECOMMENDED; frontend & realtime di bawah satu domain (13 §15.4). Jika tidak memungkinkan, pakai fallback `sessionStorage` + pesan `auth` dan catat di handoff |
| DEC-088 satu instance realtime (MVP) | RECOMMENDED; tidak membangun registry owner/lease multi-instance |
| DEC-052 umur maks. room | OPEN. **Default: tidak ada batas umur.** Konfigurasi `ROOM_MAX_LIFETIME_HOURS` boleh disiapkan tapi default kosong/nonaktif; jangan aktifkan tanpa persetujuan pemilik produk |
| Redis lokal + object storage lokal (misal minio) | Untuk dev & tes integrasi |

## 3. Kondisi awal yang diharapkan

- Monorepo P01 berjalan; `apps/realtime` hanya punya `/api/health`.
- Landing input kode belum memanggil API.
- Tidak ada WebSocket, token, atau penyimpanan state.

## 4. Requirement dalam scope

- Create room (F-02), preview & join via kode (F-03) dan link `/r/{code}` (F-04).
- Token peserta di cookie HttpOnly (DEC-082), auth WebSocket saat upgrade + cek `Origin` (fallback: pesan `auth`), resume dengan `lastSeq` (07 §3, §10; 14 §4–§5).
- Kapasitas 4 atomik (07 §4), alokasi warna (DEC-044), validasi nama (DEC-043).
- Presence: `CONNECTED/RECONNECTING/LEFT`, heartbeat, hold slot 60 s (DEC-021).
- Kursor desktop di permukaan bersama (DEC-071) — di P02 cukup diuji di lobby (permukaan dev); integrasi di voting/studio/editor dikerjakan P04/P05/P07 saat layar itu dibangun.
- Indikator presence mobile (daftar peserta, stack avatar).
- Keluar room (F-18) termasuk konfirmasi peserta terakhir (DEC-057, cukup peringatan tanpa unduh karena galeri belum ada).
- Lifecycle `ACTIVE → GRACE → EXPIRING → EXPIRED` (tanpa transisi karena umur room secara default, DEC-052), tombstone (DEC-084), cleanup dasar storage prefix + Redis dengan verifikasi (15 §8.2).
- Multi-tab takeover (DEC-083).
- Kontrol keamanan P02 (15 §14).

## 5. Di luar scope (eksplisit)

- Kamera & WebRTC (P03); di lobby hanya state visual tanpa feed.
- Voting & sesi (P04). Tombol **Mulai vote mode** boleh tampil tapi disabled dengan label "Segera" di lingkungan dev saja.
- Upload apa pun ke storage (P05/P06); cleanup storage diuji dengan objek dummy.
- Sweeper harian objek yatim dan alarm lengkap (P09); di P02 cukup retry dasar.
- Fitur kick/host (DEC-090 REJECTED).

## 6. ID requirement terkait

REQ-ROOM-01..13, REQ-LIFE-01..05, REQ-MOB-10, NFR-01, NFR-06, NFR-08, NFR-09. Keputusan: DEC-001..003, DEC-010, DEC-020..022, DEC-025 (teks lobby), DEC-037, DEC-043, DEC-044, DEC-052, DEC-057, DEC-067, DEC-071, DEC-082..084.

## 7. Referensi dokumentasi

- [07_ROOM_AND_MULTIPLAYER.md](../07_ROOM_AND_MULTIPLAYER.md) — sumber utama.
- [14_DATA_MODEL_AND_EVENTS.md](../14_DATA_MODEL_AND_EVENTS.md) §2–§5, §8, §12–§13.
- [15_SECURITY_PRIVACY_LIFECYCLE.md](../15_SECURITY_PRIVACY_LIFECYCLE.md) §2–§4, §8, §9.
- [03_USER_FLOWS.md](../03_USER_FLOWS.md) F-01..F-06, F-17..F-19.
- [13_SYSTEM_ARCHITECTURE.md](../13_SYSTEM_ARCHITECTURE.md) §7, §8, §12.

## 8. Referensi visual yang disetujui

| Layar | Referensi |
|---|---|
| SCR-01 Landing (input kode + error) | `02_Desktop/01_Landing.webp`, `03_Mobile/01_Landing.webp` |
| SCR-05 Lobby | `02_Desktop/02_Lobby.webp`, `03_Mobile/02_Lobby.webp` |
| SCR-02, SCR-03, SCR-20, SCR-21, SCR-22 | DERIVED (04) — wajib review visual |

## 9. Tugas implementasi fungsional

1. **Bikin room**: SCR-02 isi nama → `POST /api/rooms` → server mengirim cookie token (DEC-082) → lanjut ke lobby (SCR-04 dilewati sementara sampai P03, dengan catatan di handoff).
2. **Gabung**: input kode di landing → `GET /preview` → SCR-03 → `POST /join`. State `not_found`, `full`, `expired`, `rate_limited` lengkap dengan copy 03 F-03.
3. **Link** `/r/{code}`: cookie token valid untuk room itu → langsung resume; tanpa token → SCR-03 dengan kode terkunci.
4. **Lobby SCR-05**: grid 4 slot (peserta tanpa feed: avatar + "Kamera belum aktif"; slot kosong + **Salin link undangan**), kartu kode + QR + salin/bagikan (Web Share di mobile), daftar peserta dengan status koneksi.
5. **Presence**: perubahan join/leave/reconnect tampil ≤ 2 s; toast ringan "Bimo masuk room".
6. **Kursor**: kirim `cursor.move` (throttle 20 Hz, ≥ 2 px) di permukaan yang aktif; render interpolasi ≤ 100 ms; sembunyikan setelah 5 s diam; hanya `pointer: fine`.
7. **Reconnect**: backoff 0.5→8 s + jitter, banner SCR-20(b) "Sinyal lemah, nyambung lagi…".
8. **Keluar**: menu `⋯`/ikon keluar → konfirmasi → `participant.leave` → server mencabut token & menghapus cookie → kembali ke landing.
9. **Room bubar**: link ke room expired menampilkan SCR-21 (copy memakai `{N}` dari DEC-020; tanpa kata "permanen" sampai verifikasi P09).

## 10. Tugas implementasi teknis

| Tugas | Detail (PROPOSED) |
|---|---|
| Room actor | `apps/realtime/src/room/RoomActor.ts`: antrean event serial, state `Room` (14 §2), timer hold & grace, `roomVersion`, `seq`, ring buffer 500 event |
| Registry kode | `SET room:code:{CODE} {roomId} NX EX` (07 §2); retry 5× |
| Token | 32 byte CSPRNG base64url; simpan hash SHA-256; compare constant-time; dikirim sebagai cookie `lr_p_{roomId}` `HttpOnly; Secure; SameSite=Strict; Path=/` |
| HTTP API | `POST /api/rooms`, `GET /api/rooms/{code}/preview`, `POST /api/rooms/{code}/join` (14 §4) dengan error code 14 §8.3 |
| WebSocket gateway | Cek `Origin` + cookie saat upgrade (gagal → `401`); fallback pesan pertama `auth` (timeout 5 s → close 4401); `protocolVersion`; batas 64 KB/pesan; 60 event/detik/koneksi |
| Persistensi | Event kritis (join, leave, status) di-commit ke Redis sebelum ack (13 §7); snapshot room |
| Penempatan room | MVP satu instance (DEC-088): `wsUrl` tetap; actor dimuat ulang dari snapshot Redis setelah restart. Registry owner multi-instance **tidak** dikerjakan (13 §15) |
| Lifecycle | `emptySinceMs`, timer grace dari timestamp tersimpan, `EXPIRING` → cleanup → `EXPIRED` + tombstone 24 jam |
| Cleanup dasar | List & delete prefix `rooms/{roomId}/` + hapus key `room:{roomId}:*` + verifikasi ulang + retry backoff (15 §8.2 langkah 1–7) |
| Rate limit | Redis counter: create 10/jam/IP, join 30/10 menit/IP, kode salah 20/10 menit/IP (DEC-067); IP disimpan sebagai hash bersalt |
| Klien | `apps/web/src/room/store.ts` (ClientStore 14 §3), `room/socket.ts` (koneksi, ack, retry `clientEventId`, resume), `room/cursors.ts` |
| Konfigurasi | `ROOM_GRACE_PERIOD_SECONDS`, `PARTICIPANT_HOLD_SECONDS`, `ROOM_MAX_LIFETIME_HOURS` (default nonaktif), `ALLOWED_ORIGINS`, `COOKIE_DOMAIN` |

## 11. Dependensi data model & event

- Model: `Room`, `Participant`, `ClientStore` (14 §2–§3).
- HTTP: 14 §4 (create, preview, join, health).
- WebSocket: `auth`, `auth.ok`, `room.resume`, `room.snapshot`, `participant.joined/left`, `presence.update`, `presence.set` (field koneksi & `ready` saja), `cursor.move`, `participant.leave`, `session.replaced`, `room.expiring`, `room.expired`, `time.ping/pong` (14 §5.2).
- Idempotensi `clientEventId` (14 §8.1); urutan `seq` & resume (14 §13).

## 12. Requirement UI/UX

- Lobby mengikuti V1: header dengan tag `Lobby`, judul "Nungguin geng lengkap", sub teks sesuai DEC-025, rail kanan 310 px di desktop.
- Kartu kode: kode display 52 px (desktop) / 32 px (mobile), tabular.
- Error inline di landing/SCR-03 memakai `aria-describedby`.
- Toast presence maks. 3 bertumpuk (04 SCR-22).
- Tidak ada indikasi "host"/"owner" di mana pun.

## 13. Pertimbangan desktop & mobile

- Kursor hanya pada `pointer: fine`; mobile memakai stack avatar & daftar peserta (REQ-ROOM-11, REQ-MOB-10).
- **Ajak** di mobile memakai `navigator.share` dengan fallback salin.
- Join via link di iOS Safari & Android Chrome diuji di perangkat nyata (06 §15).
- Background tab di mobile: heartbeat bisa berhenti → status `RECONNECTING`; saat kembali, resume otomatis.

## 14. Pertimbangan keamanan & privasi

- Token tidak pernah di URL/query; tidak terbaca JavaScript (cookie HttpOnly); tidak dicatat di log (NFR-09).
- `SameSite=Strict` + validasi `Origin` di WS & API (TH-13, TC-SEC-023).
- `preview` hanya inisial & jumlah (15 §4); tidak ada nama lengkap.
- Nama disanitasi & dirender sebagai teks (TC-SEC-020).
- Kapasitas & otorisasi ditegakkan di server, bukan UI.
- Kode bukan rahasia kuat; copy FAQ/privasi akurat (15 §3).
- Cleanup menghapus semua key room; tombstone tanpa data pribadi.

## 15. Checklist tugas detail

- [ ] RoomActor + antrean serial + unit test.
- [ ] Generator kode CSPRNG (alfabet DEC-022) + registry NX.
- [ ] Token + hash + compare constant-time + cookie HttpOnly (DEC-082).
- [ ] Endpoint create/preview/join + error code.
- [ ] Rate limit 3 jenis.
- [ ] WS gateway: auth cookie saat upgrade (+ fallback `auth`), origin, batas ukuran & frekuensi.
- [ ] Event presence + heartbeat + hold slot.
- [ ] Resume `lastSeq` + snapshot fallback.
- [ ] Multi-tab takeover.
- [ ] Commit Redis sebelum ack untuk event kritis.
- [ ] Lifecycle + grace + tombstone + cleanup dasar terverifikasi.
- [ ] UI SCR-02, SCR-03, SCR-05, SCR-20(b), SCR-21 + input kode landing.
- [ ] Kursor desktop + interpolasi.
- [ ] Keluar room + konfirmasi peserta terakhir.
- [ ] Tes (§20) + handoff (§24).

## 16. Checkpoint integrasi

**IC-1**: frontend ↔ realtime ↔ Redis. Skenario: 4 konteks browser join, satu reload di tengah, satu keluar, semua keluar lalu satu kembali dalam grace, lalu semua keluar melewati grace. Semua state konsisten di semua klien.

## 17. Edge case

- EC-01 peserta ke-5; EC-02 dua join bersamaan untuk slot terakhir.
- EC-10 semua keluar lalu satu kembali dalam grace; EC-11 kembali setelah grace.
- Room penuh karena slot `RECONNECTING` → pesan "Ada yang lagi nyambung lagi" (07 §4).
- Nama duplikat → sufiks " 2" (DEC-043).
- Tab dibuka dua kali dengan token sama (DEC-083).
- Instance actor restart saat `GRACE` → timer dilanjutkan dari `emptySinceMs`.
- Kode diketik dengan karakter ambigu (O/0, I/1) → difilter.

## 18. Skenario kegagalan

| Kegagalan | Perilaku |
|---|---|
| Redis tidak tersedia | Event kritis ditolak `SERVICE_UNAVAILABLE`; klien retry dengan `clientEventId` yang sama |
| WebSocket putus terus-menerus | Backoff maks. 8 s; banner tetap terlihat; tidak ada loop tanpa jeda |
| Cleanup gagal | Retry 1m/5m/15m/1j + metric `cleanup_failures_total` |
| Token tidak valid saat resume | Server menghapus cookie → SCR-03 (jika room masih ada) atau SCR-21 |
| Rate limit | Pesan ramah, tombol coba lagi aktif setelah jeda |

## 19. Acceptance criteria

| # | Kriteria | Test |
|---|---|---|
| AC-1 | Create/join via kode & link berfungsi | TC-ROOM-001..003 |
| AC-2 | Peserta ke-5 ditolak di server; join bersamaan aman | TC-ROOM-004, TC-ROOM-005 |
| AC-3 | Tidak ada aksi eksklusif pembuat room (untuk aksi yang tersedia di P02) | TC-ROOM-010 (bagian P02) |
| AC-4 | Warna unik P1..P4 | TC-ROOM-011 |
| AC-5 | Presence ≤ 2 s; kursor p95 ≤ 150 ms satu region | TC-ROOM-012, TC-ROOM-013, TC-PERF-001 |
| AC-6 | Reload memulihkan slot ≤ 10 s; hold 60 s → `LEFT` | TC-ROOM-020, TC-ROOM-021 |
| AC-7 | Grace & expiry bekerja; SCR-21 tampil; room dengan peserta terhubung tidak pernah expired karena umur (default) | TC-ROOM-022, TC-ROOM-023, TC-ROOM-026 |
| AC-8 | Multi-tab takeover | TC-ROOM-024 |
| AC-9 | Tidak ada login | TC-ROOM-025 |
| AC-10 | Keamanan dasar P02 | TC-SEC-001, TC-SEC-002, TC-SEC-003, TC-SEC-010, TC-SEC-020, TC-SEC-022, TC-SEC-023 |
| AC-11 | Cleanup room terverifikasi (objek dummy) | TC-SEC-030 |

## 20. Checklist pengujian

- [ ] Unit: kapasitas, alokasi warna, hold slot, grace timer, resolusi takeover, normalisasi kode.
- [ ] Integrasi: API + Redis + minio, cleanup & verifikasi.
- [ ] E2E Playwright 4 konteks: join, presence, kursor, reload, keluar, grace.
- [ ] Perangkat nyata (D): join via link di iOS Safari & Android Chrome; background/foreground.
- [ ] Keamanan: TC-SEC-001/002/003/010/020/022/023/030.
- [ ] Lifecycle: TC-ROOM-026 (jam disimulasikan).

Perintah yang disarankan (dijalankan pengguna atau atas izin eksplisit): `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`. Agen tidak menjalankan typecheck/lint/build penuh atau Git tanpa instruksi, tidak commit/push/deploy otomatis, dan tidak mengarang hasil tes.

## 21. Definition of Done

- Checklist §15 lengkap dengan bukti.
- AC-1..AC-11 terverifikasi; tes M/D dicatat siapa/kapan/perangkat.
- Kontrol keamanan P02 (15 §14) aktif.
- Tidak ada flag host atau mekanisme akun.
- Handoff §24 disetujui.

## 22. Deliverable

- Realtime service: RoomActor, HTTP API, WS gateway, rate limit, lifecycle, cleanup dasar.
- Klien: store, socket, resume, kursor, layar SCR-02/03/05/20(b)/21 fungsional.
- Tes unit, integrasi, E2E.
- Dokumentasi singkat cara menjalankan Redis/minio lokal.

## 23. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| RK-06 cleanup tidak tuntas | Verifikasi pasca-hapus sejak P02; sweeper di P09 |
| Race di kapasitas | Semua mutasi lewat actor serial; tes TC-ROOM-005 |
| Token dicuri via XSS / CSRF (DEC-082) | Cookie HttpOnly + `SameSite=Strict` + cek `Origin`, CSP ketat, tanpa HTML dari pengguna, token terikat room |
| Satu instance jadi titik gagal tunggal (RK-11) | Snapshot Redis sebelum ack + resume klien; ukur waktu restart |
| Kursor membanjiri jaringan | Throttle 20 Hz + ambang 2 px + volatile |

## 24. Handoff ke fase berikutnya

```markdown
### Handoff P02 → P03
- Status fase: READY FOR REVIEW / DONE
- Pekerjaan selesai: …
- Komponen/file yang diubah atau dibuat: …
- Keputusan teknis + status DEC (DEC-020 nilai dipakai: …, DEC-082 cookie/fallback: …, DEC-052 tetap nonaktif: …, DEC-088 …): …
- Tes yang dijalankan (ID, tanggal, lingkungan/perangkat, hasil + bukti): …
- Tes yang BELUM dijalankan dan alasannya: …
- Masalah yang diketahui: …
- Risiko yang masih terbuka: …
- Catatan sementara (mis. SCR-04 dilewati sampai P03): …
- Kesiapan untuk P03 (ya/tidak + syarat; pilihan DEC-073 TURN; DEC-076 tetap OPEN dan tidak memblokir): …
```
