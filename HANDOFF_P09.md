### Handoff P09 → P10

**Status:** gate non-browser lulus (typecheck, lint, unit, integrasi + Neon `development`, build, `npm audit` 0 kerentanan, uji keamanan negatif, uji beban terbatas). **Playwright / browser E2E / uji perangkat TIDAK dijalankan (diminta) → semua AC yang butuh browser, perangkat, TURN nyata, Google nyata, atau bucket nyata = NOT VERIFIED.** Tidak ada migrasi Neon baru (0001–0007 tetap). Tidak ada perintah Git, commit, push, deploy.

## 1. Temuan keamanan & perbaikan (laporan audit)

| # | Temuan | Risiko | Status |
|---|---|---|---|
| S-01 | **Oracle enumerasi kode lewat WebSocket**: upgrade ke kode tak ada = `404`, ada tanpa cookie = `401`, dan tidak dihitung rate limit kode salah (DEC-067) → kode bisa dipindai tanpa batas (TH-01). | Tinggi | **Diperbaiki.** Kode salah via WS dihitung bersama HTTP (penghitung dibagi); setelah 20 → `429` untuk WS **dan** HTTP; semua penolakan 404/401/410 memakai waktu minimum 120 ms. Tes TC-SEC-001. |
| S-02 | **`X-Forwarded-For` kiri dipercaya**: dengan `TRUST_PROXY=true`, IP = entri pertama (dikirim klien) → seluruh rate limit IP (create/join/kode salah/preview) bisa di-bypass dengan header palsu. | Tinggi (bila di belakang proxy) | **Diperbaiki.** `TRUST_PROXY=<N>` = jumlah proxy tepercaya; dipakai entri ke-N dari **kanan**; rantai lebih pendek → alamat socket. Peringatan startup bila produksi & `TRUST_PROXY=0`. Tes unit + integrasi. **Perubahan perilaku:** `TRUST_PROXY=true` kini berarti 1 proxy. |
| S-03 | **Signed PUT bisa dipakai ulang** selama TTL: objek yang sudah diverifikasi/di-re-encode server bisa ditimpa lagi lewat URL yang sama. | Sedang-rendah (hanya pemilik URL) | **Diperbaiki untuk storage lokal** (sekali pakai; dilepas bila PUT gagal agar retry jaringan tetap bisa). **Risiko diterima untuk S3/Neon**: presigned PUT S3 tidak bisa dibuat sekali pakai; dibatasi TTL 5 mnt + tipe/ukuran + re-verifikasi saat `uploaded`. |
| S-04 | **CSP script memakai `'unsafe-inline'`** (TH-03). | Sedang | **Diperbaiki.** `src/proxy.ts` + `src/security/csp.ts`: nonce per-request + `'strict-dynamic'`, tanpa `unsafe-inline`/`unsafe-eval` di produksi; `<style>` bernonce; hanya atribut `style=""` tetap inline (`style-src-attr`); `base-uri 'none'`; Google hanya bila OAuth client diset. Terverifikasi lewat `next start` + curl: **29/29 `<script>` di `/`, 21/21 di `/r/*`, 19/19 di 404 bernonce**. Semua halaman kini dirender dinamis. **NOT VERIFIED di browser** (GIS popup, Konva, hidrasi dengan CSP baru). |
| S-05 | **Tidak ada pembatas lalu lintas umum**: `session`, `turn-credentials`, `attempts/*/url`, `frames/*`, `/api/storage/*`, upgrade WS tanpa batas per-IP; pembuatan room tanpa pengaman global/batas memori. | Sedang | **Diperbaiki.** Pembatas memori (tanpa menyentuh Neon): 900 req/mnt/IP API, 1800 storage, 240 upgrade/mnt; global create 120/mnt; `MAX_ACTIVE_ROOMS` (500) → `503 SERVICE_UNAVAILABLE` + `Retry-After`. Batas aman untuk 4 peserta satu NAT. |
| S-06 | **Banjir byte editor**: 60 pesan/dtk × 256 KB per koneksi. | Sedang | **Diperbaiki.** Token bucket 1 MB/dtk (burst 2 MB) per koneksi untuk `editor.*`; lewat batas → ack `RATE_LIMITED`, >120 pelanggaran → tutup. |
| S-07 | **Salt hash IP tidak berotasi** bila `RATE_LIMIT_SALT` tetap. | Rendah | **Diperbaiki.** Salt turunan per epoch 24 jam (HMAC(salt, epoch)). |
| S-08 | **Log bisa membocorkan data** lewat pesan error pihak ketiga (pg, S3: DSN, URL bertanda tangan, IP). | Sedang | **Diperbaiki.** `log.ts` menyamarkan semua field (kunci sensitif, URL/DSN, kredensial `nak_/nsk_/nt_`, token ≥32 karakter selain UUID, IPv4) dan `errText()` untuk error; tes TC-SEC-041 memindai log nyata (nama, token, signed URL, IP, cookie tidak muncul). |
| S-09 | Header respons API minim; server HTTP tanpa timeout (slowloris). | Rendah | **Diperbaiki.** `headersTimeout 15s`, `requestTimeout 120s`, `maxHeaderSize 16KB`, `Referrer-Policy`, CSP `default-src 'none'`, HSTS (produksi), `Cross-Origin-Resource-Policy` + `nosniff` pada GET storage. Web: `X-Frame-Options`, HSTS (produksi). |
| S-10 | **Drive**: 403 `rateLimitExceeded` diperlakukan gagal; GIS dimuat saat klik pertama → popup bisa diblokir (Safari iOS/Android). | Sedang (keandalan) | **Diperbaiki.** Retry dengan backoff untuk 403 rate-limit; `preload()` GIS saat panel export tampil agar `requestAccessToken` sinkron di dalam gesture. Token tetap hanya di memori, scope tetap `drive.file`, pesan error dari tabel statis (tes: token tak bocor ke error). |
| S-11 | S3 adapter tanpa timeout/retry terbatas; checksum default SDK baru bisa ditolak penyedia S3-compatible. | Rendah | **Diperbaiki.** `maxAttempts 3`, connect 5 s / request 20 s, `requestChecksumCalculation: WHEN_REQUIRED`, GET bertanda tangan `inline` + cache privat. **NOT VERIFIED terhadap bucket nyata.** |

