import { CAPTURE_CONFIG, applyCssFilter, captureCrop } from "@longroll/shared";
import type { CameraPresentation } from "@longroll/shared";
import { presentationFilter } from "@/media/presentation";
import { supportsCtxFilter } from "@/render/adjustImage";

export interface PhotoBlob {
  blob: Blob;
  width: number;
  height: number;
  sha256: string;
}

export interface CapturedPhoto {
  full: PhotoBlob;
  preview: PhotoBlob;
  /** Waktu server saat frame diambil (diagnostik skew NFR-02; bukan alasan penolakan). */
  capturedAtServerMs: number;
  /** Ulang-encode lebih kecil bila storage menolak ukuran (09 §11). */
  recompress: () => Promise<PhotoBlob>;
}

/** Tunggu frame video pertama yang dipresentasikan pada/setelah waktu lokal `atLocalMs` (09 §7.3 langkah 2). */
export function nextFrameAt(video: HTMLVideoElement, atLocalMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    const fire = () => {
      const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      if (typeof v.requestVideoFrameCallback === "function") v.requestVideoFrameCallback(finish);
      else requestAnimationFrame(finish);
      // Elemen di luar layar bisa tidak mendapat callback: ambil frame terkini setelah batas wajar.
      setTimeout(finish, 400);
    };
    const wait = atLocalMs - Date.now();
    if (wait > 0) setTimeout(fire, wait);
    else fire();
  });
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob null"))), "image/jpeg", quality));
}

async function photoBlob(canvas: HTMLCanvasElement, quality: number): Promise<PhotoBlob> {
  const blob = await toBlob(canvas, quality);
  return { blob, width: canvas.width, height: canvas.height, sha256: await sha256Hex(blob) };
}

/**
 * Gambar frame video saat ini ke canvas dengan framing pemilik (zoom/geser), kecerahan/kehangatan, dan
 * cermin (WYSIWYG, DEC-064). Crop dihitung `captureCrop` (skala seragam, tanpa distorsi). JPEG dibuat dari
 * canvas → tanpa EXIF/lokasi.
 */
export function drawFrame(video: HTMLVideoElement, cp: CameraPresentation, mirrored: boolean, maxPx: number): HTMLCanvasElement {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error("video belum punya frame");
  const crop = captureCrop(w, h, cp, mirrored, maxPx);
  const canvas = document.createElement("canvas");
  canvas.width = crop.outW;
  canvas.height = crop.outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d tidak tersedia");
  const filter = presentationFilter(cp);
  // Safari/WebKit mengabaikan `ctx.filter`: terapkan filter yang SAMA (string CSS yang dipakai pratinjau <video>) lewat fallback piksel
  // bersama agar foto yang diambil sama dengan yang terlihat di pratinjau.
  const native = filter !== "none" && supportsCtxFilter();
  if (native) ctx.filter = filter;
  if (crop.flip) {
    ctx.translate(crop.outW, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, crop.outW, crop.outH);
  if (filter !== "none" && !native) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyCssFilter(img.data, filter);
    ctx.putImageData(img, 0, 0);
  }
  return canvas;
}

function downscale(src: HTMLCanvasElement, maxPx: number): HTMLCanvasElement {
  const s = Math.min(1, maxPx / Math.max(src.width, src.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * s));
  c.height = Math.max(1, Math.round(src.height * s));
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Ambil foto dari MediaStream lokal pada T0 (waktu server → lokal lewat offset). Foto penuh + preview ≤ 640 px. */
export async function captureFromVideo(
  video: HTMLVideoElement,
  opts: { t0ServerMs: number; serverNow: () => number; presentation: CameraPresentation; mirrored: boolean },
): Promise<CapturedPhoto> {
  const t0Local = Date.now() + (opts.t0ServerMs - opts.serverNow());
  await nextFrameAt(video, t0Local);
  const capturedAtServerMs = Math.round(opts.serverNow());
  let canvas: HTMLCanvasElement;
  try {
    canvas = drawFrame(video, opts.presentation, opts.mirrored, CAPTURE_CONFIG.fullMaxPx);
  } catch {
    // Batas ukuran canvas perangkat (mis. iOS): turun ke 2048 px.
    canvas = drawFrame(video, opts.presentation, opts.mirrored, 2048);
  }
  const [full, preview] = await Promise.all([
    photoBlob(canvas, CAPTURE_CONFIG.fullQuality),
    photoBlob(downscale(canvas, CAPTURE_CONFIG.previewMaxPx), CAPTURE_CONFIG.previewQuality),
  ]);
  return { full, preview, capturedAtServerMs, recompress: () => photoBlob(canvas, CAPTURE_CONFIG.retryQuality) };
}
