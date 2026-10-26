# P06 — Synchronized Capture & Individual Retake

| Atribut | Nilai |
|---|---|
| Dokumen | `PHASES/P06_CAPTURE_RETAKE.md` |
| Versi | 1.1.0 |
| Status fase | NOT STARTED |
| Bergantung pada | P05 (studio, BindingPlan untuk kedua strategi, kunci struktur), P03 (track kamera lokal), P02 (actor, Redis, storage) |
| Dokumen wajib dibaca | [09_CAMERA_CAPTURE_RETAKE.md](../09_CAMERA_CAPTURE_RETAKE.md) §7–§12, [14_DATA_MODEL_AND_EVENTS.md](../14_DATA_MODEL_AND_EVENTS.md) §7–§8, [04_SCREEN_SPECIFICATIONS.md](../04_SCREEN_SPECIFICATIONS.md) (SCR-13..15, SCR-20), [15_SECURITY_PRIVACY_LIFECYCLE.md](../15_SECURITY_PRIVACY_LIFECYCLE.md) §7–§8, [18](../18_DECISIONS_AND_OPEN_QUESTIONS.md) |

---

## 1. Identitas & tujuan fase

P06 membangun **fitur inti LONGROLL**: capture tersinkron dan accept/retake individual. Hasil fase: peserta bisa memulai countdown bersama, setiap klien mengambil foto resolusi penuh dari kameranya sendiri pada T0 yang sama, lalu setiap peserta memutuskan **Pakai ini** atau **Ulang** untuk fotonya sendiri. Retake satu peserta terlihat oleh peserta lain dan **tidak pernah** mengubah foto accepted peserta lain. Sesi maju antar shot sampai shot terakhir selesai, lalu masuk `EDITING`.

> **Invariant fase (wajib):** `acceptedAttemptId` untuk `(shot, peserta)` hanya diubah oleh aksi peserta itu sendiri lewat **satu fungsi mutasi**. Tidak ada timer yang menyetel `ACCEPTED`.

## 2. Prasyarat & dependensi

| Prasyarat | Sumber |
|---|---|
| BindingPlan + `bindingStrategy` terkunci per sesi | DEC-087 (dari P05). DEC-061 boleh tetap OPEN: capture bekerja per photo cell `(shotIndex, participantId)` dan identik untuk kedua strategi (09 §6) |
| Kunci struktur setelah shot 1 | DEC-065 (mekanisme dari P05) |
| `cameraPresentation` + cermin | P05, DEC-049, DEC-064 |
| Object storage privat + presigned PUT/GET | P02/P05 |
| Keputusan capture | DEC-026, DEC-027, DEC-028, DEC-029, DEC-035, DEC-068, DEC-069, DEC-072, DEC-074, DEC-079, DEC-080 (default PROPOSED boleh dipakai sebagai konfigurasi) |

## 3. Kondisi awal yang diharapkan

- Studio menampilkan feed live di slot; frame/layout tersinkron.
- Shutter, segmen timer, `Siap x/4` masih nonaktif/placeholder.
- Sesi berhenti di `STUDIO`; state `CAPTURING`/`EDITING` masih stub dari P04.

## 4. Requirement dalam scope

- Sinkronisasi jam klien–server (DEC-074).
- Status "Siap" otomatis + "Bentar" (DEC-069).
- `shot.arm` oleh siapa pun, konfirmasi jika ada yang belum siap, **Tunggu!** oleh siapa pun sebelum T0 (DEC-026), durasi 3/5/10 detik bersama (DEC-027).
- Capture frame lokal resolusi penuh pada T0 dengan framing & cermin (09 §7.3, DEC-035, DEC-064, DEC-072).
- Upload preview + full via signed PUT, verifikasi `HEAD` (09 §7.2).
- State per peserta per shot dan state shot (09 §8).
- Accept, retake (countdown individual), ganti pilihan sebelum shot maju (DEC-079), colek (DEC-080, P2).
- Visibilitas retake: thumbnail attempt ditolak + feed live + countdown retake (09 §9.3).
- Maju ke shot berikutnya sesuai DEC-028, termasuk "Lanjut tanpa dia" dan "Ambil fotomu" untuk peserta `MISSING`.
- Penghapusan attempt `REJECTED` saat shot `DONE` (DEC-029).
- Kunci struktur saat shot pertama di-arm (DEC-065).
- Transisi shot terakhir → `EDITING` (editor dibangun P07; fase ini cukup sampai state & layar transisi).
- Reaksi ephemeral (DEC-048, P2, opsional).

