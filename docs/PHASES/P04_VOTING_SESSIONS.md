# P04 — Voting & Session Management

| Atribut | Nilai |
|---|---|
| Dokumen | `PHASES/P04_VOTING_SESSIONS.md` |
| Versi | 1.1.0 |
| Status fase | NOT STARTED |
| Bergantung pada | P02 (room, presence, actor), P03 (feed kamera tampil di lobby) |
| Dokumen wajib dibaca | [08_VOTING_AND_SESSIONS.md](../08_VOTING_AND_SESSIONS.md), [14_DATA_MODEL_AND_EVENTS.md](../14_DATA_MODEL_AND_EVENTS.md) §6, [04_SCREEN_SPECIFICATIONS.md](../04_SCREEN_SPECIFICATIONS.md) (SCR-06, SCR-07, SCR-19), [18_DECISIONS_AND_OPEN_QUESTIONS.md](../18_DECISIONS_AND_OPEN_QUESTIONS.md) |

---

## 1. Identitas & tujuan fase

P04 membangun **voting mode yang demokratis** dan **lifecycle sesi**. Hasil fase: peserta di room bisa memulai sesi, memilih salah satu dari 4 mode dengan bobot suara sama, menyelesaikan seri secara transparan, lalu mode terkunci dan semua peserta masuk studio dalam state `STUDIO`. Di fase ini, state `STUDIO` diarahkan ke grid booth SCR-08 dasar dari P03 (feed live tanpa frame engine); P05 yang menambahkan frame, layout, dan BindingPlan.

Urutan produk wajib dijaga: **voting terjadi sebelum konfigurasi photobooth** (REQ-VOTE-01).

## 2. Prasyarat & dependensi

| Prasyarat | Sumber | Status yang dibutuhkan |
|---|---|---|
| Room actor serial + Redis commit sebelum ack | P02, 13 §7 | Selesai |
| Presence `CONNECTED/RECONNECTING/LEFT` | P02, 07 §7 | Selesai |
| Kursor multiplayer (desktop) | P02, 07 §8 | Selesai |
| Feed kamera di lobby | P03 | Selesai (dipakai SCR-05) |
| Keputusan voting | DEC-023, DEC-024, DEC-025, DEC-046, DEC-063, DEC-081 | Default PROPOSED boleh dipakai, wajib berupa konfigurasi |

## 3. Kondisi awal yang diharapkan

- 4 peserta bisa join room, melihat feed satu sama lain di SCR-05, dan presence tersinkron.
- Event envelope (`C2S`/`S2C`, `seq`, `clientEventId`, ack) dari 14 §5 sudah ada.
- Belum ada model `Session`. Tombol **Mulai vote mode** di lobby masih nonaktif atau placeholder.

## 4. Requirement dalam scope

- Model `Session` dan `Voting` sesuai 14 §6, dengan state sesi `VOTING → STUDIO` (state lain di-stub untuk fase berikutnya).
- Memberi, mengubah, dan menampilkan suara secara real-time.
- Penutupan voting: otomatis saat semua peserta `CONNECTED` memilih, serta manual **Tutup vote** setelah mayoritas, dengan jendela 5 detik (DEC-023).
- Penanganan seri: satu ronde ulang di antara opsi seri, lalu pilih acak oleh server (DEC-024).
- Penguncian mode per sesi (REQ-VOTE-06).
- Transisi otomatis ke studio 3 detik setelah hasil (DEC-081).
- Membuat sesi baru (fondasi DEC-063, termasuk event `session.invite`). UI lengkap SCR-19 diselesaikan di P08.
- Perubahan peserta selama voting (08 §7).

## 5. Di luar scope (eksplisit)

- Aksi membatalkan sesi yang sedang berjalan: belum ada di brief (OPEN QUESTION [DEC-086](../18_DECISIONS_AND_OPEN_QUESTIONS.md)). Default: tidak dibuat.

