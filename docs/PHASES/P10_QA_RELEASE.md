# P10 — Complete QA & Production Release

| Atribut | Nilai |
|---|---|
| Dokumen | `PHASES/P10_QA_RELEASE.md` |
| Versi | 1.1.0 |
| Status fase | NOT STARTED |
| Bergantung pada | P09 (hardening selesai, semua TC-SEC P0 PASS) dan seluruh fase P01–P08 |
| Dokumen wajib dibaca | [17_QA_TEST_PLAN.md](../17_QA_TEST_PLAN.md), [16_IMPLEMENTATION_ROADMAP.md](../16_IMPLEMENTATION_ROADMAP.md) §6–§8, [13_SYSTEM_ARCHITECTURE.md](../13_SYSTEM_ARCHITECTURE.md) §10–§13, [15_SECURITY_PRIVACY_LIFECYCLE.md](../15_SECURITY_PRIVACY_LIFECYCLE.md) §8.4, §11, [18_DECISIONS_AND_OPEN_QUESTIONS.md](../18_DECISIONS_AND_OPEN_QUESTIONS.md), handoff P01–P09 |

## 1. Identitas & tujuan fase

Memverifikasi seluruh produk end-to-end di perangkat dan jaringan nyata, menyiapkan deploy produksi, dan menyerahkan produk dalam kondisi siap rilis: **M4 — Siap rilis**.

> Pengujian **bukan baru dimulai di P10.** Setiap fase sudah wajib menambah dan menjalankan tesnya sendiri (17 §2). P10 menjalankan seluruh rangkaian, mengisi celah, menguji kombinasi perangkat penuh, dan membuktikan kesiapan rilis.

> Deploy produksi **hanya** dilakukan setelah persetujuan eksplisit pengguna/pemilik produk. Agen menyiapkan semua langkah, tapi tidak menjalankannya sendiri.

## 2. Prasyarat & dependensi

| Prasyarat | Sumber |
|---|---|
| Handoff P09: semua TC-SEC P0 PASS, cleanup terverifikasi di staging, runbook insiden | P09 |
| Tidak ada OPEN QUESTION 🔴 tersisa (DEC-055, DEC-061, DEC-076 terjawab) | 18 §5 |
| DEC-020 (grace period) final | 18 |
| DEC-066: ≥ 24 frame bawaan untuk rilis publik | 18 |
| Perangkat uji untuk K1–K4 tersedia | 17 §5 |
| Lingkungan produksi tersedia (akun provider, domain, TLS, OAuth produksi) | 13 §10 |
| Pemilik produk menunjuk reviewer visual & approver rilis | 00 §7 |

## 3. Kondisi awal yang diharapkan

- Semua fitur P01–P08 lengkap dan sudah dihardening di P09.
- Ada laporan tes per fase, tapi matriks traceability (17 §10) belum terisi penuh dengan bukti.
- Staging berjalan; produksi belum menerima trafik pengguna.

## 4. Requirement dalam scope

1. Eksekusi seluruh rangkaian tes 17 §6 dan skenario 4 peserta 17 §7.
2. Pengujian 4 peserta nyata pada kombinasi perangkat K1, K2, K3, K4 (17 §5).
3. Lintas browser sesuai DEC-050 (TC-XB-001).
4. Regresi: semua P0 otomatis + TC-E2E-001 di K2 (17 §8); tes visual 16 layar terhadap V1.
5. Verifikasi ulang keamanan: semua TC-SEC dijalankan ulang di build kandidat rilis.
6. Verifikasi performa: NFR-01, NFR-02, NFR-05, NFR-11, NFR-12 dengan data nyata.
7. Usability: TC-UX-010; review visual TC-UX-011.
8. Aksesibilitas: TC-A11Y-001..004.
9. Persiapan produksi: konfigurasi, OAuth Google produksi, lifecycle bucket, alarm, runbook, rollback plan.
10. Estimasi biaya per 1.000 sesi dari data uji (NFR-10, 13 §11).
11. Checklist kesiapan rilis 16 §6 lengkap dengan bukti.
12. Handoff final.

## 5. Di luar scope (eksplisit)