## 5. Di luar scope (eksplisit)

- **Auto-accept berbasis timer dalam bentuk apa pun** (REQ-CAP-09, DEC-091 REJECTED). Termasuk teks "diem = Pakai ini", progress ring keputusan, atau default accept saat putus.
- Editor & dokumen Yjs (P07).
- Galeri, render export (P08).
- `ImageCapture.takePhoto()` khusus platform (boleh dievaluasi; jika dipakai → usulkan sebagai DEC baru di 18).
- Pengisian shot `SKIPPED` belakangan (OPEN di DEC-028).
- Suara shutter.

## 6. ID requirement terkait

REQ-CAP-01..10, REQ-CAM-07, REQ-CAM-11, REQ-FRAME-05 (kunci), REQ-LIFE-02, REQ-MOB-05, REQ-MOB-11, NFR-02, NFR-06, NFR-12 (sumber foto). Keputusan: DEC-005, DEC-006, DEC-007, DEC-021, DEC-026..029, DEC-035, DEC-048, DEC-064, DEC-065, DEC-068, DEC-069, DEC-072, DEC-074, DEC-079, DEC-080, DEC-085.

## 7. Referensi dokumentasi

- [09_CAMERA_CAPTURE_RETAKE.md](../09_CAMERA_CAPTURE_RETAKE.md) §7–§12 (sumber utama)
- [14_DATA_MODEL_AND_EVENTS.md](../14_DATA_MODEL_AND_EVENTS.md) §7, §8, §11
- [03_USER_FLOWS.md](../03_USER_FLOWS.md) F-10..F-13, F-17
- [07_ROOM_AND_MULTIPLAYER.md](../07_ROOM_AND_MULTIPLAYER.md) §13
- [13_SYSTEM_ARCHITECTURE.md](../13_SYSTEM_ARCHITECTURE.md) §7, §8, §12
- [17_QA_TEST_PLAN.md](../17_QA_TEST_PLAN.md) §6.5, §7

## 8. Referensi visual yang disetujui

| Layar | File |
|---|---|
| SCR-14 desktop/mobile | `02_Desktop/06_Accept_Retake.webp`, `03_Mobile/06_Accept_Retake.webp` |
| SCR-08 (bar bawah, shutter, segmen timer) | `02_Desktop/04_Live_Photobooth.webp`, `03_Mobile/04_Live_Photobooth.webp` |
| SCR-13, SCR-15, SCR-20 | DERIVED (04): wajib review visual |

## 9. Tugas implementasi fungsional

1. **Siap:** badge `✓ Siap` otomatis saat kamera live dan tab terlihat; tombol "Bentar" menandai belum siap. `Siap x/4` di bar bawah.
2. **Shutter:** siapa pun menekan. Jika ada peserta wajib belum siap → konfirmasi "n orang belum siap — tetap mulai?".
3. **Countdown (SCR-13):** angka besar di lingkaran glass, teks aksen, caption "Dimulai sama {nama} · shot n dari m", tombol **Tunggu!**. **Tunggu!** sebelum T0 membatalkan untuk semua dengan pesan "{nama} nahan dulu".
4. **T0:** flash ringan (atau fade saat reduced motion), lalu "Nyimpen foto…" per kartu sampai upload selesai.
5. **SCR-14:** foto sendiri besar dengan **Ulang** dan **Pakai ini**, caption "Gak ada batas waktu. Temen-temen lihat kalau kamu ngulang." Peserta lain tampil di kartu dengan status.
6. **Ulang:** attempt sendiri jadi `REJECTED`, countdown **hanya** untuk peserta itu, attempt baru. Peserta lain melihat thumbnail "✕ Take n · diulang", feed live, countdown retake, chip "Ngulang · percobaan n". Foto mereka sendiri tidak berubah.
7. **Pakai ini:** status `ACCEPTED`; "Ganti pilihanku" tersedia sampai shot maju (DEC-079).
8. **SCR-15:** setelah accept, "Kamu udah oke. *Nunggu {nama}…*", daftar status, aksi **Colek**.
9. **Putus:** peserta wajib putus → kartu "Nyambung lagi…"; setelah 15 detik siapa pun bisa **Lanjut tanpa {nama}** (`SKIPPED`). Peserta `MISSING` yang kembali sebelum shot maju mendapat "Ambil fotomu".
10. **Maju shot:** semua wajib `ACCEPTED/SKIPPED` → banner "Shot n beres! Lanjut shot n+1." → kembali ke studio; slot shot selesai menampilkan foto accepted.
11. Shot terakhir selesai → sesi `EDITING` → layar transisi ke editor (P07).

