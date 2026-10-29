import { EXPORT_LIMITS, addPngDpi, drawDocument, needsTiling, tilePlan } from "@longroll/shared";
import type { Ctx2D, DocumentModel, ExportFormat, ExportSize, ImageLike } from "@longroll/shared";

/** WebP hanya untuk pratinjau hasil (≤1600 px, tanpa tile). */
export type RenderFormat = ExportFormat | "webp";
import { asCtx, makeResources } from "@/render/resources";
import { encodePngStream } from "./pngStream";

/**
 * Render export di klien (DEC-060) lewat `drawDocument` yang sama dengan kanvas editor. Skala seragam,
 * tile untuk output besar, bitmap dibebaskan setelah dipakai.
 */

export type ExportErrorCode = "ABORTED" | "PHOTO_LOAD" | "TOO_BIG" | "JPEG_TOO_LARGE" | "ENCODE";

export class ExportError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const EXPORT_MESSAGES: Record<ExportErrorCode, string> = {
  ABORTED: "Dibatalkan.",
  PHOTO_LOAD: "Foto gagal dimuat. Coba lagi.",
  TOO_BIG: "Ukuran ini kebesaran buat perangkatmu. Coba 'Asli'?",
  JPEG_TOO_LARGE: "Ukuran sebesar ini cuma bisa PNG.",
  ENCODE: "Gagal bikin file. Coba lagi.",
};

export interface BitmapLike extends ImageLike {
  close?: () => void;
}

export interface ExportRequest {
  model: DocumentModel;
  size: ExportSize;
  format: RenderFormat;
  /** Kualitas WebP/JPEG (default 0.92 JPEG, 0.82 WebP). */
  quality?: number;
  /** Foto attempt; `minLongSide` = sisi terpanjang piksel yang dibutuhkan (memilih varian edit ≤1600 atau full). */
  loadPhoto: (attemptId: string, minLongSide: number) => Promise<BitmapLike>;
  overlay: ImageLike | null;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Tes: ganti pembuat canvas. */
  createCanvas?: (w: number, h: number) => HTMLCanvasElement;
}

export interface ExportResult {
  blob: Blob;
  mime: string;
  tiled: boolean;
}

const PHOTO_CONCURRENCY = 3;

/** Sisi terpanjang foto (px) yang dibutuhkan agar sel tidak di-upscale pada skala tertentu. */
export function neededLongSide(e: Record<string, unknown>, scale: number): number {
  const crop = e.crop as { w: number; h: number };
  const w = Number(e.w) * Math.abs(Number(e.scaleX)) * scale;
  const h = Number(e.h) * Math.abs(Number(e.scaleY)) * scale;
  return Math.ceil(Math.max(w / Math.max(0.01, crop.w), h / Math.max(0.01, crop.h)));
}

async function loadAll(req: ExportRequest): Promise<Map<string, BitmapLike>> {
  const photos = req.model.elements.filter((e) => e.type === "photo" && !e.hidden);
  const need = new Map<string, number>();
  for (const e of photos) {
    const id = String(e.attemptId);
    need.set(id, Math.max(need.get(id) ?? 0, neededLongSide(e, req.size.scale)));
  }
  const queue = [...need.entries()];
  const out = new Map<string, BitmapLike>();
  let done = 0;
  const worker = async () => {
    for (;;) {
      if (req.signal?.aborted) throw new ExportError("ABORTED", EXPORT_MESSAGES.ABORTED);
      const next = queue.shift();
      if (!next) return;
      try {
        out.set(next[0], await req.loadPhoto(next[0], next[1]));
      } catch (err) {
        if (err instanceof ExportError) throw err;
        throw new ExportError("PHOTO_LOAD", EXPORT_MESSAGES.PHOTO_LOAD);
      }
      done += 1;
      req.onProgress?.(0.3 * (done / Math.max(1, need.size)));
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(PHOTO_CONCURRENCY, queue.length) }, worker));
  } catch (err) {
    for (const b of out.values()) b.close?.();
    throw err;
  }
  return out;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new ExportError("TOO_BIG", EXPORT_MESSAGES.TOO_BIG))), type, quality));
}

