import { STUDIO_LIMITS } from "./limits";
import type { FrameAdapt, HoleRect, Insets } from "./types";

/**
 * Adaptasi artwork frame ke kanvas (10 §10). Aturan utama: artwork TIDAK PERNAH diskalakan non-uniform.
 * Hasil berupa daftar operasi gambar `drawImage(sx,sy,sw,sh, dx,dy,dw,dh)` dengan dw/sw === dh/sh
 * (tile terakhir yang terpotong memotong sumber & tujuan dengan faktor yang sama).
 */

export interface DrawOp {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export interface FrameTransform {
  mode: FrameAdapt;
  /** Skala seragam artwork → kanvas (base px). */
  scale: number;
  offsetX: number;
  offsetY: number;
  ops: DrawOp[];
  /** Porsi artwork yang terpotong (COVER). */
  cropFraction: number;
  /** COVER memotong > 15% → peringatan. */
  cropWarning: boolean;
  /** Bagian kanvas yang tidak tertutup artwork (CONTAIN) diisi warna latar. */
  letterbox: boolean;
}

type Size = { w: number; h: number };

const op = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, s: number): DrawOp => ({ sx, sy, sw, sh, dx, dy, dw: sw * s, dh: sh * s });

/** Ulangi potongan sumber (sx,sy,sw,sh) pada skala s untuk menutup area tujuan; tile terakhir dipotong seragam. */
function tile(src: HoleRect, s: number, area: HoleRect): DrawOp[] {
  const out: DrawOp[] = [];
  if (src.w <= 0 || src.h <= 0 || area.w <= 0 || area.h <= 0) return out;
  const tw = src.w * s;
  const th = src.h * s;
  for (let y = 0; y < area.h - 1e-6; y += th) {
    const dh = Math.min(th, area.h - y);
    for (let x = 0; x < area.w - 1e-6; x += tw) {
      const dw = Math.min(tw, area.w - x);
      out.push(op(src.x, src.y, dw / s, dh / s, area.x + x, area.y + y, s));
    }
  }
  return out;
}

