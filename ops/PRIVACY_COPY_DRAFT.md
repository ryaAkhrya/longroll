# Draf FAQ & kebijakan privasi LONGROLL (UNTUK DISETUJUI — belum dipublikasikan)

Sumber kalimat: kolom "Boleh" 15 §11. Tidak ada halaman FAQ/privasi di kode saat ini (P09 tidak membuat layar baru);
teks ini disiapkan untuk halaman yang akan ditambahkan setelah persetujuan pemilik produk. Kata "permanen" **tidak** dipakai.

## FAQ

**Siapa yang bisa masuk ke room-ku?**
Siapa pun yang punya link bisa masuk selama room belum penuh (maks. 4 orang). Bagikan link hanya ke orang yang kamu undang.
Kalau link-nya tersebar, kamu bisa keluar dan bikin room baru; link baru gak diketahui orang lain.

**Foto dan datanya disimpan di mana, sampai kapan?**
Room sementara: foto dan datanya dihapus setelah room kedaluwarsa. Room kedaluwarsa kalau semua orang keluar lebih dari
{N} menit (default 2 menit). Foto yang gak kepilih dihapus begitu sesi foto selesai.

**Apa yang kelihatan di server?**
Server memproses foto yang kamu unggah (cek format, kecilkan, buang metadata seperti lokasi) dan menyimpannya sementara
supaya semua orang di room bisa melihat hasilnya. Nama tampilan dan warna disimpan selama room ada. Kamera cuma nyala setelah
kamu izinkan, dan video langsung (live) tidak disimpan.

**Apakah ada akun atau host?**
Gak ada. Semua peserta setara. Kamu bisa keluar kapan saja.

**Apa yang terjadi dengan file yang aku unduh atau simpan ke Google Drive?**
File yang udah kamu unduh atau simpan ke Drive tetap aman di tempatmu dan di luar kendali LONGROLL. LONGROLL hanya membuat
file di Drive-mu saat kamu minta, dan gak membaca file lain. Kamu bisa memutus koneksi Drive kapan saja.

**Gimana kalau aku mau semua foto dihapus lebih cepat?**
Keluar dari room. Kalau semua orang keluar, room dan fotonya dihapus setelah masa tunggu berakhir.

## Kebijakan privasi (ringkas)
1. **Data yang diproses:** nama tampilan, foto yang kamu ambil/unggah, frame yang kamu unggah, pilihan dan hasil edit di room.
2. **Tujuan:** menjalankan photobooth bersama di room sementara.
3. **Retensi:** dihapus setelah room kedaluwarsa; kode room dicatat tanpa data pribadi selama 24 jam agar tidak dipakai ulang.
   Penyedia penyimpanan bisa menyimpan salinan internal sesuai kebijakan mereka; LONGROLL tidak mengklaim penghapusan dari
   cadangan penyedia.
4. **Google Drive:** token hanya ada di memori tab-mu, tidak dikirim ke server LONGROLL; izin yang diminta hanya untuk file yang dibuat LONGROLL.
5. **Keamanan:** koneksi dienkripsi (HTTPS/WSS). LONGROLL **tidak** end-to-end encrypted: server memproses foto yang diunggah.
6. **Analitik (DEC-056):** tidak ada analitik produk yang dipasang. Bila nanti ditambahkan: hanya agregat tanpa foto, nama, atau ID lintas room.

## Audit copy di aplikasi (15 §11) — hasil P09
| Lokasi | Kalimat | Status |
|---|---|---|
| Hero landing, meta description, penutup | "Room sementara: foto dan datanya dihapus setelah room kedaluwarsa." | Sesuai |
| Galeri (banner retensi) | "Setelah semua keluar dan room kedaluwarsa, foto dan datanya dihapus. Unduh yang kamu suka sebelum itu." | Sesuai |
| SCR-21 Room bubar | "…room dan fotonya udah dihapus. File yang udah kamu unduh atau simpan ke Drive tetap aman." | Sesuai (tanpa "permanen") |
| Pengecekan kamera (SCR-04) | "Kamera dipakai buat feed live … foto yang disimpan sementara sampai room bubar. Kamera cuma nyala setelah kamu izinkan." | Sesuai. Tautan ke halaman privasi **belum ada** (halaman belum dibuat) |
| Dialog keluar | "…room dan datanya dihapus setelah masa tunggu {N} menit berakhir." | Sesuai |
| SCR-19 undangan | "Hasil sesi sebelumnya tetap aman di galeri." | Kalimat dari spesifikasi 04 SCR-19; "aman" dipakai untuk "tidak hilang karena sesi baru", bukan jaminan keamanan. Disarankan diganti "tetap ada di galeri" saat copy disetujui ulang |
| Klaim terlarang (E2E, "privat sepenuhnya", "gak ada yang disimpan", "kami gak pernah lihat fotomu", "dihapus permanen") | — | Tidak ditemukan di kode |
