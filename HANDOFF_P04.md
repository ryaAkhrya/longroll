### Handoff P04 → P05

- **Status fase:** READY FOR REVIEW (semua gate otomatis lulus).
- **Keputusan dipakai:** DEC-023 (Tutup vote setelah mayoritas ketat, jendela 5 s), DEC-046 (TANPA timer penutup otomatis — kartu "Sisa waktu" di mockup sengaja tidak dibuat), DEC-081 (hasil 3 s lalu masuk studio otomatis).
- **Pekerjaan selesai:**
  - Shared `session.ts`: `Mode` (tepat 4), `SessionView`, `VotingView`, `resolveVotes`, `canCloseVoting`, `everyoneVoted`, `SESSION_CONFIG` (konfigurasi terpusat).
  - Server `sessionLogic.ts`: `session.create` (siapa pun; hanya bila sesi aktif FINAL/CLOSED; batas 20 sesi), `vote.cast` (ganti suara, idempoten), `vote.close` (hanya bila suara > 50% CONNECTED; idempoten), auto-resolve saat semua CONNECTED memilih, satu ronde ulang hanya untuk opsi seri, seri lagi → `crypto.randomInt` (dicatat `RANDOM_PICK` di `eventLog`), lock mode sekali tulis (`MODE_LOCKED` setelahnya).
  - Peserta LEFT → suaranya dihapus & tally dihitung ulang; RECONNECTING tidak ditunggu, suaranya tetap dihitung.
  - Timer CLOSING disimpan sebagai `closingAtMs` → dilanjutkan setelah restart.
  - Commit-before-ack, dedupe `clientEventId`, event `session.state`/`session.invite`/`vote.resolved` lewat ring buffer (replay saat resume).
  - UI: SCR-06 Voting (radiogroup, keyboard panah, avatar pemilih, progres, status "Nunggu …", ronde seri), SCR-07 hasil (bar, gembok, koin untuk acak, reduced-motion), stepper sesi di header, studio dasar (grid kamera, mode terkunci, shutter nonaktif "Cekrek hadir di tahap berikutnya").
- **Migrasi:** `db/migrations/0003_p04_sessions.sql` (`lr_sessions` + constraint + GRANT ke `longroll_app`) diterapkan di Neon `development` saja.
- **Tes:**

| Tes | Hasil |
|---|---|
| Unit shared (tabel `resolveVotes`, ambang mayoritas) | 16 |
| Unit realtime (AC-P04-1..10, restart CLOSING, tanpa timer > 5 menit, dedupe) | 51 |
| Unit web | 21 |
| Integrasi (WS 4 peserta suara bersamaan, Tutup awal ditolak, `MODE_LOCKED`; PostgreSQL Neon dev: sesi tersimpan/termuat/terhapus) | 16/16 |
| E2E Chrome 4 konteks (bukan pembuat memulai, suara realtime, reload saat voting, Tutup vote + ganti suara di jendela 5 s, hasil identik, studio otomatis, reload di studio) + regresi P02/P03 | 5/5 |
| Typecheck / lint / build | lulus |

- **BELUM / NOT VERIFIED:** perangkat fisik & Safari/Firefox; ronde seri & acak hanya diuji di unit/integrasi (tidak di E2E).
- **Untuk P05:** `deps.studioInit` dipanggil saat lock; `StudioScreen` menyediakan slot `rail/side/center/summary/mobileTools/overlay`.