export function computeFrameTransform(art: Size, canvas: Size, mode: FrameAdapt, nineSlice?: Insets): FrameTransform {
  const base = { mode, scale: 1, offsetX: 0, offsetY: 0, ops: [] as DrawOp[], cropFraction: 0, cropWarning: false, letterbox: false };
  if (!(art.w > 0 && art.h > 0 && canvas.w > 0 && canvas.h > 0)) return base;
  const contain = Math.min(canvas.w / art.w, canvas.h / art.h);
  const cover = Math.max(canvas.w / art.w, canvas.h / art.h);

  if (mode === "FIXED" || mode === "CONTAIN") {
    // FIXED: kanvas mengikuti rasio artwork (plan dari lubang) → sama dengan CONTAIN tanpa sisa.
    const s = contain;
    const ox = (canvas.w - art.w * s) / 2;
    const oy = (canvas.h - art.h * s) / 2;
    return { ...base, scale: s, offsetX: ox, offsetY: oy, ops: [op(0, 0, art.w, art.h, ox, oy, s)], letterbox: Math.abs(ox) > 0.5 || Math.abs(oy) > 0.5 };
  }
  if (mode === "COVER") {
    const s = cover;
    // Potong sumber agar tepat menutup kanvas.
    const sw = canvas.w / s;
    const sh = canvas.h / s;
    const sx = (art.w - sw) / 2;
    const sy = (art.h - sh) / 2;
    const cropFraction = 1 - (sw * sh) / (art.w * art.h);
    return {
      ...base,
      scale: s,
      offsetX: -sx * s,
      offsetY: -sy * s,
      ops: [op(sx, sy, sw, sh, 0, 0, s)],
      cropFraction,
      cropWarning: cropFraction > STUDIO_LIMITS.FRAME_COVER_CROP_WARN,
    };
  }
  if (mode === "PATTERN") {
    // Pola: tile pada skala ≤ 1 dengan sisi pendek tile ≤ 1/3 sisi pendek kanvas.
    const s = Math.min(1, Math.min(canvas.w, canvas.h) / 3 / Math.min(art.w, art.h));
    return { ...base, scale: s, ops: tile({ x: 0, y: 0, w: art.w, h: art.h }, s, { x: 0, y: 0, w: canvas.w, h: canvas.h }) };
  }
  // NINE_SLICE: sudut skala seragam, tepi & tengah DI-TILE (bukan stretch).
  const ins = nineSlice ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const t = clampInset(ins.top, art.h);
  const b = clampInset(ins.bottom, art.h - t);
  const l = clampInset(ins.left, art.w);
  const r = clampInset(ins.right, art.w - l);
  // Skala sudut: seragam, sudut harus muat di kanvas.
  let s = Math.min(contain, 1);
  if ((l + r) * s > canvas.w) s = canvas.w / (l + r);
  if ((t + b) * s > canvas.h) s = canvas.h / (t + b);
  const cw = art.w - l - r;
  const ch = art.h - t - b;
  const dl = l * s;
  const dr = r * s;
  const dt = t * s;
  const db = b * s;
  const midW = canvas.w - dl - dr;
  const midH = canvas.h - dt - db;
  const ops: DrawOp[] = [];
  // Sudut.
  if (l && t) ops.push(op(0, 0, l, t, 0, 0, s));
  if (r && t) ops.push(op(art.w - r, 0, r, t, canvas.w - dr, 0, s));
  if (l && b) ops.push(op(0, art.h - b, l, b, 0, canvas.h - db, s));
  if (r && b) ops.push(op(art.w - r, art.h - b, r, b, canvas.w - dr, canvas.h - db, s));
  // Tepi (tile satu arah) & tengah (tile dua arah).
  if (t && cw > 0) ops.push(...tile({ x: l, y: 0, w: cw, h: t }, s, { x: dl, y: 0, w: midW, h: dt }));
  if (b && cw > 0) ops.push(...tile({ x: l, y: art.h - b, w: cw, h: b }, s, { x: dl, y: canvas.h - db, w: midW, h: db }));
  if (l && ch > 0) ops.push(...tile({ x: 0, y: t, w: l, h: ch }, s, { x: 0, y: dt, w: dl, h: midH }));
  if (r && ch > 0) ops.push(...tile({ x: art.w - r, y: t, w: r, h: ch }, s, { x: canvas.w - dr, y: dt, w: dr, h: midH }));
  if (cw > 0 && ch > 0) ops.push(...tile({ x: l, y: t, w: cw, h: ch }, s, { x: dl, y: dt, w: midW, h: midH }));
  return { ...base, scale: s, ops };
}

function clampInset(v: number, max: number) {
  return Number.isFinite(v) ? Math.max(0, Math.min(v, max)) : 0;
}

/** Lubang artwork → koordinat kanvas dengan transform yang sama (slot tetap pas dengan lubang). */
export function transformHoles(holes: HoleRect[], t: Pick<FrameTransform, "scale" | "offsetX" | "offsetY">): HoleRect[] {
  return holes.map((h) => ({ x: h.x * t.scale + t.offsetX, y: h.y * t.scale + t.offsetY, w: h.w * t.scale, h: h.h * t.scale }));
}

/**
 * Peringatan kualitas (NFR-12): export memerlukan artwork diperbesar > 1.25× dari resolusi aslinya.
 * `artPx` = ukuran asli artwork (px), `exportScale` = faktor base → export.
 */
export function frameUpscale(t: Pick<FrameTransform, "scale">, exportScale: number): number {
  return t.scale * exportScale;
}

export function frameUpscaleWarning(t: Pick<FrameTransform, "scale">, exportScale: number): boolean {
  return frameUpscale(t, exportScale) > STUDIO_LIMITS.FRAME_UPSCALE_WARN;
}