- Timer otomatis penutup voting. **Tidak boleh dibuat** (DEC-046, TC-VOTE-005).
- Isi studio: frame, layout, kanvas (P05).
- Capture, countdown (P06).
- Editor, finalisasi, galeri (P07, P08).
- Voting rahasia, hak veto, atau override dalam bentuk apa pun (REQ-VOTE-04).
- Pengaturan durasi voting oleh pengguna. Kalau dibutuhkan → usulkan sebagai DEC baru di 18.

## 6. ID requirement terkait

REQ-VOTE-01..08, REQ-LIFE-07, REQ-GAL-04..05 (fondasi), REQ-ROOM-07, REQ-ROOM-08, REQ-ROOM-10, REQ-MOB-01..02, REQ-UI-01. Keputusan: DEC-004, DEC-013, DEC-023, DEC-024, DEC-025, DEC-030, DEC-046, DEC-053, DEC-063, DEC-071, DEC-081.

## 7. Referensi dokumentasi

- [08_VOTING_AND_SESSIONS.md](../08_VOTING_AND_SESSIONS.md) §2–§10
- [14_DATA_MODEL_AND_EVENTS.md](../14_DATA_MODEL_AND_EVENTS.md) §6, §8, §13
- [03_USER_FLOWS.md](../03_USER_FLOWS.md) F-06, F-07, F-08, F-16
- [07_ROOM_AND_MULTIPLAYER.md](../07_ROOM_AND_MULTIPLAYER.md) §7.2, §13
- [17_QA_TEST_PLAN.md](../17_QA_TEST_PLAN.md) §6.2

## 8. Referensi visual yang disetujui

| Layar | File | Catatan |
|---|---|---|
| SCR-06 desktop | `02_Desktop/03_Voting.webp` | Kartu "Sisa waktu 0:18" **diganti** dengan status penutupan (DEC-046) |
| SCR-06 mobile | `03_Mobile/03_Voting.webp` | Grid 2×2, bar progres bawah |
| SCR-07 | DERIVED | Ikuti 04 SCR-07 dan design system 05; wajib direview visual |
| SCR-19 (fondasi) | DERIVED | Hanya event & banner sederhana di fase ini |

## 9. Tugas implementasi fungsional

1. Dari lobby, siapa pun menekan **Mulai vote mode**, lalu semua peserta pindah ke SCR-06 (minimal peserta mengikuti DEC-025, default 1).
2. Di SCR-06, peserta mengetuk kartu mode untuk memilih. Mengetuk kartu lain mengganti suara; mengetuk kartu yang sama **tidak** membatalkan suara.
3. Semua klien melihat avatar pemilih di kartu, jumlah suara, dan bar progres "x dari y udah vote".
4. Saat suara > 50% peserta `CONNECTED`, tombol **Tutup vote** muncul untuk semua. Saat ditekan, semua klien melihat "{nama} nutup vote dalam 5…" dan tetap bisa memilih selama jendela itu.
5. Saat semua `CONNECTED` sudah memilih, voting langsung diselesaikan.
6. Hasil menang: SCR-07 state menang (pratinjau mode, bar hasil, gembok "Dikunci buat sesi n"), lalu otomatis ke studio dalam 3 detik atau lebih cepat lewat **Masuk booth**.
7. Hasil seri: SCR-07 state seri dengan opsi seri saja; suara direset untuk ronde 2.
8. Masih seri di ronde 2: animasi "Booth lempar koin…" (tanpa animasi saat reduced motion) dengan hasil yang sama di semua klien.
9. Peserta `LEFT` saat voting: suaranya dihapus dan tally dihitung ulang.
10. **Sesi baru** (dipanggil dari tempat sementara untuk pengujian, UI final di P08): sesi aktif menjadi `CLOSED`, sesi n+1 dibuat dalam `VOTING`, dan peserta lain menerima `session.invite`.

## 10. Tugas implementasi teknis

