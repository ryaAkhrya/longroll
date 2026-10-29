### Handoff P06 → P07

**Status:** selesai untuk gate non-browser (typecheck, lint, unit, integrasi + Neon dev, build). **Browser E2E TIDAK dijalankan (diminta) → semua kriteria yang butuh browser = NOT VERIFIED.**

**Audit awal:** saat sesi ini mulai, satu-satunya jejak P06 di working tree adalah tipe `packages/shared/src/capture` yang ditulis sesi ini (tidak ada migrasi/handler/UI P06 dari sesi lain). Tidak ada yang ditimpa.

#### Implemented
- **Shared:** `capture/` (tipe Shot/Attempt, `CAPTURE_CONFIG` terpusat, `computeClockOffset` median + buang rtt>2×median, `captureCrop` framing+cermin skala seragam, `acceptedForCell`, `publicCapture`); `studio.countdownSec` 3/5/10 bersama.
- **Server (`apps/realtime/src/room/captureLogic.ts`):**
  - Mesin state shot (IDLE→COUNTDOWN→REVIEW→DONE) dan peserta (PENDING…FAILED); `shot.arm` / `hold` / `attempt.prepare` / `uploaded` / `fail` / `capture.accept` / `retake` / `reopen` / `shot.skip` / `nudge`.
  - **`setAccepted` = satu-satunya penulis `acceptedAttemptId`** (aktor wajib pemilik); tidak ada timer/cleanup/reconnect yang menulisnya (grep: hanya 1 penulisan di `captureLogic.ts`).
  - `required` dihitung saat arm (terhubung + kamera live + peserta sesi, DEC-030); CONFIRM_REQUIRED; T0 timer dilanjutkan dari `t0ServerMs` setelah restart; retake timer per peserta; skip hanya ≥15 s putus (RECONNECTING); LEFT keluar dari `required`.
  - Shot pertama di-arm → struktur terkunci (`structureLocked`) + sesi `CAPTURING`; shot terakhir DONE → `EDITING`.
  - Upload: URL PUT bertanda tangan terikat key/Content-Type/ukuran; `attempt.uploaded` diverifikasi DI LUAR antrean actor (objek ada, ukuran, sha256, magic bytes JPEG, decode aman + batas piksel, dimensi), lalu **re-encode tanpa EXIF/GPS** menimpa objek; idempoten (attemptId, part, sha256). Preview → DECIDING; full → READY; accept menunggu READY.
  - Purge attempt non-pilihan saat shot DONE (retry oleh sweeper bila gagal); kuota 1 GB/room (`ROOM_STORAGE_LIMIT`); maks 60 attempt/peserta/shot.
  - HTTP: `GET /api/rooms/{code}/attempts/{id}/url?part=` (preview semua peserta room; full hanya pemilik atau accepted di shot DONE; room lain 401/404).
- **Web:** `ClockSync` (5 sampel, tiap 30 s + `visibilitychange`), `captureFrame` (frame asli dari `<video>` MediaStream pada T0 via `requestVideoFrameCallback`, framing/cermin/filter pemilik, JPEG 0.92 + preview ≤640 px), `upload` (preview→full, retry 3× 1/2/4 s, kompres ulang 0.85, presign ulang bila URL kedaluwarsa), `useCapture` (siap otomatis + "Bentar", jadwal capture, SY-03 buang bila dibatalkan), SCR-13 `CountdownOverlay`, SCR-14/15 `ReviewScreen`, konfirmasi belum siap (modal/sheet), shutter nyata + Space/Esc, banner "Shot n beres", foto accepted menggantikan feed live di slot, `EditingEntry` (transisi; digantikan P07).

#### Neon
- `0005_p06_capture.sql` (kolom `lr_sessions.capture jsonb` + check) diterapkan di `development` (project `hidden-glade-82216110`, branch `br-quiet-dust-azdjpq7u`, diverifikasi sebelum menerapkan). `longroll_app` tetap SELECT/INSERT/UPDATE (cukup). Production tidak disentuh.

#### Tests (nyata, non-browser)
| Tes | Hasil |
|---|---|
| Unit shared (jam, crop, helper) | 65 (7 baru) |
| Unit realtime (`capture.test.ts` 26: arm/hold/T0, verifikasi upload, **invarian retake**, otorisasi, 10 menit tanpa auto-accept, skip/putus/MISSING, restart COUNTDOWN & REVIEW, purge+retry, **fuzz 7 seed**) | 94 total |
| Unit web (countdown, review tanpa auto-accept, upload retry/413/stale) | 31 total |
| Integrasi HTTP+WS+storage (`capture.test.ts` 3: 4 klien satu T0, retake A 3× → B/C/D byte & acceptedAttemptId identik, rejected dihapus, otorisasi, room bubar) + Neon dev (`postgres.capture.test.ts`) | 26 total |
| Typecheck / lint / build | lulus |

**Independent Retake Invariant — VERIFIED (unit + integrasi + fuzz)**: B/C/D: `acceptedAttemptId` sama, byte preview/full di storage identik (sha256), tanpa `retake.started` untuk diri sendiri, `retakeT0ServerMs` null, JSON state per-peserta tidak berubah.

#### NOT VERIFIED
- AC-P06-1 skew p95 ≤150 ms (butuh browser/perangkat nyata; server hanya menjamin satu `t0ServerMs`).
- AC-P06-13/14 versi E2E 4 konteks, TC-CAP-010 di perangkat nyata, axe-core SCR-13/14/15, review visual, background-tab di iOS.
- Storage cloud: Neon Object Storage aktif di branch dev tetapi bucket/kredensial belum dibuat (tidak dibuat otomatis); dev/tes memakai storage memori/folder, adapter S3 teruji hanya lewat antarmuka yang sama (belum ke bucket nyata). **Tidak production-ready untuk upload.**

#### Keputusan & default (konfigurasi `CAPTURE_CONFIG`)
DEC-026/027/028/029/069/072/079/080/085 default PROPOSED; DEC-061 tetap OPEN. Ready = flag `ready` presence (auto saat kamera live & tab terlihat). `capture.retake` tanpa `attemptId` = "Ambil fotomu"/"Coba lagi". Endpoint URL attempt via HTTP (bukan WS `asset.urls`).

#### Untuk P07
Sesi `EDITING` berisi `capture.shots[].perParticipant[pid].acceptedAttemptId` (+ `slotOf`, BindingPlan terkunci); URL foto via `/attempts/{id}/url?part=full|preview`; daftar accepted tidak berubah setelah shot DONE (mutasi capture ditolak `NOT_IN_STUDIO`).
