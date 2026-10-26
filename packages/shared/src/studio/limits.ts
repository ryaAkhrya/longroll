/**
 * Safeguard teknis studio (DEC-042, PROPOSED) & batas frame (DEC-041, DEC-067) — SATU sumber angka.
 * Dipakai validator server, UI, dan export. Menurunkan nilai di bawah ini butuh persetujuan pemilik produk.
 */
export const STUDIO_LIMITS = {
  /** Jumlah shot per sesi 1..MAX_SHOTS. */
  MAX_SHOTS: 8,
  /** Batas 4 peserta (REQ-ROOM-06, CONFIRMED). */
  MAX_PARTICIPANTS: 4,
  /** Photo cell per sesi = MAX_SHOTS × 4. */
  MAX_CELLS: 32,
  /** Grid: baris × kolom ≤ 32, masing-masing ≤ 8. */
  MAX_GRID_CELLS: 32,
  MAX_GRID_SIDE: 8,
  /** Sisi terpanjang output (base & export). */
  MAX_OUTPUT_PX: 8192,
  MIN_OUTPUT_PX: 600,
  /** Sisi pendek cell saat export di bawah ini → peringatan kualitas (NFR-12), bukan penolakan. */
  MIN_CELL_PX_WARN: 240,
  /** Ukuran slot minimum (base px) & porsi minimum di dalam kanvas (10 §7). */
  MIN_SLOT_PX: 60,
  MIN_SLOT_INSIDE: 0.5,
  /** Jarak snapping (base px). */
  SNAP_PX: 6,
  /** Group Shot: 1–4 shot (10 §3). */
  GROUP_MAX_SHOTS: 4,
  MAX_GAP_PX: 120,
  MAX_RADIUS_PX: 200,
  /** Zoom foto/frame: ambang peringatan upscale artwork (10 §10). */
  FRAME_UPSCALE_WARN: 1.25,
  /** COVER memotong > 15% artwork → peringatan. */
  FRAME_COVER_CROP_WARN: 0.15,
} as const;

export const FRAME_LIMITS = {
  MAX_BYTES: 10 * 1024 * 1024,
  MIN_LONG_SIDE: 600,
  MAX_LONG_SIDE: 6000,
  /** Batas piksel decode (sharp `limitInputPixels`): 6000 × 6000. Gambar lebih besar ditolak sebelum decode. */
  MAX_INPUT_PIXELS: 6000 * 6000,
  CONTENT_TYPES: ["image/png", "image/webp"] as const,
  /** 20 frame custom per room, 20 upload/jam/peserta (DEC-067). */
  QUOTA_PER_ROOM: 20,
  UPLOADS_PER_HOUR: 20,
  /** Signed URL ≤ 10 menit (15 §7). */
  URL_TTL_SEC: 600,
  /** Presign upload berlaku 10 menit; upload yang belum selesai dibersihkan setelahnya. */
  UPLOAD_TTL_SEC: 600,
  /** Analisis lubang: alpha < 16, luas ≥ 2% kanvas (10 §9). */
  HOLE_ALPHA_MAX: 16,
  HOLE_MIN_AREA: 0.02,
  /** Resolusi analisis alpha (sisi terpanjang) — cukup untuk deteksi lubang, murah memori. */
  HOLE_ANALYSIS_PX: 256,
  MAX_HOLES: 32,
  MAX_FILE_NAME: 120,
} as const;

export type FrameContentType = (typeof FRAME_LIMITS.CONTENT_TYPES)[number];