| Area | Tugas | Lokasi (PROPOSED) |
|---|---|---|
| Domain | Fungsi murni `resolveVotes(votes, connected, round)` → `{winner} \| {tie: Mode[]}` | `realtime/src/domain/voting.ts` |
| Domain | State machine voting `OPEN → CLOSING → RESOLVING → TIE_ROUND → RANDOM_PICK → LOCKED` | `realtime/src/domain/voting.ts` |
| Domain | State machine sesi (`VOTING`, `STUDIO`, sisanya stub) | `realtime/src/domain/session.ts` |
| Actor | Handler `session.create`, `vote.cast`, `vote.close`; timer jendela 5 detik dengan `closingAtMs` disimpan di Redis | `realtime/src/room/handlers/voting.ts` |
| Acak | Pilihan acak memakai `crypto.randomInt`, dicatat di `session.eventLog` | Sama |
| Persistensi | Commit ke Redis sebelum ack untuk `vote.cast` & resolusi (13 §7) | Room store |
| Recovery | Timer `CLOSING` yang terputus karena instance mati dilanjutkan dari `closingAtMs` | Actor recovery |
| Klien | Slice store `session`/`voting` + selector `canClose`, `myVote` | `web/src/store/session.ts` |
| Klien | Optimistic vote dengan rollback jika `ack.ok=false` | `web/src/features/voting/` |
| Klien | Komponen `ModeCard`, `VoteProgress`, `CloseVoteButton`, `VoteResult`, `TieRound`, `CoinFlip` | `web/src/features/voting/` |
| Konfigurasi | `VOTE_CLOSE_WINDOW_MS=5000`, `STUDIO_AUTO_ENTER_MS=3000`, `MIN_PARTICIPANTS_TO_START=1`, `MAX_SESSIONS_PER_ROOM=20` | Config terpusat |

## 11. Dependensi data model & event

- Model: `Session`, `Voting`, `Mode`, `SessionState`, `VotingPhase` (14 §6).
- Event: `session.create`, `session.invite`, `session.state`, `vote.cast`, `vote.close`, `vote.state`, `vote.tie`, `vote.resolved` (14 §6).
- Error: `VOTING_CLOSED`, `INVALID_OPTION`, `CLOSE_NOT_ALLOWED`, `MODE_LOCKED`, `SESSION_LIMIT`, `SESSION_ACTIVE_NOT_FINAL` (14 §8.3).
- Idempotensi `clientEventId` untuk semua intent (14 §8.1).
- `room.snapshot` wajib menyertakan sesi aktif & voting agar reconnect mengembalikan state yang sama.

## 12. Requirement UI/UX

- Layout SCR-06 sesuai 04 SCR-06: judul "Mau foto *model apa?*" (serif hanya di frasa kedua), kartu dengan pratinjau output per mode, kartu terpilih ber-ring plum + tag `✓ Pilihanmu`.
- Pratinjau output di kartu mode memakai komponen pratinjau statis (gambar contoh). Renderer frame asli baru ada di P05.
- Caption gembok: "Mode yang menang dikunci buat sesi ini. Frame dan layout tetap bisa diatur bareng."
- Kursor peserta lain tampil di SCR-06 desktop (DEC-071).
- Copy seri: "Seri 2–2. Pilih salah satu, *sekali lagi.*" Copy acak: "Booth lempar koin karena masih seri".
- **Dilarang** menampilkan timer mundur voting.
- Stepper header `Vote` aktif.

## 13. Pertimbangan desktop & mobile

| Aspek | Desktop | Mobile |
|---|---|---|
| Grid kartu | 4 kolom | 2×2, pratinjau 196 px (160 px di `xs`) |
| Progres | Kartu kanan atas | Bar bawah + caption gembok |
| Tutup vote | Tombol di area progres | Tombol di bar bawah (≥ 44 px) |
| Presence | Kursor | Avatar di kartu |
| Reduced motion | Tanpa animasi koin | Sama |

Kartu mode berperilaku sebagai `radiogroup` (keyboard: panah + Enter/Spasi).

