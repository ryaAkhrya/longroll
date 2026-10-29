# Runbook insiden LONGROLL (draf P09 → dipakai P10)

Prinsip: tidak ada host, tidak ada akun. Semua tindakan di bawah dilakukan operator; jangan pernah menempel token, DSN, atau
signed URL ke tiket/chat. Log operasional sudah tersamar (`apps/realtime/src/log.ts`), tetapi jangan mengandalkannya.

Sinyal: log JSON `alarm.*` (level error) dari service realtime, ditulis tiap `METRICS_INTERVAL_SECONDS` (default 300 dtk)
bersama `metrics` (snapshot counter/gauge/p50/p95). Menghubungkan `alarm.*` ke pager = pekerjaan P10 (belum ada).

| Alarm / gejala | Arti | Tindakan |
|---|---|---|
| `alarm.cleanup_failed` | `cleanup_failures_total` naik | Lihat `cleanup.verify_failed` / `cleanup.failed` (pesan tersamar). Biasanya storage atau Neon sementara tak tersedia → retry otomatis 1 m/5 m/15 m/1 j. Tak perlu tindakan bila `cleanup_unresolved` kembali 0. |
| `alarm.cleanup_stuck` | Satu room belum bersih > 30 menit | Data pribadi masih tersimpan melewati janji retensi. Cek kredensial storage (kedaluwarsa/dicabut?), status Neon, lalu restart service (recover() memulai cleanup room `EXPIRING` lagi). Eskalasi bila > 2 jam. |
| `alarm.cleanup_unresolved` | Ada room dengan cleanup belum terverifikasi | Sama seperti di atas; pantau `cleanup_unresolved`. |
| `alarm.storage_orphans` / `alarm.orphans_recurring` | Sweeper menemukan objek tanpa room | Sesekali wajar (PUT bertanda tangan mendarat setelah cleanup). Berulang ≥ 2 sapuan = ada jalur yang membocorkan objek: kumpulkan `orphan.deleted` (jumlah) dan lapor. Objek sudah dihapus sweeper. |
| `alarm.orphan_sweep_failed` / `orphan.sweep_aborted` | Sapuan gagal / dibatalkan pengaman | Jangan hapus manual. Periksa koneksi store↔storage; `sweep_aborted` berarti store tidak konsisten dengan memori — selidiki dulu. |
| `alarm.store_unavailable` | Neon tidak terjangkau (`store_unavailable_total` naik) | Klien menerima `SERVICE_UNAVAILABLE` + retry otomatis; kursor tetap jalan. Cek Neon status/compute (cold start ≤ ~10 dtk normal). Jika > 5 menit: pastikan `DATABASE_URL` benar, kuota Free plan (CU-hours/penyimpanan) belum habis. |
| `alarm.editor_snapshot_failed` | Snapshot editor gagal ditulis | Dicoba ulang tiap 5 dtk; perubahan tetap di memori. Jangan restart service selama masih `editor_docs_dirty > 0` kecuali terpaksa (shutdown rapi SIGTERM akan mencoba menulis). |
| `process.uncaught_exception` | Bug tak tertangani | Service mati rapi (flush editor) dan harus di-restart oleh supervisor; room dipulihkan dari Neon (DEC-088). Kumpulkan log, buat isu. |
| 429 massal / `ws_upgrade_limited_total` naik | Flood atau NAT besar | Pembatas per-IP (hash bersalt) sudah menahan pelaku; room lain tidak terdampak. Jika pengguna sah terblokir (satu NAT besar), naikkan `GENERAL_LIMITS` di `http/rateLimit.ts` setelah dievaluasi. |
| 503 `CAPACITY` saat bikin room | `MAX_ACTIVE_ROOMS` tercapai | Naikkan batas hanya bila memori cukup (≈ 1 MB/room aktif terukur di uji beban), atau tambah instance setelah pemicu 13 §15.2 disetujui. |

## Realtime down / restart
1. Supervisor menjalankan ulang proses; `index.ts` memanaskan koneksi DB (5× backoff), lalu `recover()` memuat room ACTIVE/GRACE/EXPIRING dari Neon.
2. Klien otomatis menyambung ulang (backoff 0,5–8 dtk) → `POST /session` → WS resume. Waktu resume terukur (IC-6): lihat HANDOFF_P09.md.
3. Deploy: kirim SIGTERM (bukan SIGKILL) agar snapshot editor terakhir (≤ 5 dtk perubahan) ditulis. Batas shutdown 10 dtk.

## Neon down / cold start
- Compute di-suspend setelah 5 menit idle; bangun ±0,3–5 dtk. Pool mengulang gagal-koneksi 2×, SELECT putus 2×; tulis tidak pernah diulang di lapisan DB.
- Event kritis ditolak `SERVICE_UNAVAILABLE` (Retry-After 5), klien mengulang otomatis dengan `clientEventId` yang sama.
- Antrean pool dibatasi (4× `DATABASE_POOL_MAX`); di atasnya langsung `SERVICE_UNAVAILABLE` (tidak menumpuk).

## Storage down
- Upload/URL gagal → klien mendapat pesan ramah dan mengulang; cleanup menunda & mengulang; room tetap berjalan (foto lokal tetap bisa diambil).
- Setelah pulih, sweeper harian menghapus objek yatim. Untuk memaksa: restart service lalu panggil `manager.sweepOrphans()` (hanya via skrip operator; jangan manual di konsol bucket).

## TURN down
- Kartu "Gak bisa nyambung" untuk peserta yang butuh relay; capture tetap jalan (foto diambil lokal). Cek `turnserver` dan `TURN_SHARED_SECRET` sama di service & TURN.

## Rotasi rahasia
- `RATE_LIMIT_SALT`: ubah kapan saja (hanya mengosongkan hitungan rate limit). Salt turunan sudah berotasi harian.
- Kredensial storage: buat kredensial baru (scope `storage:write`), ganti env, restart, cabut yang lama. `STORAGE_SIGNING_SECRET`/`TURN_SHARED_SECRET`: ganti + restart (URL/kredensial lama otomatis tak berlaku).
- Kata sandi role `longroll_app`: reset di Neon Console, perbarui `DATABASE_URL`, restart. Jangan pernah memakai role owner untuk runtime.