Kontrol yang diaudit dan **sudah benar** (dengan tes): token 32 byte CSPRNG, hash SHA-256 + `timingSafeEqual`, scope per-room (TC-SEC-002), rotasi + pencabutan (leave/EXPIRING), cookie `HttpOnly; SameSite=Strict; Secure; Path; Max-Age` (TC-SEC-022; **fallback `sessionStorage` tidak dipakai di mana pun — DEC-082**), Origin di semua endpoint mengubah-state + upgrade WS + CORS (TC-SEC-023), `preview` hanya inisial (TC-SEC-010), `FORBIDDEN_NOT_OWNER` untuk presence/accept/retake (TC-SEC-012/014), SVG menyamar & decompression bomb (TC-SEC-016/017, tes P05), signed URL lokal: kedaluwarsa/ubah/metode/key di luar `rooms/` (TC-SEC-018), validasi update Yjs (ukuran, skema, celah dependensi, ukuran dokumen) + replay idempoten + sampah ditolak, tanpa `dangerouslySetInnerHTML`, `limitInputPixels` di semua decoder sharp.

Role Neon `longroll_app` (read-only, SQL): bukan superuser/createdb/createrole/bypassrls, tidak bisa CREATE di `public`, hanya `SELECT/INSERT/UPDATE/DELETE` (tanpa TRUNCATE/TRIGGER/REFERENCES); tes memastikan `CREATE TABLE`, `TRUNCATE`, `DROP` ditolak.

## 2. Reliabilitas