## 10. Tugas implementasi teknis

| Area | Tugas | Lokasi (PROPOSED) |
|---|---|---|
| Waktu | `ClockSync`: 5 sampel ping-pong, median, buang rtt > 2× median, refresh 30 detik & saat `visibilitychange` | `web/src/realtime/clock.ts` |
| Domain | State machine `Shot` & `ShotParticipantState` (09 §8.2, §8.3) sebagai reducer murni | `shared/src/capture/machine.ts` |
| Domain | **Satu-satunya** fungsi mutasi `setAccepted(shot, participantId, attemptId, actorId)` (09 §9.4); tidak ada jalur lain yang menulis `acceptedAttemptId` | `realtime/src/domain/capture.ts` |
| Actor | Handler `shot.arm`, `shot.hold`, `attempt.prepare`, `attempt.uploaded`, `capture.accept`, `capture.retake`, `capture.reopen`, `shot.skip`, `nudge` dengan error 14 §7 | `realtime/src/room/handlers/capture.ts` |
| Actor | Hitung `required[]` saat T0; timer 15 detik untuk skip; `retakeT0ServerMs` | Sama |
| Persistensi | Commit ke Redis sebelum ack untuk arm, accept, retake, ready, skip, done | Room store |
| Storage | Presign PUT terikat key `rooms/{roomId}/attempts/{attemptId}/{preview\|full}.jpg`, content-type `image/jpeg`, maks 8 MB / 400 KB; `HEAD` saat `attempt.uploaded`; batas room DEC-085 | `realtime/src/storage/` |
| Cleanup | Saat shot `DONE`: hapus objek semua attempt `REJECTED` shot itu + hapus dari indeks aset | `realtime/src/domain/capture.ts` |
| Klien capture | `captureFrame()` dengan `requestVideoFrameCallback` (fallback rAF), `OffscreenCanvas`, framing & cermin, encode JPEG 0.92 + preview ≤ 640 px 0.8 | `web/src/features/capture/captureFrame.ts` |
| Klien upload | Upload preview dulu lalu full; retry 3× backoff 1/2/4 detik; kompres ulang 0.85 bila ditolak ukuran | `web/src/features/capture/upload.ts` |
| Klien UI | `Shutter`, `CountdownOverlay`, `HoldButton`, `ReviewSelf`, `ReviewOthers`, `RetakeCard`, `WaitingPanel`, `SkipButton` | `web/src/features/capture/` |
| Kunci struktur | `shot.arm` pertama mengunci struktur layout (`STRUCTURE_LOCKED`) | Studio handler |
| Metrik | `capture_skew_ms`, `attempt_upload_ms`, `attempt_upload_failures_total` (13 §12) | Observability |

## 11. Dependensi data model & event

- Model: `Shot`, `ShotParticipantState`, `Attempt`, `TempAsset` (14 §7, §11).
- Event: `shot.arm`, `shot.countdown`, `shot.hold`, `shot.cancelled`, `attempt.prepare`, `attempt.prepared`, `attempt.uploaded`, `attempt.ready`, `capture.accept`, `capture.retake`, `capture.reopen`, `retake.started`, `shot.participant`, `shot.skip`, `nudge`, `shot.done`, `session.state`, `time.ping`/`time.pong`.
- Error: `ALREADY_ARMED`, `TOO_LATE`, `CONFIRM_REQUIRED`, `NOT_IN_STUDIO`, `NOT_REQUIRED`, `SHOT_DONE`, `ATTEMPT_REJECTED`, `UPLOAD_MISMATCH`, `SKIP_NOT_ALLOWED`, `FORBIDDEN_NOT_OWNER`, `STRUCTURE_LOCKED`, `ROOM_STORAGE_LIMIT`, `RATE_LIMITED`.
- Idempotensi: `clientEventId`; `attempt.uploaded` idempoten pada `(attemptId, part, sha256)` (14 §8.1).

