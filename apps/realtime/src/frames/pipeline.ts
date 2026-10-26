import sharp from "sharp";
import type { Metadata } from "sharp";
import { FRAME_LIMITS } from "@longroll/shared";
import type { ErrorCode, FrameContentType, HoleRect } from "@longroll/shared";

// Batasi memori & paralelisme libvips: satu decode per waktu, tanpa cache operasi.
sharp.cache(false);
sharp.concurrency(1);

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Magic bytes (bukan ekstensi / Content-Type klien). SVG/HTML/GIF/JPEG menyamar → null. */
export function sniffType(bytes: Uint8Array): FrameContentType | null {
  if (bytes.length >= 8 && PNG_SIG.every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  return null;
}

function ascii(b: Uint8Array, at: number, len: number) {
  return String.fromCharCode(...b.subarray(at, at + len));
}

/** Animasi: APNG (chunk acTL sebelum IDAT) atau WebP animasi (chunk ANIM / flag VP8X). */
export function isAnimated(bytes: Uint8Array, type: FrameContentType): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === "image/png") {
    let off = 8;
    while (off + 8 <= bytes.length) {
      const len = view.getUint32(off);
      const name = ascii(bytes, off + 4, 4);
      if (name === "acTL") return true;
      if (name === "IDAT" || name === "IEND") return false;
      off += 12 + len;
    }
    return false;
  }
  let off = 12;
  while (off + 8 <= bytes.length) {
    const name = ascii(bytes, off, 4);
    const len = view.getUint32(off + 4, true);
    if (name === "ANIM" || name === "ANMF") return true;
    if (name === "VP8X" && off + 8 < bytes.length && (bytes[off + 8]! & 0x02) !== 0) return true;
    off += 8 + len + (len % 2);
  }
  return false;
}

export type FrameProcessResult =
  | { ok: true; png: Buffer; width: number; height: number; holes: HoleRect[]; edgeColor: string }
  | { ok: false; error: ErrorCode; reason?: string };

/**
 * Validasi + re-encode frame upload (10 §9, DEC-041). Semua di server; validasi klien hanya UX.
 * 1) magic bytes cocok dengan tipe deklarasi; 2) header: dimensi & jumlah piksel DIPERIKSA SEBELUM
 * decode (bomb ditolak tanpa alokasi besar); 3) tolak animasi; 4) decode dengan `limitInputPixels`;
 * 5) re-encode PNG baru (metadata & chunk tak dikenal dibuang); 6) analisis alpha → lubang slot.
 */
export async function processFrame(raw: Uint8Array, declared: FrameContentType): Promise<FrameProcessResult> {
  if (raw.byteLength > FRAME_LIMITS.MAX_BYTES) return { ok: false, error: "FRAME_TOO_LARGE" };
  const type = sniffType(raw);
  if (!type || type !== declared) return { ok: false, error: "FRAME_UNSUPPORTED", reason: type ? "TYPE_MISMATCH" : "MAGIC" };
  if (isAnimated(raw, type)) return { ok: false, error: "FRAME_UNSUPPORTED", reason: "ANIMATED" };

  const opts = { limitInputPixels: FRAME_LIMITS.MAX_INPUT_PIXELS, failOn: "error" as const, sequentialRead: true };
  let meta: Metadata;
  try {
    meta = await sharp(raw, { ...opts, limitInputPixels: false }).metadata();
  } catch {
    return { ok: false, error: "FRAME_DECODE_FAILED" };
  }
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if ((meta.pages ?? 1) > 1) return { ok: false, error: "FRAME_UNSUPPORTED", reason: "ANIMATED" };
  if (!w || !h) return { ok: false, error: "FRAME_DECODE_FAILED" };
  const long = Math.max(w, h);
  if (long > FRAME_LIMITS.MAX_LONG_SIDE || w * h > FRAME_LIMITS.MAX_INPUT_PIXELS) return { ok: false, error: "FRAME_DIMENSIONS", reason: "TOO_BIG" };
  if (long < FRAME_LIMITS.MIN_LONG_SIDE) return { ok: false, error: "FRAME_DIMENSIONS", reason: "TOO_SMALL" };

  try {
    const png = await sharp(raw, opts).ensureAlpha().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
    const { holes, edgeColor } = await analyzeAlpha(png, w, h);
    return { ok: true, png, width: w, height: h, holes, edgeColor };
  } catch {
    return { ok: false, error: "FRAME_DECODE_FAILED" };
  }
}

/**
 * Lubang = komponen terhubung (4-arah) dengan alpha < 16 dan luas ≥ 2% kanvas, dihitung pada versi
 * kecil (≤ 256 px) lalu dipetakan ke koordinat asli. Juga warna tepi dominan (latar CONTAIN).
 */
export async function analyzeAlpha(png: Buffer, w: number, h: number): Promise<{ holes: HoleRect[]; edgeColor: string }> {
  const scale = Math.min(1, FRAME_LIMITS.HOLE_ANALYSIS_PX / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));
  const { data } = await sharp(png).resize(sw, sh, { fit: "fill", kernel: "nearest" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = sw * sh;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = data[i * 4 + 3]! < FRAME_LIMITS.HOLE_ALPHA_MAX ? 1 : 0;

  const seen = new Uint8Array(n);
  const holes: (HoleRect & { area: number })[] = [];
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (!mask[start] || seen[start]) continue;
    let minX = sw, minY = sh, maxX = 0, maxY = 0, area = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % sw;
      const y = (i - x) / sw;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const nb = [x > 0 ? i - 1 : -1, x < sw - 1 ? i + 1 : -1, y > 0 ? i - sw : -1, y < sh - 1 ? i + sw : -1];
      for (const j of nb) {
        if (j >= 0 && mask[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (area / n >= FRAME_LIMITS.HOLE_MIN_AREA) {
      holes.push({ x: minX / scale, y: minY / scale, w: (maxX - minX + 1) / scale, h: (maxY - minY + 1) / scale, area });
    }
  }
  const top = holes.sort((a, b) => b.area - a.area).slice(0, FRAME_LIMITS.MAX_HOLES);
  const r2 = (v: number) => Math.round(v * 100) / 100;

  // Warna tepi: rata-rata piksel tepi yang cukup buram.
  let rs = 0, gs = 0, bs = 0, cnt = 0;
  for (let x = 0; x < sw; x++) for (const y of [0, sh - 1]) addEdge(x, y);
  for (let y = 0; y < sh; y++) for (const x of [0, sw - 1]) addEdge(x, y);
  function addEdge(x: number, y: number) {
    const i = (y * sw + x) * 4;
    if (data[i + 3]! < 128) return;
    rs += data[i]!;
    gs += data[i + 1]!;
    bs += data[i + 2]!;
    cnt++;
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
  const edgeColor = cnt ? `#${hex(rs / cnt)}${hex(gs / cnt)}${hex(bs / cnt)}`.toUpperCase() : "#FFFFFF";
  return { holes: top.map(({ x, y, w: hw, h: hh }) => ({ x: r2(x), y: r2(y), w: r2(hw), h: r2(hh) })), edgeColor };
}
