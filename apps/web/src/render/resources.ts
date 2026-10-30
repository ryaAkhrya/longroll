import type { Ctx2D, DrawResources, Fill, ImageLike } from "@longroll/shared";
import { patternImage } from "@/components/studio/canvas/assets";
import { adjustedPhoto, supportsCtxFilter } from "./adjustImage";

/**
 * Sumber daya gambar untuk `drawDocument`/`drawElementBody` (paket shared). Dipakai bersama oleh kanvas editor
 * dan export supaya tidak ada dua jalur render (10 §1, §13).
 */

const paths = new Map<string, Path2D>();

export function path2d(d: string): Path2D {
  let p = paths.get(d);
  if (!p) {
    p = new Path2D(d);
    paths.set(d, p);
  }
  return p;
}

/** Unwrap konteks Konva ke Canvas2D asli (transform & clip tetap berlaku di konteks yang sama). */
export function rawContext(ctx: unknown): CanvasRenderingContext2D {
  const c = ctx as CanvasRenderingContext2D & { _context?: CanvasRenderingContext2D };
  return c._context ?? c;
}

export function asCtx(ctx: CanvasRenderingContext2D): Ctx2D {
  return ctx as unknown as Ctx2D;
}

export function makeResources(opts: { photo: (attemptId: string) => ImageLike | null; overlay: ImageLike | null; scale: number }): DrawResources {
  return {
    pixelScale: opts.scale,
    adjusted: adjustedPhoto,
    pixelFilters: !supportsCtxFilter(),
    photo: opts.photo,
    overlay: opts.overlay,
    path: path2d,
    pattern: (fill: Fill, ctx: Ctx2D) => {
      const img = patternImage(fill, opts.scale);
      return img ? (ctx as unknown as CanvasRenderingContext2D).createPattern(img, "repeat") : null;
    },
  };
}