- Fitur baru atau perubahan desain. Temuan yang butuh fitur baru → usulkan sebagai DEC baru di 18.
- Refactor besar yang tidak terkait bug rilis.
- Deploy produksi tanpa persetujuan eksplisit.
- Item DEFERRED (DEC-095..DEC-098).
- Mengubah requirement CONFIRMED untuk "meloloskan" tes.

## 6. ID requirement terkait

Semua requirement P0 dan P1 di [02_PRODUCT_REQUIREMENTS.md](../02_PRODUCT_REQUIREMENTS.md): REQ-ROOM-01..13, REQ-LIFE-01..07, REQ-VOTE-01..08, REQ-CAM-01..13, REQ-FRAME-01..15, REQ-CAP-01..10, REQ-EDIT-01..14, REQ-GAL-01..08, REQ-EXP-01..05, REQ-MOB-01..12, REQ-UI-01..04, NFR-01..12. Keputusan yang harus final: DEC-020, DEC-055, DEC-061, DEC-066, DEC-073, DEC-076.

## 7. Referensi dokumentasi

- [17_QA_TEST_PLAN.md](../17_QA_TEST_PLAN.md) — seluruh dokumen (skenario, matriks perangkat, pelaporan, traceability).
- [16_IMPLEMENTATION_ROADMAP.md](../16_IMPLEMENTATION_ROADMAP.md) §6 (kesiapan rilis), §7 (risiko).
- [13_SYSTEM_ARCHITECTURE.md](../13_SYSTEM_ARCHITECTURE.md) §10 (deployment), §12 (observability), §13 (pemulihan).
- [15_SECURITY_PRIVACY_LIFECYCLE.md](../15_SECURITY_PRIVACY_LIFECYCLE.md) §8.4 (verifikasi penghapusan), §11 (copy).
- [03_USER_FLOWS.md](../03_USER_FLOWS.md) F-01..F-19 (alur yang harus lulus).

## 8. Referensi visual yang disetujui

Tes visual (TC-UX-011) memakai seluruh Visual Baseline V1:

| Kategori | File |
|---|---|
| Design system | `01_Design_System/Brand_Identity.webp` |
| Desktop | `02_Desktop/01_Landing.webp` … `08_Gallery.webp` (8 file) |
| Mobile | `03_Mobile/01_Landing.webp` … `08_Gallery.webp` (8 file) |
| Layar DERIVED | SCR-02..04, 07, 10..13, 15, 17, 19..22: dibandingkan dengan persetujuan visual dari fase masing-masing |

Penyimpangan yang disengaja dari mockup (misal timer voting DEC-046, foto placeholder) bukan bug visual.

## 9. Tugas implementasi fungsional

P10 tidak menambah fungsi. Tugas fungsionalnya adalah **membuktikan** alur pengguna:

1. F-01..F-19 dijalankan oleh penguji manusia di K2 dan K3.
2. Retake independen (TC-CAP-010) dibuktikan dengan 4 peserta nyata dan perbandingan hash file.
3. Tanpa auto-accept (TC-CAP-015) dibuktikan dengan peserta diam ≥ 10 menit.
4. Galeri tanpa take gagal (TC-GAL-005, -006) dibuktikan via UI dan API.
5. Unduh di iOS/Android/desktop (TC-EXP-001) dan Drive (TC-EXP-020) dibuktikan.
6. Room kedaluwarsa dan data terhapus (TC-SEC-030) dibuktikan di staging **dan** produksi (room uji, setelah deploy disetujui).
7. Bug yang ditemukan diperbaiki dengan perubahan terarah + tes regresi `TC-REG-{nnn}`.

## 10. Tugas implementasi teknis

