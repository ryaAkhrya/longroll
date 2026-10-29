import { filterCss } from "../studio/config";
import { FONT_STACK } from "../studio/scene";
import type { Scene, SceneDecor } from "../studio/scene";
import type { FilterPresetId, Fill } from "../studio/types";
import { decodePoints } from "../editor/doc";
import { stickerAsset } from "../editor/schema";
import type { CropRect, EditorMeta, ElementSnapshot } from "../editor/schema";

/**
 * SATU jalur render untuk editor (kanvas Konva memanggil fungsi ini lewat `Shape.sceneFunc`) DAN export
 * resolusi penuh (kanvas offscreen). Tidak ada jalur render kedua yang bisa berbeda hasilnya (10 §1, §13).
 * Murni Canvas2D; tipe konteks struktural supaya paket ini tidak butuh DOM lib (server/tes memakai mock perekam).
 */

export interface Ctx2D {
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(rad: number): void;
  scale(x: number, y: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
  fill(path?: unknown): void;
  stroke(path?: unknown): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  drawImage(img: unknown, ...args: number[]): void;
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): { addColorStop(o: number, c: string): void };
  globalAlpha: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  filter: string;
}

export interface ImageLike {
  naturalWidth: number;
  naturalHeight: number;
}

export interface DrawResources {
  /** Foto attempt (varian editor ≤1600 px atau full untuk export). null = belum/tidak termuat. */
  photo(attemptId: string): ImageLike | null;
  /** Artwork overlay frame custom. */
  overlay: ImageLike | null;
  /** `new Path2D(d)`. */
  path(d: string): unknown;
  /** Pola (titik/kertas) sebagai CanvasPattern. */
  pattern(fill: Fill, ctx: Ctx2D): unknown | null;
}

const FONTS: Record<string, { family: string; style: string }> = {
  serif: { family: FONT_STACK.serif, style: "italic" },
  display: { family: FONT_STACK.display, style: "bold" },
  rounded: { family: FONT_STACK.ui, style: "600" },
};

export function roundedRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (rr === 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// ---------------------------------------------------------------- geometri elemen

/** Kotak lokal elemen (pusat di 0,0) — dipakai kanvas editor untuk Transformer/hit area dan outline soft-lock. */
export function elementBounds(e: ElementSnapshot): { w: number; h: number } {
  switch (e.type) {
    case "photo":
    case "sticker":
      return { w: Number(e.w), h: Number(e.h) };
    case "text": {
      const fs = Number(e.fontSize);
      const lines = wrapLines(String(e.content ?? ""), Number(e.w ?? 0) || Math.max(...String(e.content ?? "").split("\n").map((l) => l.length), 1) * fs * 0.62, fs, null);
      return { w: Number(e.w ?? Math.max(...String(e.content ?? "").split("\n").map((l) => l.length), 1) * fs * 0.62), h: fs * 1.25 * lines.length };
    }
    default: {
      const pts = decodePoints(String(e.points ?? "")) ?? [];
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return { w: Math.max(...xs, 0) - Math.min(...xs, 0) || 10, h: Math.max(...ys, 0) - Math.min(...ys, 0) || 10 };
    }
  }
}

/** Bungkus teks per baris (\n + lebar). Tanpa ctx → perkiraan lebar karakter 0.55×. */
export function wrapLines(text: string, maxW: number, fontSize: number, ctx: Ctx2D | null): string[] {
  const width = (s: string) => (ctx ? ctx.measureText(s).width : s.length * fontSize * 0.55);
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const words = raw.split(" ");
    let line = "";
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (line && width(t) > maxW) {
        out.push(line);
        line = w;
      } else line = t;
    }
    out.push(line);
  }
  return out;
}

// ---------------------------------------------------------------- tubuh elemen (koordinat lokal, pusat 0,0)