- **Shutdown rapi** (SIGTERM): `flushAll()` menulis snapshot editor yang belum tersimpan (sebelumnya sampai 5 dtk edit hilang), `closeAllConnections`, batas 10 dtk. `unhandledRejection` dicatat; `uncaughtException` → shutdown rapi lalu restart supervisor.
- **Snapshot editor gagal** (store mati) kini dicoba ulang tiap 5 dtk, tidak menggantung sampai update berikutnya; `flush()` per dokumen terisolasi.
- **Neon cold start/pool**: connect timeout 8 s, gagal-koneksi (sebelum statement terkirim) diulang 2× untuk statement apa pun, SELECT yang terputus diulang 2×, tulis tidak pernah diulang di lapisan DB; antrean pool dibatasi (4× `DATABASE_POOL_MAX`) → gagal cepat `SERVICE_UNAVAILABLE`; pemanasan 5× saat boot.
- **Sweeper objek yatim** (harian, `ORPHAN_SWEEP_INTERVAL_SECONDS`): hapus `rooms/{id}/` tanpa room; tidak menyentuh room di memori; gagal-aman bila store error; rem pengaman bila store tak konsisten; metrik `storage_orphan_objects`, alarm bila berulang. **Satu-satunya backstop di Neon** karena lifecycle bucket tidak ditegakkan (lihat §4).
- **Cleanup**: durasi `cleanup_duration_ms` (p50/p95), `cleanup_unresolved`, alarm `cleanup_stuck` > 30 mnt (sweeper 60 dtk), tes cleanup macet/pulih.
- **Metrik & alarm**: counter/gauge/p95 + `evaluateAlarms` → log `alarm.*` tiap 5 menit (`METRICS_INTERVAL_SECONDS`). Pager = P10.
- **Batas memori**: `MAX_ACTIVE_ROOMS`, `MemoryLimiter` ≤ 20k kunci, buffer event 500, cache idempoten terbatas, sampel metrik ≤ 512.
- **Konsistensi Neon** (tes pada `development`): dua penulis pada satu room (split-brain) → kapasitas 4 tidak terlampaui, seq event unik berurutan; counter rate limit atomik (12 hit paralel = 1..12); banjir 40 query pada pool 2 → yang lewat benar, sisanya `StoreUnavailable` cepat, store pulih.

## 3. Hasil tes (dijalankan, lingkungan: Windows 10, Node 22, Neon `development` via `longroll_app`)

| Gate | Hasil |
|---|---|
| Typecheck (realtime, web, shared) | 0 error |
| Lint (eslint web) | 0 error, 0 warning |
| Unit | realtime **139** (12 file), web **93** (10), shared **99** (7) — semua lulus |
| Integrasi | **57 lulus, 2 dilewati** (S3 nyata, butuh env) — 12 file, termasuk 6 file Neon `development` |
| Keamanan negatif (`npm run test:security -w @longroll/realtime`) | 18 integrasi + 13 unit lulus |
| Build produksi web | lulus (semua rute dinamis + Proxy); peringatan "Yjs was already imported" saat SSR tetap ada (satu salinan terpasang; dicoba `transpilePackages: yjs` — tidak berpengaruh, dikembalikan) |
| `npm audit` | 0 kerentanan (semua & produksi) |
| Playwright / browser E2E | **NOT RUN (diminta)** |

### Pemetaan TC-SEC
| TC | Status | Bukti |
|---|---|---|
| 001 | PASS | `security.test` (HTTP + WS bersama, XFF palsu) |
| 002, 003 | PASS | `security.test`, `room.test` (WS tanpa cookie → 401; mode fallback `auth` tidak ada) |
| 010 | PASS | `security.test` (kunci respons preview persis) |
| 012, 014 | PASS | `security.test`, `capture.test` |
| 016, 017 | PASS | `pipeline.test`, `frames.test` (P05) |
| 018 | PASS (storage lokal) / **NOT VERIFIED** (S3 nyata) | `security.test`; `s3.storage.test` siap tapi belum dijalankan |
| 019 | **NOT VERIFIED** | konfigurasi acuan `infra/turn/turnserver.conf`; butuh TURN nyata |
| 020 | PASS (unit P01–P02: nama HTML ditolak `NAME_INVALID`; React meng-escape) | `room.test`; eksekusi di browser NOT VERIFIED |
| 021 | PASS (header/CSP server via curl + unit) / **NOT VERIFIED** di browser | `csp.test`, curl `next start` |
| 022 | PASS | `security.test` |
| 023 | PASS | `security.test` |
| 030 | PASS | `room.test` (storage+DB kosong, tombstone), `cleanup.test`, Neon: `postgres*.test` |
| 031 | PASS | `cleanup.test`, `hardening.test` (retry, macet, orphan) |
| 032 | **TIDAK DAPAT LULUS di Neon** | lifecycle tidak ditegakkan; digantikan sweeper yatim (PASS di `hardening.test`) |
| 040 | PASS | `security.test` (500+ event: pelaku ditutup `4429`, room lain <500 ms) |
| 041 | PASS | `security.test` (pindai log) + `guard.test` |

