# 01 — Product Vision

| Atribut | Nilai |
|---|---|
| Versi | 1.1.0 |
| Status | CONFIRMED untuk misi & prinsip; indikator sukses berstatus PROPOSED |

## 1. Misi

Menghadirkan pengalaman photobooth mal, yaitu masuk bilik, hitung mundur, cekrek, lalu ketawa lihat hasilnya, untuk teman-teman yang **tidak berada di tempat yang sama**.

## 2. Value proposition

| Untuk | Yang | LONGROLL memberi |
|---|---|---|
| Teman/pasangan/keluarga yang terpisah jarak | Ingin kenang-kenangan foto bareng, bukan sekadar screenshot video call | Satu room dengan 4 kamera live, capture tersinkron, dan hasil berformat photobooth (strip, grid, group, collage) |
| Grup yang suka hal spontan | Tidak mau ribet daftar akun | Bikin room dalam 2 langkah, kirim link, langsung masuk |
| Peserta yang "gagal" di satu foto | Tidak mau grup mengulang semuanya | Retake individual: hanya foto dia yang diulang, dan temannya tetap bisa melihat momen gagalnya |
| Grup yang ingin hasil personal | Ingin menghias bersama | Editor kolaboratif real-time: stiker, teks, coretan, frame, siapa pun bisa ikut |

## 3. Target audiens

| Segmen | Ciri | Implikasi produk |
|---|---|---|
| **Utama:** Remaja akhir–dewasa muda (±17–30), Indonesia | Mobile-first, akrab dengan budaya photobooth Korea ("self-photo studio"), sering video call | Mobile kelas satu, copy bahasa Indonesia santai, estetika frame Korea/scrapbook |
| Pasangan LDR | 2 peserta, sering malam hari | Sesi 2 orang harus terasa lengkap, bukan "kurang orang" |
| Keluarga terpisah kota | Kemampuan teknis beragam | Alur sederhana, pesan izin kamera jelas |
| Komunitas/teman kerja remote | Desktop, acara singkat | Kursor & kolaborasi desktop nyaman |

## 4. Use case utama

| ID | Use case | Mode tipikal |
|---|---|---|
| UC-01 | Empat sahabat beda kota foto bareng malam minggu | Photo Strip, beberapa sesi |
| UC-02 | Pasangan LDR bikin strip tiap bulan | Photo Strip / Grid |
| UC-03 | Ucapan ulang tahun teman yang jauh | Freeform Collage + teks |
| UC-04 | Foto grup tim remote untuk postingan | Group Shot |
| UC-05 | Satu orang bikin room, sisanya menyusul via link | Semua |

## 5. Diferensiasi

1. **Retake individual yang sosial.** Satu orang mengulang, foto yang lain tetap aman, dan semua orang bisa melihat foto gagalnya selama momen retake berlangsung. Ini inti produk (REQ-CAP-04..06).
2. **Demokratis tanpa host.** Mode dipilih lewat voting. Siapa pun bisa cekrek, menahan countdown, dan mengedit.
3. **Output photobooth sungguhan.** Hasilnya strip, grid, dan collage yang siap cetak atau dibagikan, bukan screenshot.
4. **Frame sebagai sumber keseruan.** Korean strip, editorial, film retro, scrapbook, pastel, grid custom, plus upload frame sendiri.
5. **Sementara secara desain.** Tidak ada akun, tidak ada histori permanen, room dihapus setelah kedaluwarsa.

## 6. Prinsip produk