## 14. Pertimbangan keamanan & privasi

- Validasi server: peserta terautentikasi dan `CONNECTED`, sesi dalam `VOTING`, mode termasuk `options` ronde berjalan (15 §14 baris P04).
- Tidak ada endpoint/aksi untuk memaksa hasil (REQ-VOTE-04, DEC-090 REJECTED).
- Hasil acak dibuat server dengan CSPRNG; klien tidak boleh menentukan hasil.
- Rate limit event WS berlaku (DEC-067).
- Log hanya `roomId`, `sessionId`, dan hasil; tanpa display name (NFR-09).

## 15. Checklist tugas detail

- [ ] Fungsi `resolveVotes` + tabel kasus unit test (menang tunggal, unanim, seri 2–2, seri 1–1–1–1, tanpa suara, peserta `LEFT`)
- [ ] State machine voting + penolakan transisi ilegal
- [ ] Handler `vote.cast` (ganti suara, idempoten, `VOTING_CLOSED`)
- [ ] Handler `vote.close` (`CLOSE_NOT_ALLOWED` jika ≤ 50%)
- [ ] Jendela `CLOSING` 5 detik tanpa pembatalan, vote tetap diterima selama jendela
- [ ] Penutupan otomatis saat semua `CONNECTED` memilih
- [ ] Ronde seri + reset suara
- [ ] Pilihan acak + `eventLog`
- [ ] Lock mode + penolakan `MODE_LOCKED`
- [ ] Transisi `VOTING → STUDIO` + `STUDIO_AUTO_ENTER_MS`
- [ ] `session.create` + batas 20 sesi + `session.invite`
- [ ] Recovery timer setelah restart actor
- [ ] SCR-06 desktop & mobile sesuai V1 (minus timer)
- [ ] SCR-07 menang/seri/acak
- [ ] Banner ajakan sesi baru sederhana
- [ ] Snapshot reconnect memuat state voting
- [ ] Tes otomatis sesuai §20
- [ ] Handoff §24 diisi

## 16. Checkpoint integrasi

- **IC-3 (bagian voting):** lobby → voting → hasil → grid booth SCR-08 dasar (P03), diuji dengan 4 konteks Playwright.
- Reconnect di tengah voting harus mengembalikan suara dan fase yang sama (memakai mekanisme P02).
- Hasil acak identik di 4 klien (bandingkan payload `vote.resolved`).

## 17. Edge case

| Kasus | Perilaku | Ref |
|---|---|---|
| EC-03 seri setelah semua memilih | `TIE_ROUND` | 08 §6 |
| EC-04 peserta putus saat voting | Suara tetap; tidak ditunggu penutupan otomatis | 08 §7 |
| Peserta baru join saat `OPEN` | Ikut ronde; penutupan otomatis menunggu dia | DEC-030 |
| Peserta join saat `CLOSING` | Bisa memilih dalam sisa jendela | DEC-023 |
| Semua kecuali satu `LEFT` | Satu suara cukup untuk resolusi | DEC-025 |
| Semua keluar saat voting | Room `GRACE`, voting dibekukan, lanjut saat kembali | 08 §7 |
| Vote tiba setelah `RESOLVING` | `VOTING_CLOSED` | 07 §13 |
| Dua orang menekan **Tutup vote** | Yang kedua idempoten (jendela sama) | 14 §8.1 |

## 18. Skenario kegagalan

| Kegagalan | Penanganan |
|---|---|
| Instance mati saat `CLOSING` | Actor baru melanjutkan dari `closingAtMs`; jika sudah lewat → langsung `RESOLVING` |
| Redis tidak tersedia saat `vote.cast` | `SERVICE_UNAVAILABLE`, klien retry dengan `clientEventId` sama |
| Ack hilang | Klien retry; server membalas hasil yang sama |
| Klien menampilkan vote optimistis yang ditolak | Rollback + toast "Suaramu gak kekirim, coba lagi" |

