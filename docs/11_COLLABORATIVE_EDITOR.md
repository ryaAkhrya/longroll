# 11 — Collaborative Editor

| Atribut | Nilai |
|---|---|
| Versi | 1.1.0 |
| Requirement | REQ-EDIT-01..14, REQ-ROOM-10..11, REQ-MOB-06..07 |
| Fase | P07 |
| Layar | SCR-16 (`02_Desktop/07_Editor.webp`, `03_Mobile/07_Editor.webp`) |
| Keputusan | DEC-031 (Yjs), DEC-032 (undo), DEC-033 (soft-lock), DEC-039 (Konva), DEC-055 (aset stiker) |

## 1. Filosofi

Editor sengaja **demokratis dan sedikit chaos**: semua orang boleh mengubah apa saja kapan saja (REQ-EDIT-11, -13). Konsistensi dijaga oleh CRDT (semua klien konvergen ke state yang sama), dan rasa aman dijaga oleh **visibilitas** (kursor, outline, toast) dan **pemulihan** ("Balikin"). Tidak ada kunci eksklusif.

## 2. Model dokumen bersama (DEC-031, RECOMMENDED)

Satu `Y.Doc` per sesi. Struktur:

```text
Y.Doc (session:{sessionId})
├─ meta: Y.Map
│   ├─ canvas: { w, h }              # base px (10 §4)
│   ├─ frameRef: string              # FrameTemplate.id
│   ├─ frameStyle: { bgColor, overlayOpacity, adapt }
│   ├─ globalFilter: FilterPreset | null
│   └─ schemaVersion: 1
├─ elements: Y.Map<elementId, Y.Map>
│   └─ <element> : Y.Map
│        ├─ type: 'photo' | 'sticker' | 'text' | 'doodle' | 'shape'
│        ├─ x, y, scaleX, scaleY, rotation, opacity
│        ├─ z: string                 # fractional index (urutan layer)
│        ├─ hidden: boolean
│        ├─ createdBy, updatedBy: participantId
│        └─ (properti per tipe, lihat §3)
└─ history: Y.Array<HistoryEntry>     # riwayat bersama (§7.2), maks. 200 entri (FIFO)
```

**Kenapa `z` fractional index, bukan `Y.Array` urutan:** memindahkan elemen di `Y.Array` = delete + insert, yang bisa menduplikasi elemen jika dilakukan bersamaan. Dengan `z` berupa string fractional index (misal library `fractional-indexing`), setiap perubahan urutan hanya mengubah satu properti (LWW). Urutan render: sort by `z`, lalu `elementId` sebagai tie-breaker.

## 3. Tipe elemen

| Tipe | Properti khusus | Sumber |
|---|---|---|
| `photo` | `attemptId`, `slotId?`, `crop {x,y,w,h}` (dalam koordinat foto asli), `zoom`, `flipX`, `filter` | Foto accepted (dibuat otomatis saat masuk editor sesuai BindingPlan, §13) |
| `sticker` | `assetId`, `tint?` | Library stiker (DEC-055) |
| `text` | `content: Y.Text`, `fontStyle: 'serif'|'display'|'rounded'`, `color`, `fontSize`, `align`, `stroke?` | Alat Teks |
| `doodle` | `points: string` (encoded, immutable setelah stroke selesai), `color`, `width` | Alat Coret |
| `shape` | `shape: 'heart'|'star'|'circle'|'tape'`, `fill` | Dekorasi (P2, opsional) |

Gaya font teks (V1 sheet mobile): `Serif` = Instrument Serif Italic, `Tegas` = Bricolage Grotesque condensed, `Bulat` = Figtree semibold.

## 4. Operasi

| Operasi | Desktop | Mobile | Transaksi Yjs |
|---|---|---|---|
| Pilih | Klik | Tap | Awareness `selection` (bukan dokumen) |
| Geser | Drag | Drag 1 jari | **Saat drag:** posisi transient lewat awareness (20 Hz). **Saat dilepas:** 1 transaksi `{x,y}` |
| Resize | Handle sudut (Shift = bebas rasio) | Pinch | 1 transaksi saat selesai |
| Rotasi | Handle rotasi (Shift = snap 15°) | Rotate 2 jari (snap 0/90 ±4°) | 1 transaksi saat selesai |
| Crop foto | Mode crop (double-click foto) | Sheet foto → **Crop** | `crop` |
| Zoom foto di slot | Scroll di mode crop | Pinch di mode crop | `zoom`, `crop` |
| Filter | Panel Filter (global atau foto terpilih) | Sheet Filter | `filter` / `meta.globalFilter` |
| Stiker | Klik/drag dari panel | Tap di sheet → muncul di tengah viewport | Buat elemen |
| Teks | Klik alat Teks → klik kanvas | Tap **Teks** → elemen baru + keyboard | Buat elemen + `Y.Text` |
| Doodle | Mode Coret, drag | Mode Coret, 1 jari | Stroke transient via awareness; commit saat pointerup (disederhanakan Ramer–Douglas–Peucker, maks. 2000 titik) |
| Layer | Panel Layer / menu konteks | Long-press → menu | `z` |
| Hapus | `Delete`/`Backspace` | Ikon tempat sampah di sheet | Hapus key di `elements` |
| Duplikat | `Ctrl/Cmd+D` | Menu konteks | Buat elemen |
| Ganti frame | Panel Frame | Sheet Frame | `meta.frameRef` |