## 12. Requirement UI/UX

- Tombol **Pakai ini** lebih lebar dari **Ulang**; stage primary putih (05 §5).
- **Dilarang** ada timer, progress ring, atau teks yang menyiratkan foto akan diterima otomatis (04 SCR-14 "Larangan").
- Thumbnail attempt ditolak berlabel `✕ Take n · diulang`, hanya terlihat selama shot aktif.
- Countdown: angka `.dc`, pengumuman aria-live untuk 3 detik terakhir.
- Konfirmasi "belum siap" sebagai modal desktop / sheet mobile.
- Shortcut desktop: `Space` shutter, `Esc` Tunggu! (04 SCR-08).
- Reaksi (jika dibangun) tidak boleh menutupi foto.

## 13. Pertimbangan desktop & mobile

| Aspek | Desktop | Mobile |
|---|---|---|
| Shutter | 70 px di bar bawah | 76 px di dock, zona jempol |
| Pakai/Ulang | Kolom kiri 540 px | Tombol 56 px di bawah |
| Peserta lain | Kartu kanan (retake lebih besar) | Baris kartu ringkas di bawah foto sendiri |
| Tunggu! | Tombol di bar bawah | Tombol penuh lebar |
| Background tab | — | Kamera off saat background; peserta jadi `MISSING` jika T0 terlewat (09 §11) |
| Capture iOS | — | Frame dari `<video>` pada resolusi track (06 §9) |

## 14. Pertimbangan keamanan & privasi

Sesuai 15 §14 baris P06:

- `capture.accept`/`retake`/`reopen` divalidasi `actor == ownerId` (REQ-CAP-10, TC-SEC-014).
- Presigned PUT dibatasi key, content-type, dan ukuran; GET preview TTL ≤ 10 menit; bucket privat (TC-SEC-018).
- Attempt `REJECTED` dihapus saat shot `DONE` (DEC-029, TC-CAP-017) dan tidak pernah masuk galeri.
- Semua objek attempt masuk indeks aset room untuk cleanup (15 §8).
- Batas storage room (DEC-085).
- Metadata attempt tanpa EXIF/lokasi (foto dibuat dari canvas).
- Log tanpa signed URL atau display name (NFR-09).

## 15. Checklist tugas detail

- [ ] `ClockSync` + unit test offset
- [ ] Reducer state machine shot & peserta + tes transisi ilegal
- [ ] Fungsi tunggal `setAccepted` + tes properti "acceptedAttemptId peserta lain tidak berubah oleh event apa pun selain aksi pemiliknya"
- [ ] **Item code review wajib:** grep/review membuktikan tidak ada penulisan `acceptedAttemptId` di luar `setAccepted`
- [ ] Handler arm/hold dengan aturan waktu (`TOO_LATE`)
- [ ] Konfirmasi belum siap (`CONFIRM_REQUIRED`)
- [ ] `captureFrame` dengan framing & cermin + tes visual sederhana
- [ ] Upload preview & full + retry + `HEAD` verifikasi
- [ ] Accept, retake (countdown individual), reopen, colek
- [ ] Visibilitas retake (`retake.started` + UI)
- [ ] Peserta wajib putus: tunggu, skip setelah 15 detik, makeup capture
- [ ] Maju shot otomatis + banner + foto accepted di slot
- [ ] Hapus attempt `REJECTED` saat `DONE`
- [ ] Kunci struktur saat shot pertama di-arm
- [ ] Transisi ke `EDITING`
- [ ] Metrik skew & upload
- [ ] UI SCR-13, SCR-14, SCR-15, SCR-20 desktop & mobile
- [ ] Tes §20, termasuk **uji perangkat nyata**
- [ ] Handoff §24

## 16. Checkpoint integrasi

