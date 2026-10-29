import { STUDIO_LIMITS } from "../studio/limits";
import type { CropRect, ElementSnapshot } from "../editor/schema";

/**
 * Rencana export (12 §4, DEC-042): ukuran output, tiling, peringatan kualitas, nama file, metadata PNG.
 * Semua murni → bisa diuji tanpa browser; render piksel ada di klien (`drawDocument`).
 */

export type ExportPresetId = "ASLI" | "CETAK_300" | "STORY";
export type ExportFormat = "png" | "jpeg";

export const EXPORT_PRESETS: { id: ExportPresetId; label: string; hint: string }[] = [
  { id: "ASLI", label: "Asli", hint: "Ukuran dasar layout" },
  { id: "CETAK_300", label: "Cetak 300 dpi", hint: "2× ukuran dasar" },
  { id: "STORY", label: "Story", hint: "1080 × 1920, hasil di-contain" },
];

/** Batas canvas aman perangkat (iOS ≈ 16,7 juta piksel per canvas) → tiling di atas ini. */
export const EXPORT_LIMITS = {
  maxTilePx: 16_000_000,
  maxTileSide: 4096,
  maxSide: STUDIO_LIMITS.MAX_OUTPUT_PX,
  /** Cetak 300 dpi pada strip 2×6" = 600×1800 → ×2 (DPI efektif 600/2=300 per inci dasar). */
  printDpi: 300,
  jpegQuality: 0.92,
  minCellPx: STUDIO_LIMITS.MIN_CELL_PX_WARN,
  upscaleWarn: STUDIO_LIMITS.FRAME_UPSCALE_WARN,
} as const;

export interface ExportSize {
  /** Ukuran bitmap akhir (px). */
  width: number;
  height: number;
  /** Skala seragam kanvas dasar → output (isi layout). */
  scale: number;
  /** Offset penempatan isi di kanvas output (preset Story: contain di tengah). */
  offsetX: number;
  offsetY: number;
  /** Preset diturunkan karena melewati safeguard 8192 px (diberitahukan ke pengguna). */
  reduced: boolean;
  dpi: number | null;
}

/** Ukuran output; sisi terpanjang tak pernah > 8192 px (DEC-042) — preset "Cetak" diturunkan ke kelipatan terbesar yang muat. */
export function computeExportSize(base: { w: number; h: number }, preset: ExportPresetId): ExportSize {
  const cap = EXPORT_LIMITS.maxSide;
  const long = Math.max(base.w, base.h);
  if (preset === "STORY") {
    const W = 1080;
    const H = 1920;
    const s = Math.min(W / base.w, H / base.h);
    return { width: W, height: H, scale: s, offsetX: (W - base.w * s) / 2, offsetY: (H - base.h * s) / 2, reduced: false, dpi: null };
  }
  const want = preset === "CETAK_300" ? 2 : 1;
  let f = want;
  let reduced = false;
  while (f > 1 && long * f > cap) {
    f -= 1;
    reduced = true;
  }
  if (long * f > cap) {
    // Bahkan 1× melewati batas (layout 32 cell panjang): skala turun seragam agar sisi terpanjang = 8192.
    const s = cap / long;
    return { width: Math.floor(base.w * s), height: Math.floor(base.h * s), scale: s, offsetX: 0, offsetY: 0, reduced: true, dpi: null };
  }
  return { width: Math.round(base.w * f), height: Math.round(base.h * f), scale: f, offsetX: 0, offsetY: 0, reduced, dpi: preset === "CETAK_300" ? EXPORT_LIMITS.printDpi : null };
}

export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function needsTiling(width: number, height: number): boolean {
  return width * height > EXPORT_LIMITS.maxTilePx || Math.max(width, height) > EXPORT_LIMITS.maxTileSide;
}

/** Tile persegi panjang yang menutup seluruh output tanpa tumpang tindih; tiap tile ≤ 16 juta piksel & sisi ≤ 4096. */
export function tilePlan(width: number, height: number): Tile[] {
  if (!needsTiling(width, height)) return [{ x: 0, y: 0, w: width, h: height }];
  const tw = Math.min(width, EXPORT_LIMITS.maxTileSide);
  const th = Math.max(1, Math.floor(Math.min(EXPORT_LIMITS.maxTileSide, EXPORT_LIMITS.maxTilePx / tw)));
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y += th) for (let x = 0; x < width; x += tw) tiles.push({ x, y, w: Math.min(tw, width - x), h: Math.min(th, height - y) });
  return tiles;
}

export interface ExportQualityWarning {
  code: "SMALL_CELL" | "UPSCALE";
  elementId: string;
  message: string;
}

/**
 * Peringatan kualitas (NFR-12): sisi pendek foto di output < 240 px, atau foto harus diperbesar > 1.25× dari
 * piksel sumbernya. Bukan penolakan.
 */
export function qualityWarnings(elements: (ElementSnapshot & { id: string })[], scale: number): ExportQualityWarning[] {
  const out: ExportQualityWarning[] = [];
  for (const e of elements) {
    if (e.type !== "photo" || e.hidden) continue;
    const w = Number(e.w) * Number(e.scaleX) * scale;
    const h = Number(e.h) * Number(e.scaleY) * scale;
    if (Math.min(w, h) < EXPORT_LIMITS.minCellPx) out.push({ code: "SMALL_CELL", elementId: e.id, message: `Foto ${String(e.ownerName ?? "")} cuma ${Math.round(Math.min(w, h))} px di ukuran ini. Coba ukuran lebih besar.` });
    const crop = e.crop as CropRect;
    const srcW = crop.w * Number(e.srcW);
    const up = w / Math.max(1, srcW);
    if (up > EXPORT_LIMITS.upscaleWarn) out.push({ code: "UPSCALE", elementId: e.id, message: `Foto ${String(e.ownerName ?? "")} bakal sedikit buram (${up.toFixed(2)}× diperbesar).` });
  }
  return out;
}

/** `LONGROLL_{CODE}_sesi{n}_{YYYY-MM-DD}.{ext}` (12 §4). Kode room dibersihkan agar aman sebagai nama file. */
export function exportFileName(code: string, sessionIndex: number, format: ExportFormat, date: Date): string {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `LONGROLL_${code.replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}_sesi${sessionIndex}_${d}.${format === "png" ? "png" : "jpg"}`;
}

// ---------------------------------------------------------------- PNG: chunk pHYs (300 dpi)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, init = 0xffffffff): number {
  let c = init;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return c >>> 0;
}

export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

/** Chunk pHYs (piksel per meter) untuk dpi tertentu. */
export function physChunk(dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254);
  const d = new Uint8Array(9);
  const dv = new DataView(d.buffer);
  dv.setUint32(0, ppm);
  dv.setUint32(4, ppm);
  d[8] = 1; // meter
  return pngChunk("pHYs", d);
}

/** Sisipkan pHYs setelah IHDR pada PNG yang sudah jadi (mengganti pHYs lama bila ada). */
export function addPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 33 || sig.some((b, i) => png[i] !== b)) throw new Error("bukan PNG");
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let off = 8;
  let inserted = false;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  while (off + 12 <= png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(...png.subarray(off + 4, off + 8));
    const end = off + 12 + len;
    if (type !== "pHYs") parts.push(png.subarray(off, end));
    if (type === "IHDR" && !inserted) {
      parts.push(physChunk(dpi));
      inserted = true;
    }
    off = end;
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