## 19. Acceptance criteria

| ID | Kriteria | Test |
|---|---|---|
| AC-P04-1 | 3 Strip vs 1 Grid menghasilkan `LOCKED PHOTO_STRIP` di semua klien | TC-VOTE-001 |
| AC-P04-2 | Hanya suara terakhir yang dihitung | TC-VOTE-002 |
| AC-P04-3 | Seri menghasilkan ronde ulang dengan opsi seri saja | TC-VOTE-003 |
| AC-P04-4 | Seri di ronde 2 menghasilkan hasil acak identik di semua klien + tercatat | TC-VOTE-004 |
| AC-P04-5 | Voting tidak tertutup sendiri selama > 5 menit tanpa syarat penutupan | TC-VOTE-005 |
| AC-P04-6 | Tutup vote sebelum mayoritas ditolak | TC-VOTE-006 |
| AC-P04-7 | Suara peserta `LEFT` dihapus | TC-VOTE-007 |
| AC-P04-8 | Perubahan mode setelah lock ditolak | TC-VOTE-008 |
| AC-P04-9 | Sesi baru dimulai dari `VOTING` | TC-VOTE-009 |
| AC-P04-10 | Peserta non-pembuat bisa memulai & menutup vote | TC-ROOM-010 (bagian voting) |

## 20. Checklist pengujian

- [ ] Unit: `resolveVotes` (tabel kasus), state machine voting & sesi
- [ ] Integrasi: handler voting + Redis + recovery timer
- [ ] E2E 4 konteks: TC-VOTE-001..009
- [ ] Axe-core SCR-06/07 (TC-A11Y-001 subset)
- [ ] Manual: review visual SCR-06 vs `03_Voting.webp` desktop & mobile (TC-UX-011 subset)
- [ ] Manual: voting dari HP nyata (iOS & Android) bersama desktop

Perintah verifikasi yang disarankan (dijalankan oleh/atas izin pengguna): `pnpm test --filter realtime -- voting`, `pnpm test:e2e -- voting`. Agen **tidak** menjalankan typecheck/lint/build/git penuh, commit, push, atau deploy tanpa instruksi eksplisit, dan **tidak** boleh mengarang hasil tes.

## 21. Definition of Done

- Semua checklist §15 tercentang dengan bukti (file & tes).
- AC-P04-1..10 terverifikasi; hasil tes tercatat dengan status nyata (`PASS`/`FAIL`/`NOT RUN`).
- Tidak ada timer penutup voting di kode atau UI.
- Default PROPOSED (DEC-023/024/025/063/081) berupa konfigurasi terpusat dan tercatat di handoff.
- Tidak ada mock yang menggantikan fungsi voting nyata.

## 22. Deliverable

- Modul domain voting & sesi + unit test.
- Handler actor + persistensi + recovery.
- UI SCR-06, SCR-07, banner ajakan sesi (dasar).
- Tes E2E voting.
- Handoff P04 terisi.

## 23. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Deadlock karena peserta AFK | Penutupan manual DEC-023 |
| Hasil acak dianggap tidak adil | Diumumkan jelas + tercatat di eventLog |
| Desain SCR-07 (DERIVED) ditolak | Review visual sebelum fase ditutup |
| Pemilik produk menginginkan timer (DEC-046) | Struktur `closingAtMs` sudah ada; tambahkan hanya setelah ada keputusan |

## 24. Handoff ke fase berikutnya

```text
HANDOFF P04 → P05
Completed work:
Modified components / files:
Technical decisions (sebutkan DEC yang masih PROPOSED):
Tests performed (ID, hasil, bukti):
Tests NOT yet performed:
Known issues:
Outstanding risks:
Readiness for P05 (YA/TIDAK + alasan):
```

P05 membutuhkan: transisi ke `STUDIO` stabil, `session.mode` terkunci dan bisa dibaca klien, serta struktur `studio` di `Session` tersedia (masih null).