- **IC-4:** capture → storage → accept/retake → shot berikutnya → masuk `EDITING`, dengan 4 konteks Playwright dan dengan 4 perangkat nyata.
- Reconnect di tengah `REVIEW` mengembalikan status & foto accepted (TC-ROOM-020).
- Room di-expire setelah capture: semua objek attempt terhapus (TC-SEC-030).

## 17. Edge case

Semua SY-01..SY-10 di 09 §12 wajib ditangani dan diuji, plus:

| Kasus | Perilaku | Ref |
|---|---|---|
| EC-05 peserta putus saat countdown | `MISSING` untuk shot itu; peserta lain tetap capture | 09 §10.1 |
| EC-06 retake berkali-kali | Tanpa batas; semua attempt ditolak terlihat selama shot aktif | DEC-029 |
| EC-07 peserta tidak pernah accept | Shot tidak maju; status "Lagi milih…"; Colek tersedia; **tanpa auto-accept** | REQ-CAP-09 |
| EC-12 peserta tanpa kamera | `NOT_REQUIRED`; tidak menghalangi maju | DEC-068 |
| Join terlambat saat `CAPTURING` | Bukan peserta wajib sesi ini | DEC-030 |
| Hold slot habis saat shot berjalan | Dikeluarkan dari `required[]` | 09 §10.1 |
| Strategi grup per shot vs foto per orang | Alur capture/accept/retake sama; yang berbeda hanya slot tempat foto accepted tampil (`CELL` vs sub-tile `SHOT_GROUP`) | 10 §5 |
| Batas storage room tercapai | `ROOM_STORAGE_LIMIT` + pesan | DEC-085 |

## 18. Skenario kegagalan

| Kegagalan | Penanganan |
|---|---|
| Upload gagal 3× | `FAILED` + **Coba lagi**; peserta lain melihat "Fotonya gagal kekirim, nyoba lagi…" |
| Storage lambat | Preview duluan agar keputusan bisa dimulai; full menyusul (accept menunggu full `READY`) |
| Instance mati saat `COUNTDOWN` | Actor baru: jika `t0ServerMs` sudah lewat → `REVIEW` dengan attempt yang tersedia; peserta tanpa attempt → `MISSING` |
| Redis down | Event kritis ditolak `SERVICE_UNAVAILABLE`; klien retry; capture lokal disimpan di memori sampai bisa upload |
| Klien crash sebelum upload | Kembali sebagai `MISSING`/`FAILED` → "Ambil fotomu" |
| Offset jam melonjak | Re-sync sebelum menampilkan countdown (SY-04) |

## 19. Acceptance criteria

| ID | Kriteria | Test |
|---|---|---|
| AC-P06-1 | Skew capture p95 ≤ 150 ms (K1, K2) | TC-CAP-001 |
| AC-P06-2 | Tunggu! sebelum T0 membatalkan; setelah T0 ditolak | TC-CAP-002, TC-CAP-003 |
| AC-P06-3 | Konfirmasi muncul jika ada yang belum siap | TC-CAP-004 |
| AC-P06-4 | **Retake independen**: foto accepted 3 peserta lain identik byte & `acceptedAttemptId` sebelum/sesudah 3× retake; tidak ada countdown di klien mereka. Diverifikasi otomatis **dan** dengan perangkat nyata | TC-CAP-010 |
| AC-P06-5 | Retake terlihat oleh peserta lain | TC-CAP-011 |
| AC-P06-6 | Accept/retake attempt orang lain ditolak | TC-CAP-012, TC-SEC-014 |
| AC-P06-7 | Shot maju hanya saat syarat DEC-028 terpenuhi; skip hanya setelah 15 detik | TC-CAP-013, TC-CAP-014 |
| AC-P06-8 | Diam 10 menit tidak mengubah status ke `ACCEPTED` | TC-CAP-015 |
| AC-P06-9 | Upload gagal ditangani tanpa hang | TC-CAP-016 |
| AC-P06-10 | Attempt `REJECTED` terhapus saat shot `DONE` | TC-CAP-017 |
| AC-P06-11 | Ganti pilihan tidak menghilangkan foto | TC-CAP-018 |
| AC-P06-12 | Struktur layout terkunci setelah shot pertama | TC-FRAME-004 |
| AC-P06-13 | Alur penuh 4 peserta dengan 2 retake dari peserta berbeda | TC-E2E-001 |
| AC-P06-14 | Putus saat countdown lalu kembali saat review | TC-E2E-003 |

