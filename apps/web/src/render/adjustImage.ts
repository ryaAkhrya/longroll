import { adjustKey, applyAdjust, applyCssFilter, seedOf } from "@longroll/shared";
import type { AdjustedPhotoRequest, ImageLike } from "@longroll/shared";

/**
 * Pemroses penyesuaian foto di klien (Phase 3). Menggambar foto yang sudah di-crop (plus filter preset bila browser
 * mendukung `ctx.filter`) ke kanvas offscreen berukuran PIKSEL TUJUAN, menerapkan `applyAdjust` (fungsi murni di paket
 * shared), dan mengembalikan kanvas itu. Dipakai kanvas editor dan export lewat `DrawResources.adjusted`, sehingga
 * pratinjau dan hasil akhir memakai kode yang sama.
 *
 * Biaya mengikuti ukuran tujuan, bukan ukuran sumber (foto 4096 px yang tampil 400 px hanya memproses 400 px).
 * Cache dibatasi jumlah & total piksel; kanvas yang dibuang dikecilkan ke 0×0 agar memori segera bebas.
 */

const MAX_ENTRIES = 32;
const MAX_TOTAL_PX = 24_000_000;
/** Batas aman satu kanvas (iOS ≈ 16,7 juta piksel). Di atas ini jatuh ke jalur tanpa penyesuaian. */
const MAX_PX = 16_000_000;

const cache = new Map<string, HTMLCanvasElement>();
let totalPx = 0;
const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object) => {
  let v = ids.get(o);
  if (!v) ids.set(o, (v = nextId++));
  return v;
};

function evict() {
  while (cache.size > MAX_ENTRIES || totalPx > MAX_TOTAL_PX) {
    const k = cache.keys().next().value as string | undefined;
    if (k === undefined) break;
    drop(k);
  }
}
function drop(k: string) {
  const c = cache.get(k);
  if (!c) return;
  totalPx -= c.width * c.height;
  c.width = 0;
  c.height = 0;
  cache.delete(k);
}

/** Bebaskan semua kanvas hasil (setelah export selesai / editor ditutup). */
export function clearAdjustCache() {
  for (const k of Array.from(cache.keys())) drop(k);
  totalPx = 0;
}

export function cacheStats() {
  return { entries: cache.size, totalPx };
}

export const supportsCtxFilter = (() => {
  let v: boolean | null = null;
  return () => {
    if (typeof document === "undefined") return true; // SSR: tidak di-cache; klien menguji sendiri
    if (v === null) {
      try {
        // Uji fungsional (bukan hanya `"filter" in ctx`): Safari bisa punya properti tapi mengabaikannya.
        const c = document.createElement("canvas");
        c.width = c.height = 1;
        const g = c.getContext("2d", { willReadFrequently: true });
        if (g && "filter" in g) {
          g.filter = "grayscale(1)";
          g.fillStyle = "rgb(255,0,0)";
          g.fillRect(0, 0, 1, 1);
          const d = g.getImageData(0, 0, 1, 1).data;
          v = d[0] === d[1] && d[1] === d[2];
        } else v = false;
      } catch {
        v = false;
      }
    }
    return v;
  };
})();

/** Kait ukur QA: hanya aktif bila tes memasang `globalThis.__lrPerf` (di produksi biasa tidak ada → nol biaya). */
interface PerfSink {
  adjust: { ms: number; px: number }[];
  hits: number;
  cache?: () => { entries: number; totalPx: number };
}
const perf = () => (globalThis as unknown as { __lrPerf?: PerfSink }).__lrPerf;

export function adjustedPhoto(req: AdjustedPhotoRequest): ImageLike | null {
  const { img, crop, pxW, pxH } = req;
  if (pxW * pxH > MAX_PX || pxW > 8192 || pxH > 8192) return null;
  const key = `${req.attemptId}|${idOf(img as object)}|${crop.x.toFixed(4)},${crop.y.toFixed(4)},${crop.w.toFixed(4)},${crop.h.toFixed(4)}|${pxW}x${pxH}|${req.filterCss}|${adjustKey(req.adjust)}`;
  const hit = cache.get(key);
  if (hit) {
    const pf0 = perf();
    if (pf0) pf0.hits++;
    cache.delete(key);
    cache.set(key, hit); // LRU
    return hit as unknown as ImageLike;
  }
  // Satu entri per foto dan ukuran: nilai lama (drag slider) tidak menumpuk.
  const prefix = `${req.attemptId}|${idOf(img as object)}|${crop.x.toFixed(4)},${crop.y.toFixed(4)},${crop.w.toFixed(4)},${crop.h.toFixed(4)}|${pxW}x${pxH}|`;
  for (const k of Array.from(cache.keys())) if (k.startsWith(prefix)) drop(k);

  const t0 = perf() ? performance.now() : 0;
  const c = document.createElement("canvas");
  c.width = pxW;
  c.height = pxH;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  const src = img as unknown as CanvasImageSource & ImageLike;
  if (req.filterCss !== "none" && supportsCtxFilter()) g.filter = req.filterCss;
  g.drawImage(src, crop.x * src.naturalWidth, crop.y * src.naturalHeight, crop.w * src.naturalWidth, crop.h * src.naturalHeight, 0, 0, pxW, pxH);
  g.filter = "none";
  const data = g.getImageData(0, 0, pxW, pxH);
  if (req.filterCss !== "none" && !supportsCtxFilter()) applyCssFilter(data.data, req.filterCss);
  applyAdjust(data.data, pxW, pxH, req.adjust, seedOf(req.attemptId));
  g.putImageData(data, 0, 0);
  const pf = perf();
  if (pf) {
    pf.adjust.push({ ms: performance.now() - t0, px: pxW * pxH });
    pf.cache = cacheStats;
  }
  cache.set(key, c);
  totalPx += pxW * pxH;
  evict();
  return c as unknown as ImageLike;
}