| Area | Tugas |
|---|---|
| Otomasi tes | Lengkapi suite Playwright 4 konteks untuk TC-E2E-001..006 (bagian A); stabilkan tes flaky (17 §9) |
| Laporan | Isi matriks traceability 17 §10 dengan status & bukti per TC |
| Konfigurasi produksi | Variabel lingkungan 13 §10 (`ROOM_GRACE_PERIOD_SECONDS`, `PARTICIPANT_HOLD_SECONDS`, `ROOM_MAX_LIFETIME_HOURS` (tetap kosong/nonaktif kecuali DEC-052 disetujui pemilik produk), `MAX_SESSIONS_PER_ROOM`, `STORAGE_BUCKET`, `STORAGE_LIFECYCLE_HOURS`, `TURN_SHARED_SECRET`, `GOOGLE_CLIENT_ID`, `ALLOWED_ORIGINS`) |
| Infra | Bucket privat + CORS + lifecycle 24 jam; Redis AOF; 1 instance realtime + auto-restart + health check (DEC-088; multi-instance hanya jika pemicu 13 §15.2 tercapai); frontend & realtime di bawah satu domain untuk cookie token (DEC-082); TURN di region DEC-051 |
| OAuth | Origin produksi, consent screen, status verifikasi aplikasi untuk `drive.file` (RK-08) |
| Observability | Alarm aktif di produksi; dashboard metrik 13 §12 |
| Rollback | Prosedur rollback frontend & realtime service; kompatibilitas `protocolVersion` (14 §13) |
| Biaya | Hitung dari data uji: TURN (relay ratio × bitrate × durasi), storage, egress, compute → estimasi per 1.000 sesi, dengan asumsi tertulis |

## 11. Dependensi data model & event

Tidak ada perubahan kontrak. Jika bug memaksa perubahan kontrak:

- Ubah [14_DATA_MODEL_AND_EVENTS.md](../14_DATA_MODEL_AND_EVENTS.md) di perubahan yang sama.
- Naikkan `protocolVersion` jika tidak kompatibel; klien lama menerima `4426 UPGRADE_REQUIRED`.
- Catat di 18 jika perubahan menyentuh keputusan.

## 12. Requirement UI/UX

- TC-UX-011: reviewer menyetujui 16 layar V1 + layar DERIVED.
- TC-UX-010: ≥ 4 dari 5 penguji baru berhasil di editor ≤ 2 menit tanpa bantuan.
- Copy final diaudit terhadap 15 §11 (tidak ada "gak ada yang disimpan di server", "end-to-end encrypted", dsb.). Kata "permanen" untuk penghapusan hanya dipakai jika 15 §8.4 terbukti di produksi.
- Halaman privasi & FAQ terbit dan konsisten dengan arsitektur.

## 13. Pertimbangan desktop & mobile

| Kombinasi | Fokus verifikasi |
|---|---|
| K1 (desktop) | Kursor, panel drawer, shortcut keyboard, Drive popup |
| K2 (campuran) | Konsistensi state desktop ↔ mobile, skew capture lintas platform, unduh iOS |
| K3 (mobile semua) | Safe area, gestur editor, sheet kontekstual, panas/baterai 15 menit, fps (TC-PERF-020) |
| K4 (jaringan) | TURN TCP/TLS, reconnect saat pindah jaringan, upload attempt di 4G |

Setiap kombinasi dicatat: model perangkat, versi OS, versi browser, jaringan, tanggal, penguji.

## 14. Pertimbangan keamanan & privasi

- Jalankan ulang semua TC-SEC di build kandidat rilis (bukan mengandalkan hasil P09).
- Verifikasi CSP/header di domain produksi.
- Verifikasi cleanup di produksi dengan room uji (TC-SEC-030) setelah deploy disetujui.
- Pastikan data uji (foto penguji) di staging dihapus sesuai lifecycle; penguji diberi tahu bahwa foto disimpan sementara.
- Rahasia produksi (TURN secret, kredensial storage) tidak ada di repo atau log.

## 15. Checklist tugas detail

- [ ] Kumpulkan handoff P01–P09; daftar tes yang belum dijalankan dari tiap fase.
- [ ] Pastikan tidak ada OPEN QUESTION 🔴 di 18; DEC-020, DEC-055, DEC-061, DEC-066, DEC-073, DEC-076 final.
- [ ] Jalankan seluruh tes otomatis (unit, integrasi, E2E) di build kandidat.
- [ ] Jalankan TC-E2E-001..006 pada kombinasi yang ditentukan (17 §7).
- [ ] Jalankan matriks perangkat K1–K4.
- [ ] Jalankan TC-XB-001 di semua browser DEC-050.
- [ ] Jalankan ulang semua TC-SEC.
- [ ] Ukur performa: TC-PERF-001, -010, -020, -021, -030, TC-CAP-001.
- [ ] Jalankan TC-A11Y-001..004.
- [ ] Jalankan TC-UX-010 (5 penguji) dan TC-UX-011 (review visual).
- [ ] Perbaiki bug rilis + tes regresi `TC-REG-*`.
- [ ] Isi matriks traceability 17 §10 lengkap dengan bukti.
- [ ] Siapkan konfigurasi & infra produksi; OAuth produksi.
- [ ] Siapkan rollback plan & runbook final.
- [ ] Hitung estimasi biaya per 1.000 sesi.
- [ ] Lengkapi checklist 16 §6.
- [ ] Minta persetujuan eksplisit untuk deploy produksi.
- [ ] (Setelah disetujui dan dijalankan pengguna) smoke test produksi + verifikasi cleanup produksi.
- [ ] Handoff final.