## 20. Checklist pengujian

- [ ] Unit: reducer shot/peserta (semua transisi 09 §8.2), `setAccepted`, `ClockSync`, aturan `required[]`
- [ ] Tes properti/fuzz: urutan acak event dari 4 peserta tidak pernah mengubah `acceptedAttemptId` peserta lain
- [ ] Integrasi: handler capture + Redis + minio (upload, HEAD, penghapusan REJECTED)
- [ ] E2E 4 konteks media palsu: TC-CAP-002..004, 010..018, TC-FRAME-004
- [ ] **Perangkat nyata (wajib, multi-peserta):** TC-CAP-001 dan TC-CAP-010 di kombinasi K2 (desktop + Safari macOS + iPhone + Android); TC-E2E-001 di K2; TC-E2E-003 di K4
- [ ] Axe-core SCR-13/14/15 + keyboard (`Space`/`Esc`)
- [ ] Review visual SCR-14 vs V1, SCR-13/15/20 (DERIVED)

Perintah verifikasi yang disarankan (dijalankan oleh/atas izin pengguna): `pnpm test --filter shared -- capture`, `pnpm test --filter realtime -- capture`, `pnpm test:integration -- capture`, `pnpm test:e2e -- capture`. Agen tidak menjalankan typecheck/lint/build/git penuh, commit, push, atau deploy tanpa instruksi eksplisit. Hasil uji perangkat nyata dicatat dengan nama penguji, perangkat, OS/browser, dan waktu. **Tidak boleh mengarang hasil tes.**

## 21. Definition of Done

- Checklist §15 lengkap dengan bukti; AC-P06-1..14 terverifikasi dengan status nyata.
- **TC-CAP-010 lulus di perangkat nyata dengan ≥ 4 peserta** (bukan hanya media palsu).
- Bukti code review bahwa `acceptedAttemptId` hanya ditulis oleh `setAccepted`.
- Tidak ada auto-accept, timer keputusan, atau teks yang menyiratkannya di kode/UI.
- Attempt `REJECTED` terhapus dari storage saat shot `DONE`.
- Default PROPOSED (DEC-026..029, 069, 079, 080) berupa konfigurasi dan tercatat di handoff.

## 22. Deliverable

- Modul capture (clock sync, state machine, actor handler, storage, cleanup per shot).
- UI SCR-13, SCR-14, SCR-15, SCR-20 desktop & mobile.
- Metrik capture.
- Laporan uji perangkat nyata.
- Handoff P06.

## 23. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| RK-02 skew > target | Clock sync, `requestVideoFrameCallback`, ukur `capture_skew_ms`, flag `late` |
| RK-01 upload HP lambat | Preview duluan, kompres ulang, retry |
| RK-10 perilaku kamera beda per browser | Matriks perangkat sejak awal fase |
| Regresi invariant accept | Fungsi tunggal + tes properti + item code review |
| Deadlock shot karena AFK | Colek + "Lanjut tanpa dia" (hanya untuk peserta putus, bukan yang diam) |
| Pemilik produk ingin aturan lain untuk peserta diam | Jangan auto-accept → usulkan sebagai DEC baru di 18 |

## 24. Handoff ke fase berikutnya

```text
HANDOFF P06 → P07
Completed work:
Modified components / files:
Technical decisions (DEC yang masih PROPOSED, pengaturan default):
Tests performed (ID, hasil, bukti, perangkat, penguji, tanggal):
Tests NOT yet performed:
Known issues:
Outstanding risks:
Readiness for P07 (YA/TIDAK + alasan):
```

P07 membutuhkan: sesi dalam `EDITING` dengan daftar foto accepted per `(shot, peserta)` + `Shot.slotOf` + BindingPlan terkunci, URL preview ≤ 1600 px yang bisa diminta via `asset.urls`, dan jaminan bahwa daftar accepted tidak berubah setelah shot `DONE`.