export function drawPhotoBody(ctx: Ctx2D, e: ElementSnapshot, res: DrawResources, globalFilter: FilterPresetId | null) {
  const w = Number(e.w);
  const h = Number(e.h);
  const crop = e.crop as CropRect;
  ctx.save();
  roundedRectPath(ctx, -w / 2, -h / 2, w, h, Number(e.radius ?? 0));
  ctx.clip();
  const img = res.photo(String(e.attemptId));
  if (img) {
    const css = filterCss((e.filter as FilterPresetId | null) ?? globalFilter);
    if (css !== "none") ctx.filter = css;
    if (e.flipX) ctx.scale(-1, 1);
    // Rasio crop sudah mengikuti rasio kotak (tanpa distorsi); sumber dipotong, bukan diregangkan.
    ctx.drawImage(img, crop.x * img.naturalWidth, crop.y * img.naturalHeight, crop.w * img.naturalWidth, crop.h * img.naturalHeight, -w / 2, -h / 2, w, h);
  } else {
    ctx.fillStyle = "#2a2530";
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  ctx.restore();
}

export function drawStickerBody(ctx: Ctx2D, e: ElementSnapshot, res: DrawResources) {
  const a = stickerAsset(String(e.assetId));
  if (!a) return;
  const w = Number(e.w);
  const h = Number(e.h);
  const tint = typeof e.tint === "string" ? e.tint : undefined;
  ctx.save();
  ctx.translate(-w / 2, -h / 2);
  ctx.scale(w / 100, h / 100);
  for (const part of a.parts) {
    const path = res.path(part.d);
    if (part.fill) {
      ctx.fillStyle = a.tintable && tint ? tint : part.fill;
      ctx.fill(path);
    }
    if (part.stroke) {
      ctx.strokeStyle = part.stroke;
      ctx.lineWidth = part.strokeWidth ?? 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(path);
    }
  }
  ctx.restore();
}

export function drawTextBody(ctx: Ctx2D, e: ElementSnapshot) {
  const f = FONTS[String(e.fontStyle)] ?? FONTS.display!;
  const fs = Number(e.fontSize);
  ctx.save();
  ctx.font = `${f.style} ${fs}px ${f.family}`;
  ctx.fillStyle = String(e.color);
  ctx.textBaseline = "middle";
  const maxW = Number(e.w ?? 0) || Math.max(...String(e.content ?? "").split("\n").map((l) => l.length), 1) * fs * 0.62;
  const lines = wrapLines(String(e.content ?? ""), maxW, fs, ctx);
  const lh = fs * 1.25;
  const align = String(e.align);
  ctx.textAlign = align;
  const x = align === "left" ? -maxW / 2 : align === "right" ? maxW / 2 : 0;
  lines.forEach((line, i) => ctx.fillText(line, x, -(lh * lines.length) / 2 + (i + 0.5) * lh));
  ctx.restore();
}

export function drawDoodleBody(ctx: Ctx2D, e: ElementSnapshot) {
  const pts = decodePoints(String(e.points ?? "")) ?? [];
  if (!pts.length) return;
  ctx.save();
  ctx.strokeStyle = String(e.color);
  ctx.lineWidth = Number(e.width);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  if (pts.length === 1) ctx.lineTo(pts[0]![0] + 0.01, pts[0]![1]);
  // Kurva halus melalui titik tengah (deterministik; sama di editor & export).
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i]![0] + pts[i + 1]![0]) / 2;
    const my = (pts[i]![1] + pts[i + 1]![1]) / 2;
    ctx.quadraticCurveTo(pts[i]![0], pts[i]![1], mx, my);
  }
  if (pts.length > 1) ctx.lineTo(pts[pts.length - 1]![0], pts[pts.length - 1]![1]);
  ctx.stroke();
  ctx.restore();
}

/** Tubuh elemen menurut tipe (tanpa transformasi elemen). */
export function drawElementBody(ctx: Ctx2D, e: ElementSnapshot, res: DrawResources, globalFilter: FilterPresetId | null) {
  switch (e.type) {
    case "photo":
      return drawPhotoBody(ctx, e, res, globalFilter);
    case "sticker":
      return drawStickerBody(ctx, e, res);
    case "text":
      return drawTextBody(ctx, e);
    case "doodle":
      return drawDoodleBody(ctx, e);
  }
}

/** Elemen lengkap: translate(x,y) → rotate → scale → opacity → tubuh. Urutan transform sama untuk editor & export. */
export function drawElement(ctx: Ctx2D, e: ElementSnapshot, res: DrawResources, globalFilter: FilterPresetId | null) {
  ctx.save();
  ctx.translate(Number(e.x), Number(e.y));
  ctx.rotate((Number(e.rotation) * Math.PI) / 180);
  ctx.scale(Number(e.scaleX), Number(e.scaleY));
  ctx.globalAlpha = Number(e.opacity);
  drawElementBody(ctx, e, res, globalFilter);
  ctx.restore();
}

// ---------------------------------------------------------------- latar, frame, dekor

export function drawBackground(ctx: Ctx2D, scene: Pick<Scene, "background" | "width" | "height">, res: DrawResources) {
  const bg = scene.background;
  const W = scene.width;
  const H = scene.height;
  ctx.save();
  if (bg.kind === "solid") {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, W, H);
  } else if (bg.kind === "linear") {
    const rad = (bg.angle * Math.PI) / 180;
    const g = ctx.createLinearGradient(W / 2 - (Math.cos(rad) * W) / 2, H / 2 - (Math.sin(rad) * H) / 2, W / 2 + (Math.cos(rad) * W) / 2, H / 2 + (Math.sin(rad) * H) / 2);
    g.addColorStop(0, bg.from);
    g.addColorStop(1, bg.to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else {
    if (bg.kind === "dots" && bg.bgTo) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, bg.bg);
      g.addColorStop(1, bg.bgTo);
      ctx.fillStyle = g;
    } else ctx.fillStyle = bg.bg;
    ctx.fillRect(0, 0, W, H);
    const pat = res.pattern(bg, ctx);
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
    }
  }
  ctx.restore();
}