## 16. Checkpoint integrasi

| Checkpoint | Isi |
|---|---|
| IC-1..IC-5 (ulang) | Diulang di build kandidat rilis di staging |
| IC-6 (ulang) | Skenario kegagalan diulang singkat di staging setelah semua perbaikan |
| Pra-produksi | Konfigurasi produksi divalidasi di staging dengan nilai identik (kecuali rahasia) |
| Pasca-deploy | Smoke test produksi: create → join 2 perangkat → vote → 1 shot → unduh → expired → cleanup terverifikasi |

## 17. Edge case

Semua edge case dari dokumen fitur diuji ulang dengan prioritas:

| Sumber | Kasus |
|---|---|
| 02 §8 | EC-01..EC-12 |
| 09 §12 | SY-01..SY-10 |
| 07 §13 | Aksi simultan (join, shutter, Tunggu!, frame, vote) |
| 12 §8 | Batas 20 sesi, Balik edit, peserta `LEFT` di hasil |
| 15 §13 | TH-01..TH-13 |

## 18. Skenario kegagalan

| Kegagalan saat P10 | Tindakan |
|---|---|
| Tes P0 gagal | Rilis diblokir sampai diperbaiki & lulus; tidak boleh diturunkan prioritasnya tanpa persetujuan pemilik produk |
| Perangkat tertentu gagal tanpa solusi | Catat sebagai known issue + keputusan pemilik produk (dukung/tidak) → usulkan sebagai DEC baru di 18 |
| Skew/fps di bawah target pada HP lama | Evaluasi DEC-034 (SFU) / batas bitrate; keputusan pemilik produk |
| Verifikasi Google belum selesai | Drive (P1) bisa dirilis terbatas/dinonaktifkan via konfigurasi; catat di handoff |
| Deploy produksi bermasalah | Jalankan rollback plan; runbook insiden |

## 19. Acceptance criteria

| # | Kriteria | Bukti |
|---|---|---|
| AC-1 | Semua requirement P0 punya TC berstatus PASS dengan bukti | Matriks 17 §10 terisi |
| AC-2 | TC-E2E-001..006 PASS pada kombinasi yang ditentukan | Laporan per kombinasi |
| AC-3 | Matriks K1–K4 lulus; TC-XB-001 PASS | Laporan perangkat |
| AC-4 | TC-CAP-010 & TC-CAP-015 PASS di perangkat nyata | Hash file + rekaman layar |
| AC-5 | Semua TC-SEC P0 PASS di build kandidat | Laporan keamanan |
| AC-6 | NFR-01, NFR-02, NFR-05, NFR-11, NFR-12 memenuhi target atau pengecualian disetujui | TC-PERF-*, TC-CAP-001, TC-EXP-010 |
| AC-7 | TC-UX-010 ≥ 4/5; TC-UX-011 disetujui | Catatan sesi & tanda persetujuan reviewer |
| AC-8 | TC-A11Y-001 0 pelanggaran serious/critical | Laporan axe |
| AC-9 | Estimasi biaya per 1.000 sesi tersedia dengan asumsi tertulis | Dokumen biaya |
| AC-10 | Checklist 16 §6 lengkap | Checklist + tautan bukti |
| AC-11 | Cleanup terverifikasi di produksi (setelah deploy disetujui) | TC-SEC-030 di produksi |

## 20. Checklist pengujian