### IC-6 (restart instance tunggal) — waktu pemulihan terukur
| Skenario | Hasil |
|---|---|
| Restart saat **voting** (store memori), HTTP+WS nyata | recover 3 ms, resume 19 ms; suara sebelum crash tetap, peserta tidak ganda |
| Restart saat voting, **Neon development** (pemulihan on-demand) | lookup 313 ms, **resume 420 ms** (AC-5 ≤ 10 s) |
| Store mati sesaat | event kritis → `SERVICE_UNAVAILABLE`, retry dengan `clientEventId` sama diterima; kursor tetap jalan |
| Restart saat COUNTDOWN / REVIEW (accepted tetap, retake dilanjutkan, tanpa auto-accept) | PASS — unit P06 (`capture.test`) |
| Restart saat EDITING (dokumen dari snapshot, tanpa duplikasi) | PASS — unit P07 (`editor.test`) |
| Restart setelah finalisasi / galeri | PASS — `results.test`, `postgres.results.test` |
| Restart saat GRACE (grace dari `emptySinceMs`) | PASS — `RoomActor.test` |
| Restart saat export | Export murni sisi klien; setelah restart `editor.sync` sesi CLOSED tetap terbaca (P08) — tidak ada status server yang hilang |
| Matikan TURN / paksa error storage saat cleanup | TURN: NOT VERIFIED (tidak ada TURN). Storage: PASS (`cleanup.test`, `hardening.test`) |
| Restart Redis | **Tidak berlaku** — Redis diganti Neon PostgreSQL (tidak dihidupkan kembali) |

### Beban (TC-PERF-030, indikatif — klien & server satu proses, tanpa jaringan nyata)
| Store | Room × peserta | Kursor 20 Hz | Relay p50/p95/p99 | Ack intent p95 | Memori |
|---|---|---|---|---|---|
| memori | 25 × 4 = 100 koneksi | 100% terkirim | 7 / 10 / 13 ms | 10 ms | heap 29→39 MB |
| memori | **100 × 4 = 400 koneksi** | 100% terkirim | 27 / 33 / 40 ms | 31 ms | heap 39→74 MB, RSS 219 MB |
| Neon (5 × 4, 20 dtk, 0,2 intent/dtk) | 20 koneksi | 100% | 2 / 3 / 3 ms | **189 ms** (p99 334 ms, n = 60) | RSS 129 MB |

- **Target N yang divalidasi: 100 room (400 koneksi) pada satu instance** — relay p95 ≤ 150 ms, 0 putus tak terduga, 0 ack gagal. 200 room tertahan pengaman global create (120/mnt) — itu perilaku yang diinginkan.
- **Catatan jujur NFR:** latensi **tulis** (event kritis yang di-commit ke Neon) p95 ≈ 190 ms dari mesin dev ke Neon `ap-southeast-1` — di atas target 150 ms; kursor/presence volatile jauh di bawah (≤ 3 ms). Menempatkan service realtime di region yang sama dengan Neon diperkirakan menurunkannya (belum diukur). Beban Neon sengaja kecil (Free plan).
- `capture_skew_ms`, `rtc_relay_ratio`, fps HP: **tidak terukur** (butuh perangkat/jaringan; belum ada telemetri klien). Alarm `capture_skew` sudah dikodekan tetapi tidak ada sumber datanya.

## 4. Storage

- Neon Object Storage sudah `enabled` pada branch `development`. **Dibuat:** bucket privat `longroll-dev` (project `hidden-glade-82216110`, branch `development`; paket Free menyertakan 5 GB/project → tanpa biaya). Kredensial `storage:write` sempat dibuat untuk memverifikasi adapter, tetapi **penulisan kredensial ke `.env` lokal ditolak oleh izin sesi**, dan karena secret-nya sudah tampil di hasil tool, **kredensial itu langsung saya cabut** (`revoke`). Tidak ada kredensial storage yang aktif, tersimpan, atau di-commit.
- **Status: real cloud storage = NOT VERIFIED.** Adapter S3 (`S3ObjectStorage`) belum pernah menyentuh bucket nyata. Tidak ada penggantian memori yang diklaim siap produksi (produksi tetap menolak start tanpa `S3_*`).
- Langkah manual persis (±5 menit): `infra/storage/README.md` (buat kredensial `storage:write`, isi `apps/realtime/.env`, `put-bucket-cors` dari `infra/storage/cors.json` dengan origin sebenarnya, jalankan `LONGROLL_TEST_S3=1 npx vitest run --config vitest.integration.config.ts test/integration/s3.storage.test.ts`).
- **Temuan penyedia (dokumentasi Neon):** (1) lifecycle rule **disimpan tapi tidak dijalankan** → DEC-036/TC-SEC-032 tidak tersedia; (2) `DeleteObject` = *soft delete* pada branch → jangan klaim "permanen"; (3) `GetBucketEncryption` = 501 → enkripsi at-rest **tidak dapat diverifikasi** (DEC-075 tetap tidak terverifikasi); (4) CORS didukung.