export function drawDecorItem(ctx: Ctx2D, d: SceneDecor) {
  ctx.save();
  if (d.kind === "rect") {
    ctx.translate(d.x + d.w / 2, d.y + d.h / 2);
    ctx.rotate((d.rotation * Math.PI) / 180);
    ctx.globalAlpha = d.opacity;
    ctx.fillStyle = d.fill;
    roundedRectPath(ctx, -d.w / 2, -d.h / 2, d.w, d.h, d.radius);
    ctx.fill();
  } else if (d.kind === "mark") {
    const s = d.size / 4;
    ctx.translate(d.x, d.y - d.size * 0.9);
    ctx.fillStyle = d.color;
    roundedRectPath(ctx, 0, 0, s * 1.6, d.size * 1.8, s * 0.5);
    ctx.fill();
    ["#F2AE8C", "#E2C24E", "#7DC49D", "#A893E0"].forEach((c, i) => {
      ctx.fillStyle = c;
      roundedRectPath(ctx, s * 0.3, s * 0.3 + i * s * 1.05, s, s * 0.8, s * 0.15);
      ctx.fill();
    });
  } else {
    const f = FONTS[d.font === "mono" ? "display" : d.font] ?? FONTS.display!;
    ctx.font = d.font === "mono" ? `600 ${d.size}px ${FONT_STACK.mono}` : `${d.italic ? "italic " : f.style === "italic" ? "italic " : ""}${f.style === "bold" ? "bold " : ""}${d.size}px ${f.family}`;
    ctx.fillStyle = d.color;
    ctx.textAlign = d.rotation ? "left" : d.align;
    ctx.textBaseline = "middle";
    ctx.translate(d.x, d.y);
    if (d.rotation) ctx.rotate((d.rotation * Math.PI) / 180);
    ctx.fillText(d.text, 0, 0);
  }
  ctx.restore();
}

/** Lapisan frame di atas foto: artwork overlay (operasi skala seragam) + dekor. */
export function drawFrameLayers(ctx: Ctx2D, scene: Pick<Scene, "overlay" | "decor">, res: DrawResources, overlayOpacity: number) {
  if (scene.overlay && res.overlay) {
    ctx.save();
    ctx.globalAlpha = overlayOpacity;
    for (const o of scene.overlay.ops) ctx.drawImage(res.overlay, o.sx, o.sy, o.sw, o.sh, o.dx, o.dy, o.dw, o.dh);
    ctx.restore();
  }
  for (const d of scene.decor) drawDecorItem(ctx, d);
}

export interface DocumentModel {
  meta: Pick<EditorMeta, "canvas" | "globalFilter" | "frameStyle">;
  elements: (ElementSnapshot & { id: string; z: string })[];
  scene: Scene | null;
}

/**
 * Seluruh hasil sesi pada skala `scale` (seragam). Urutan = tampilan editor: latar → foto (z) → frame (overlay+dekor)
 * → stiker/teks/coretan (z). `clip` (opsional) menggambar hanya satu tile besar: tile digeser & dipotong di sini.
 */
export function drawDocument(ctx: Ctx2D, doc: DocumentModel, res: DrawResources, scale: number, tile?: { x: number; y: number; w: number; h: number }) {
  ctx.save();
  if (tile) {
    ctx.beginPath();
    ctx.rect(0, 0, tile.w, tile.h);
    ctx.clip();
    ctx.translate(-tile.x, -tile.y);
  }
  ctx.scale(scale, scale);
  const W = doc.meta.canvas.w;
  const H = doc.meta.canvas.h;
  if (doc.scene) drawBackground(ctx, doc.scene, res);
  else {
    ctx.fillStyle = doc.meta.frameStyle.bgColor;
    ctx.fillRect(0, 0, W, H);
  }
  const visible = doc.elements.filter((e) => !e.hidden);
  for (const e of visible) if (e.type === "photo") drawElement(ctx, e, res, doc.meta.globalFilter);
  if (doc.scene) drawFrameLayers(ctx, doc.scene, res, doc.meta.frameStyle.overlayOpacity);
  for (const e of visible) if (e.type !== "photo") drawElement(ctx, e, res, doc.meta.globalFilter);
  ctx.restore();
}