Batas (PROPOSED): maks. 200 elemen per dokumen; ukuran update tunggal ≤ 256 KB; dokumen ≤ 2 MB.

## 5. Kolaborasi simultan & konflik

| Situasi | Hasil CRDT | UX |
|---|---|---|
| Dua orang menggeser elemen yang sama | Properti `x,y` konvergen ke salah satu penulis (deterministik oleh Yjs). | Penulis yang "kalah" melihat toast "Raka mindahin {elemen} yang barusan kamu atur · **Balikin**". |
| Satu menggeser, satu mengubah warna | Keduanya diterapkan (properti berbeda). | Tidak ada toast. |
| Satu menghapus, satu sedang mengedit | Hapus menang (entri map dihapus). | Editor yang sedang mengedit: "Bimo hapus stiker yang lagi kamu edit · **Balikin**" (membuat ulang dari snapshot di history). |
| Dua orang mengetik di teks yang sama | `Y.Text` menggabungkan karakter. | Outline warna kedua peserta pada teks. |
| Ganti frame bersamaan | LWW `meta.frameRef`. | Toast ke yang kalah. |

**Deteksi "kalah"** (untuk toast): klien menyimpan `lastLocalWrite[elementId][prop] = t` selama 10 detik. Jika update remote mengubah properti yang sama dalam jendela itu → toast. Toast untuk elemen yang sama digabung (maks. 1 per 3 detik).

**Soft-lock (DEC-033):** awareness `{selection, dragging}` membuat elemen ditampilkan dengan outline warna peserta + avatar. Peserta lain tetap bisa mengambil alih elemen itu; saat terjadi, kedua pihak melihat outline berganti.

## 6. Presence editor

| Data awareness | Frekuensi | Dipakai untuk |
|---|---|---|
| `cursor {x,y}` (koordinat dokumen) | ≤ 20 Hz | Kursor desktop |
| `cursorLabel` ("nempel stroberi") | Saat aksi berubah | Label kursor |
| `selection: elementId[]` | Saat berubah | Outline soft-lock |
| `transient {elementId, x, y, rotation, scale}` | ≤ 20 Hz selama drag | Gerakan live sebelum commit |
| `doodleDraft {points}` | ≤ 15 Hz selama menggambar | Coretan live |
| `tool` | Saat berubah | Info di daftar peserta |

Awareness tidak persisten dan dibuang saat peserta putus.

## 7. Undo & riwayat (DEC-032, PROPOSED)

### 7.1 Undo/Redo pribadi

- `Y.UndoManager` dengan `trackedOrigins = {localOrigin}` dan `captureTimeout = 500 ms`.
- Undo hanya membatalkan transaksi milik peserta itu sendiri, walaupun ada perubahan orang lain di antaranya.
- Shortcut: `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`. Mobile: tombol di overlay atas.
- Batas stack: 100 langkah per peserta, hanya untuk sesi aktif; tidak dibawa saat reload (dibangun ulang kosong).

### 7.2 Riwayat bersama + "Balikin"

```text
HistoryEntry {
  id, at, by: participantId,
  label: 'nempel 🍓🍓' | 'coretan pink' | 'teks "besties ♡"' | 'ganti frame ke Film 400' ...,
  elementId?,
  before: Partial<ElementSnapshot> | null,   # null = elemen dibuat
  after:  Partial<ElementSnapshot> | null    # null = elemen dihapus
}
```

- Entri dicatat untuk transaksi **commit** (bukan transient), digabung per elemen per 2 detik.
- **Balikin** pada entri E (siapa pun boleh):
  1. Jika state elemen saat ini == `E.after` untuk properti terkait → terapkan `E.before` sebagai transaksi baru.
  2. Jika sudah diubah lagi oleh orang lain → konfirmasi: "Elemen ini udah diubah lagi sama Sasa. Tetap balikin ke versi Raka?".
  3. Balikin selalu menambah entri baru ("Nadia balikin 'nempel 🍓🍓'"). Riwayat tidak pernah dihapus.