- [ ] Unit & integrasi seluruh monorepo.
- [ ] E2E otomatis multi-konteks.
- [ ] TC-E2E-001..006.
- [ ] Matriks perangkat K1–K4 (D).
- [ ] TC-XB-001.
- [ ] Semua TC-SEC.
- [ ] TC-PERF-*, TC-CAP-001.
- [ ] TC-A11Y-001..004.
- [ ] TC-UX-010, TC-UX-011.
- [ ] Regresi `TC-REG-*` + tes visual.
- [ ] Smoke test produksi (setelah persetujuan & deploy oleh pengguna).

Status tiap tes: `NOT RUN` / `PASS` / `FAIL` / `BLOCKED` (17 §9). Perintah verifikasi yang disarankan (dijalankan pengguna atau atas izin eksplisitnya): `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm test:security`, `pnpm test:visual`, `pnpm typecheck`, `pnpm lint`, `pnpm build`. Agen **tidak** menjalankan typecheck/lint/build penuh, operasi Git (commit, push, merge, tag), atau deploy tanpa instruksi pengguna, dan **tidak pernah** menandai tes PASS tanpa menjalankannya.

## 21. Definition of Done

- [ ] AC-1..AC-10 terpenuhi dengan bukti; AC-11 terpenuhi setelah deploy produksi disetujui dan dijalankan.
- [ ] Tidak ada bug P0 terbuka; bug P1 terbuka disetujui pemilik produk sebagai known issue.
- [ ] Dokumentasi (02, 14, 18) diperbarui sesuai perubahan selama P10.
- [ ] Runbook, rollback plan, dan dashboard alarm siap.
- [ ] Pemilik produk menandatangani persetujuan rilis.
- [ ] Handoff final §24 terisi.

## 22. Deliverable

- Laporan QA lengkap (otomatis + manual + perangkat) dengan matriks traceability terisi.
- Laporan keamanan build kandidat.
- Laporan performa & estimasi biaya per 1.000 sesi.
- Konfigurasi & infrastruktur produksi siap (deploy menunggu persetujuan).
- Runbook insiden & rollback plan final.
- Catatan rilis (fitur, known issues, keputusan PROPOSED yang masih berlaku).

## 23. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| RK-01 upload mesh berat di HP | Data K3 menentukan keputusan SFU (DEC-034) |
| RK-02 skew capture | Ukur di K2/K4; toleransi UI; perbaikan sinkronisasi waktu |
| RK-04 memori export iOS | Uji preset di iPhone lama; fallback ukuran |
| RK-05 biaya TURN | Estimasi dari data nyata, batas bitrate |
| RK-08 verifikasi Google | Rilis Drive terbatas/flag jika belum selesai |
| RK-09 lisensi stiker | DEC-055 wajib final sebelum rilis publik |
| RK-10 variasi kamera antar browser | Matriks perangkat luas; known issue terdokumentasi |
| Tekanan jadwal mendorong skip tes | Aturan: P0 gagal = rilis diblokir; tidak ada PASS tanpa bukti |

## 24. Handoff final (release handoff)

```text
## Handoff Final P10 — Rilis LONGROLL
Tanggal / agen / approver:
Status: READY FOR RELEASE | RELEASED | BLOCKED

### Pekerjaan selesai
- ...

### Komponen/file/infra yang diubah di P10
- ...

### Keputusan teknis & produk penting (status akhir DEC-xxx; daftar yang masih PROPOSED)
- ...

### Tes yang sudah dijalankan (ringkasan per area + tautan bukti)
- Otomatis: ...
- Perangkat K1–K4: ...
- Keamanan: ...
- Performa: ...
- Usability & visual: ...

### Tes yang BELUM dijalankan (dan alasannya)
- ...

### Known issues (dengan persetujuan pemilik produk)
- ...

### Risiko yang masih terbuka
- ...

### Estimasi biaya per 1.000 sesi (dengan asumsi)
- ...

### Status produksi
- [ ] Deploy disetujui oleh: ...   tanggal: ...
- [ ] Smoke test produksi: PASS/FAIL
- [ ] Cleanup produksi terverifikasi (TC-SEC-030): PASS/FAIL
- [ ] Alarm aktif

### Rekomendasi pasca-rilis
- Item DEFERRED yang relevan (DEC-095..DEC-098), OPEN yang tersisa: ...
```