export async function renderExport(req: ExportRequest): Promise<ExportResult> {
  const { size, model } = req;
  const tiled = needsTiling(size.width, size.height);
  if (tiled && req.format !== "png") throw new ExportError("JPEG_TOO_LARGE", EXPORT_MESSAGES.JPEG_TOO_LARGE);
  if (typeof document !== "undefined" && document.fonts?.ready) await document.fonts.ready;
  const bitmaps = await loadAll(req);
  try {
    const res = makeResources({ photo: (id) => bitmaps.get(id) ?? null, overlay: req.overlay, scale: size.scale });
    const mk = req.createCanvas ?? ((w: number, h: number) => Object.assign(document.createElement("canvas"), { width: w, height: h }));
    const bg = model.meta.frameStyle.bgColor;
    const paint = (ctx: CanvasRenderingContext2D, tile?: { x: number; y: number; w: number; h: number }) => {
      const c = asCtx(ctx);
      if (!tile && (size.offsetX || size.offsetY)) {
        // Story: latar frame mengisi kanvas 9:16, isi layout di-contain di tengah.
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.save();
        ctx.translate(size.offsetX, size.offsetY);
        drawDocument(c as Ctx2D, model, res, size.scale);
        ctx.restore();
      } else drawDocument(c, model, res, size.scale, tile);
    };

    if (!tiled) {
      const canvas = mk(size.width, size.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new ExportError("TOO_BIG", EXPORT_MESSAGES.TOO_BIG);
      paint(ctx);
      req.onProgress?.(0.8);
      if (req.signal?.aborted) throw new ExportError("ABORTED", EXPORT_MESSAGES.ABORTED);
      if (req.format === "webp") {
        const blob = await toBlob(canvas, "image/webp", req.quality ?? 0.82);
        req.onProgress?.(1);
        return { blob, mime: "image/webp", tiled: false };
      }
      if (req.format === "jpeg") {
        const blob = await toBlob(canvas, "image/jpeg", req.quality ?? EXPORT_LIMITS.jpegQuality);
        req.onProgress?.(1);
        return { blob, mime: "image/jpeg", tiled: false };
      }
      let blob = await toBlob(canvas, "image/png");
      if (size.dpi) blob = new Blob([addPngDpi(new Uint8Array(await blob.arrayBuffer()), size.dpi) as BlobPart], { type: "image/png" });
      req.onProgress?.(1);
      return { blob, mime: "image/png", tiled: false };
    }

    // Tiling: pita baris → tile kolom → RGBA pita penuh → PNG streaming.
    const tiles = tilePlan(size.width, size.height);
    const bands = new Map<number, typeof tiles>();
    for (const t of tiles) bands.set(t.y, [...(bands.get(t.y) ?? []), t]);
    const bandH = tiles[0]!.h;
    const canvas = mk(1, 1);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new ExportError("TOO_BIG", EXPORT_MESSAGES.TOO_BIG);
    const blob = await encodePngStream({
      width: size.width,
      height: size.height,
      dpi: size.dpi,
      bandHeight: bandH,
      signal: req.signal,
      onProgress: (f) => req.onProgress?.(0.3 + 0.7 * f),
      renderBand: async (y, h) => {
        const row = new Uint8ClampedArray(size.width * h * 4);
        for (const t of bands.get(y) ?? []) {
          canvas.width = t.w;
          canvas.height = t.h;
          paint(ctx, t);
          const data = ctx.getImageData(0, 0, t.w, t.h).data;
          for (let r = 0; r < t.h; r++) row.set(data.subarray(r * t.w * 4, (r + 1) * t.w * 4), (r * size.width + t.x) * 4);
        }
        return row;
      },
    }).catch((err) => {
      if (err instanceof ExportError) throw err;
      if (err instanceof DOMException && err.name === "AbortError") throw new ExportError("ABORTED", EXPORT_MESSAGES.ABORTED);
      throw new ExportError("ENCODE", EXPORT_MESSAGES.ENCODE);
    });
    return { blob, mime: "image/png", tiled: true };
  } finally {
    for (const b of bitmaps.values()) b.close?.();
  }
}