- UI: panel kanan desktop **Riwayat · siapa aja bisa balikin**. Mobile: di sheet Layer → tab Riwayat.

## 8. Sinkronisasi state

| Aspek | Spesifikasi |
|---|---|
| Transport | Pesan Yjs (`sync step 1/2`, `update`, `awareness`) dibungkus dalam event WebSocket room (`editor.sync`, `editor.update`, `editor.awareness`). |
| Server | Room actor menyimpan `Y.Doc` per sesi di memori, menerapkan update, lalu me-relay ke peserta lain. Server memvalidasi ukuran update dan keanggotaan. |
| Persistensi | Snapshot `Y.encodeStateAsUpdate` ke Redis setiap 5 detik bila ada perubahan dan saat `FINAL`. Saat `FINAL`, snapshot juga disimpan ke object storage untuk re-render galeri (DEC-060). |
| Reconnect | Klien mengirim state vector → server membalas diff. Update lokal yang dibuat saat offline (antre di IndexedDB/memori) dikirim setelah sinkron dan di-merge oleh CRDT. |
| Validasi | Server memeriksa skema (tipe elemen, rentang angka, `assetId` ada di katalog, `attemptId` milik sesi ini dan berstatus `ACCEPTED`). Update yang tidak valid ditolak dan klien mengirim ulang state penuh. |
| Read-only | Setelah sesi `CLOSED`, server menolak update. |

## 9. Filter

| Lingkup | Lokasi | Siapa |
|---|---|---|
| Filter global (semua foto) | `meta.globalFilter` | Semua |
| Filter per foto | `element.filter` (mengalahkan global) | Semua |

Preset: 05 §12. Render harus identik di pratinjau dan export (10 §13).

## 10. Performa

- Konva: layer statis (frame, latar) di-`cache()`. Layer interaktif dipisah. Batasi redraw dengan `batchDraw`.
- Foto memakai preview (≤ 1600 px) di editor. Resolusi penuh hanya saat export.
- Stiker: atlas sprite / SVG yang di-rasterisasi sekali per ukuran.
- Kursor dan transient dirender di layer overlay terpisah.
- Target: interaksi drag 60 fps desktop, ≥ 30 fps HP menengah (TC-PERF-021).

## 11. Model interaksi mobile

Ringkasan dari 06 §7.1:

- Kanvas fullscreen. Tap elemen → sheet kontekstual sesuai tipe.
- Dock alat bisa dilipat. Mode **Coret** mengubah gestur: 1 jari = gambar, 2 jari = pan/zoom.
- Tombol **Selesai** di overlay atas = "Selesai edit" (DEC-059), dengan konfirmasi ringan "Selesai buat semua?".
- Panel Layer sebagai alternatif aksesibel untuk memilih/memindah/menghapus elemen tanpa gestur.

## 12. Aksesibilitas

- Setiap elemen punya label ("Stiker stroberi oleh Raka", "Teks 'besties ♡'").
- Panel Layer: daftar elemen yang bisa difokus; panah = geser 4 base px (Shift = 20), `[`/`]` = urutan, `Delete` = hapus.
- Toast konflik bisa diakses keyboard (`F6` pindah ke region notifikasi).
- Kursor remote `aria-hidden`.

## 13. Masuk & keluar editor

- **Masuk:** saat shot terakhir `DONE`, server membuat `Y.Doc` sesi dengan elemen `photo` untuk setiap foto accepted, sesuai BindingPlan (10 §5, DEC-087), plus `meta` dari studio state. Seeding per jenis binding:
  - `CELL` → satu elemen `photo` dengan `slotId` slot itu.
  - `SHOT_GROUP` → satu elemen `photo` per peserta accepted, masing-masing dengan `slotId` + posisi sub-tile hasil susunan (ROW/COLUMN/GRID/BLEND).
  - `FREE` (Freeform) → satu elemen `photo` per cell accepted tanpa `slotId`, ditebar otomatis di kanvas.
  Seeding tidak bergantung pada jawaban DEC-061; editor hanya membaca plan yang sudah terkunci.
- **Selesai edit (DEC-059):** siapa pun → `session.finalize` → semua klien ke SCR-17. Dokumen tetap bisa dibuka lagi lewat **Balik edit**.
- **Read-only:** setelah sesi `CLOSED`.