## 5. Isu P08 yang ditindaklanjuti
- **SCR-19 status peserta** (spesifikasi 04: Ikut / Lagi unduh… / Belum jawab): dibuat. Lewat `presence.activity` volatile (`invite:{sessionId}:join|later`, `export:busy|idle`); jawaban disiarkan ulang tiap 4 dtk; pengaju otomatis "Ikut"; murni info UX tanpa otoritas server. 5 tes baru. Tampilan visual NOT VERIFIED.
- Koreksi catatan P08: "Bentar tidak menghentikan voting" **salah** — sesuai 08 §4 server memang menunggu peserta CONNECTED yang belum memilih (penutupan otomatis tidak terjadi sampai mereka memilih/penutupan manual); perilaku itu sudah benar.
- Google Drive: ditinjau (token hanya memori, scope `drive.file`, tanpa log/penyimpanan token, error dari tabel statis); diperbaiki S-10. **OAuth live tetap pending** (tidak ada client ID; tidak ada ekspor sukses yang diklaim). ZIP tetap ditunda (DEC-045, P2).

## 6. Keputusan / status
| DEC | Status akhir |
|---|---|
| DEC-052 (umur maks. room) | **Tetap OPEN = tanpa batas umur** (default). Tes TC-ROOM-026: 13+ jam dengan peserta terhubung + refresh kredensial → tetap ACTIVE. Tidak diaktifkan. Bila disetujui, peringatan 15 menit sebelumnya belum dibuat. |
| DEC-056 (analitik) | **Default sementara: tidak ada analitik** (tidak ada kode analitik). Perlu persetujuan eksplisit pemilik produk; `docs/18` tidak saya ubah (dokumen disetujui). |
| DEC-073 (TURN) | OPEN. Konfigurasi acuan + deny-list ada; TURN nyata & `rtc_relay_ratio` belum. |
| DEC-075 (enkripsi at-rest) | **Tidak terverifikasi** (Neon storage: tidak ada API enkripsi; Postgres: sesuai kebijakan Neon, tidak diaudit di sini). Jangan klaim. |
| DEC-082 (cookie) | Terverifikasi di server (atribut, Origin); fallback `sessionStorage` tidak dipakai di lingkungan mana pun. Perilaku `Secure`/`SameSite=Strict` lintas-situs (web & realtime beda domain) **NOT VERIFIED** — sebaiknya satu "site" yang sama (mis. `app.` & `rt.` di domain yang sama) → putuskan di P10. |
| Tombol kick/kunci room | Tidak dibuat (di luar scope; tetap OPEN di 15 §9). Usulan DEC baru bila dibutuhkan. |

## 7. NOT VERIFIED / tidak dijalankan
- Semua browser/perangkat: CSP baru di Chrome/Safari/Firefox (hidrasi, Konva, GIS popup iOS/Android), TC-SEC-020/021 di browser, TC-PERF-020/022, TC-CAP-001 (skew), fps HP, uji reconnect pindah Wi-Fi↔seluler.
- Google Drive live (OAuth), ekspor Drive nyata.
- Bucket S3 nyata (adapter, CORS, presigned PUT/GET, TC-SEC-018 terhadap S3), TC-SEC-032.
- TURN (TC-SEC-019, DEC-073), `rtc_relay_ratio`, alarm `rtc_failed`.
- Pager untuk `alarm.*`; dashboard minimal belum dibuat (hanya log berkala).
- Failover multi-instance (lease): **tidak dibuat** (pemicu 13 §15.2 tidak tercapai).
- Latensi tulis Neon dari region produksi.