| ID | Prinsip | Konsekuensi untuk tim |
|---|---|---|
| PR-01 | **Foto adalah pahlawan.** | Kamera/foto selalu elemen terbesar. Status cukup ditaruh sebagai label kecil di pojok. |
| PR-02 | **Setara, tanpa host.** | Tidak ada aksi eksklusif kecuali atas perangkat & foto milik sendiri. |
| PR-03 | **Diam bukan berarti setuju.** | Tidak ada auto-accept. Perubahan besar selalu terlihat oleh semua orang. |
| PR-04 | **Kekacauan yang bisa dipulihkan.** | Edit simultan boleh, tapi selalu ada "Balikin". |
| PR-05 | **Jujur soal privasi.** | Copy hanya menjanjikan apa yang benar-benar dilakukan sistem. |
| PR-06 | **HP bukan warga kelas dua.** | Setiap fitur dirancang untuk jempol, bukan cuma "muat". |
| PR-07 | **Seru tapi tenang.** | Keseruan datang dari frame, stiker, dan interaksi. UI-nya sendiri tetap rapi dan tidak penuh dekorasi. |

## 7. Pengalaman yang dituju (narasi)

> Nadia membuka LONGROLL di HP, mengetik nama, lalu menekan **Bikin room**. Ia mengirim link `longroll.app/r/BOBA27` ke grup. Raka dan Sasa masuk dari laptop, Bimo dari HP. Kamera keempatnya muncul di lobby. Mereka memilih **Photo Strip** (3 lawan 1). Sasa mengganti frame ke **Film 400**, dan semua melihat perubahannya langsung. Raka menekan shutter, hitung mundur 5 detik, cekrek. Bimo merem. Ia menekan **Ulang**. Tiga orang lainnya melihat foto merem Bimo dan feed live-nya saat ia mencoba lagi, sambil ketawa. Foto mereka sendiri tidak berubah. Setelah 4 shot, mereka menempel stiker dan teks bareng. Raka menggeser teks yang baru ditaruh Nadia, dan Nadia menekan **Balikin**. Nadia mengunduh hasilnya, Sasa menyimpannya ke Drive. Mereka lanjut **Sesi baru** dan memilih **Group Shot**.

## 8. Batas produk (product boundaries)

**Termasuk (scope rilis pertama):** semua requirement `CONFIRMED` di 02.

**Tidak termasuk:**

| Hal | Alasan | Ref |
|---|---|---|
| Akun, profil, histori lintas room | Bertentangan dengan konsep sementara | DEC-094, DEC-099 |
| Lebih dari 4 peserta / penonton | Batas produk | DEC-097 |
| Video, GIF, boomerang | Tidak ada di brief | DEC-096 |
| Hapus latar (segmentasi) | Berat di HP, ditunda | DEC-095 |
| Voice chat | Belum diputuskan | DEC-076 (OPEN) |
| Penyimpanan permanen di server LONGROLL | Bertentangan dengan lifecycle | REQ-LIFE-05 |
| Moderasi konten oleh LONGROLL atas foto room privat | Tidak ada di brief; lihat batas abuse di 15 §9 | 15 |

## 9. Indikator sukses (PROPOSED)

Angka berikut adalah **target awal yang diusulkan**, bukan data. Cara pengukurannya harus menghormati DEC-056 (analitik agregat tanpa media/PII).

| ID | Indikator | Definisi | Target awal (PROPOSED) |
|---|---|---|---|
| KPI-01 | Room-to-capture rate | % room dengan ≥ 2 peserta yang menyelesaikan ≥ 1 shot | ≥ 60% |
| KPI-02 | Session completion | % sesi yang mencapai Hasil Akhir | ≥ 70% |
| KPI-03 | Retake usage | % sesi dengan ≥ 1 retake (sinyal fitur inti dipakai) | Diamati, tanpa target |
| KPI-04 | Multi-session | % room dengan ≥ 2 sesi | ≥ 30% |
| KPI-05 | Export | % sesi selesai yang diunduh atau disimpan ke Drive | ≥ 50% |
| KPI-06 | Kegagalan media | % peserta yang gagal mendapat ≥ 1 feed remote dalam 15 detik | ≤ 3% |
| KPI-07 | Mobile parity | Selisih KPI-02 antara mobile dan desktop | ≤ 10 poin persentase |