## 8. Risiko terbuka / diterima
1. `style-src-attr 'unsafe-inline'` (43 prop `style` React) — diterima (tidak dapat mengeksekusi skrip).
2. Presigned PUT S3 dapat dipakai ulang dalam TTL 5 mnt (lihat S-03).
3. Tidak ada lifecycle bucket di Neon; sweeper harian = satu-satunya backstop → objek yatim bisa bertahan ≤ 24 jam.
4. `DeleteObject` Neon = soft delete; salinan internal/backup penyedia di luar kendali.
5. Latensi tulis Neon p95 ≈ 190 ms (di atas NFR 150 ms) sampai service ditempatkan satu region.
6. Konten tidak pantas di frame upload: tanpa moderasi (di luar scope, dicatat).
7. Satu room dev tersisa di Neon (lihat §9).
8. Peringatan SSR "Yjs was already imported" (tidak memengaruhi klien).

## 9. Room `QEZWVM` di Neon `development`
Inspeksi **read-only** dulu: dibuat 2026-10-28 18:47:53Z, ACTIVE, 1 peserta ("Nadia", CONNECTED), 1 sesi **VOTING**, 3 event, 1 dokumen editor v2 (1039 byte) ditulis 350 ms setelah sesi dibuat. Kombinasi itu (sesi VOTING yang sudah punya dokumen editor, versi 2) **tidak mungkin dihasilkan alur nyata** dan **identik dengan sidik jari tes `postgres.editor.test.ts` (P07)** yang gagal/terhenti sebelum `finalizeExpiredRoom`. Kesimpulan: sangat mungkin sisa tes saya sendiri, tetapi **asalnya tidak dibuktikan oleh log** (hanya kecocokan sidik jari) → **ketidakpastian dilaporkan**. Saya mencoba menghapusnya lewat transaksi terbatas (`room_id` + `code` persis) tetapi **izin sesi menolak** (classifier), jadi room **tidak diubah dan tidak dihapus**. Dampaknya nol (1 baris kecil); akan hilang sendiri bila service berjalan dan room kedaluwarsa, atau hapus manual: `delete from lr_rooms where room_id='d39132ba-177d-4c8b-bff0-0b5ce2d517a6' and code='QEZWVM';` (cascade) lalu `delete from lr_room_codes where code='QEZWVM';`. Jangan pernah menjalankan `manager.recover()` terhadap DB dev dalam tes (akan memuat & mengekspirasi room ini) — tes IC-6 Neon memakai `lookup` on-demand untuk alasan itu.

## 10. File yang dibuat/diubah (ringkas)
- Realtime: `src/log.ts` (scrub+metrik), `src/guard/{limiter,alarms,timing}.ts`, `src/http/{rateLimit,api,util}.ts`, `src/ws/gateway.ts`, `src/app.ts`, `src/index.ts`, `src/config.ts`, `src/room/{RoomManager,RoomActor,cleanup,editor}.ts`, `src/storage/{types,memory,fs,s3,signer}.ts`, `src/store/{db,types,memory,postgres}.ts`, `scripts/ws-load.ts`; tes: `src/guard/guard.test.ts`, `src/room/hardening.test.ts`, `test/integration/{security,recovery,postgres.concurrency,s3.storage}.test.ts`, `helpers.ts`.
- Web: `src/proxy.ts`, `src/security/csp.ts` (+tes), `src/app/layout.tsx`, `next.config.ts`, `src/components/result/{inviteStatus.ts,InviteDialog.tsx(.module.css),ResultScreen.tsx}`, `src/components/room/RoomScreen.tsx`, `src/export/{drive.ts,useExport.ts}` (+tes).
- Infra/ops: `infra/storage/*`, `infra/turn/*`, `ops/RUNBOOK.md`, `ops/PRIVACY_COPY_DRAFT.md`, `.env.example`.
- Env baru: `MAX_ACTIVE_ROOMS`, `ORPHAN_SWEEP_INTERVAL_SECONDS`, `METRICS_INTERVAL_SECONDS`; `TRUST_PROXY` kini jumlah proxy.

## 11. Kesiapan untuk P10
- [x] Semua TC-SEC P0 yang dapat diuji tanpa browser/perangkat PASS (kecuali 019 & 032 — lihat §3)
- [~] Cleanup terverifikasi di storage/Neon lokal & dev; **staging dengan bucket nyata belum**
- [x] Runbook insiden tersedia (`ops/RUNBOOK.md`)
- [ ] Prasyarat P10 yang masih di luar kendali agen: bucket + kredensial + CORS nyata, TURN, OAuth Google, uji browser/perangkat (CSP baru!), keputusan domain cookie (DEC-082), pager untuk alarm, region service = region Neon.
