import { physChunk, pngChunk } from "@longroll/shared";

/**
 * Encoder PNG bertahap untuk output besar (> 16 juta piksel / sisi > 4096): pita baris RGBA diumpankan satu per
 * satu ke `CompressionStream("deflate")` (zlib, sesuai IDAT) sehingga tidak ada canvas/buffer penuh di memori.
 * Tanpa chunk metadata selain pHYs (tidak ada EXIF).
 */

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IDAT_CHUNK = 1 << 20;

export interface PngStreamOptions {
  width: number;
  height: number;
  /** null = tanpa pHYs. */
  dpi: number | null;
  /** Tinggi pita baris; pita terakhir bisa lebih pendek. */
  bandHeight: number;
  /** RGBA (width × h × 4) untuk baris [y, y+h). */
  renderBand: (y: number, h: number) => Promise<Uint8ClampedArray | Uint8Array>;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

function ihdr(width: number, height: number): Uint8Array {
  const d = new Uint8Array(13);
  const dv = new DataView(d.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  d[8] = 8; // bit depth
  d[9] = 6; // RGBA
  return pngChunk("IHDR", d);
}

/** Potong data zlib menjadi chunk IDAT ≤ 1 MB. */
function idatChunks(parts: Uint8Array[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  let buf: Uint8Array[] = [];
  let size = 0;
  const flush = () => {
    if (!size) return;
    const all = new Uint8Array(size);
    let o = 0;
    for (const b of buf) {
      all.set(b, o);
      o += b.length;
    }
    out.push(pngChunk("IDAT", all));
    buf = [];
    size = 0;
  };
  for (const p of parts) {
    let off = 0;
    while (off < p.length) {
      const take = Math.min(p.length - off, IDAT_CHUNK - size);
      buf.push(p.subarray(off, off + take));
      size += take;
      off += take;
      if (size >= IDAT_CHUNK) flush();
    }
  }
  flush();
  return out;
}

export async function encodePngStream(o: PngStreamOptions): Promise<Blob> {
  if (typeof CompressionStream === "undefined") throw new Error("CompressionStream tidak tersedia");
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();
  const compressed: Uint8Array[] = [];
  const pump = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      compressed.push(value as Uint8Array);
    }
  })();
  try {
    const stride = o.width * 4;
    for (let y = 0; y < o.height; y += o.bandHeight) {
      if (o.signal?.aborted) throw new DOMException("dibatalkan", "AbortError");
      const h = Math.min(o.bandHeight, o.height - y);
      const rgba = await o.renderBand(y, h);
      if (rgba.length !== stride * h) throw new Error("ukuran pita salah");
      // Tiap baris diawali byte filter 0 (None).
      const raw = new Uint8Array((stride + 1) * h);
      for (let r = 0; r < h; r++) raw.set(rgba.subarray(r * stride, (r + 1) * stride), r * (stride + 1) + 1);
      await writer.write(raw);
      o.onProgress?.(Math.min(1, (y + h) / o.height));
    }
    await writer.close();
    await pump;
  } catch (err) {
    await writer.abort(err).catch(() => undefined);
    await pump.catch(() => undefined);
    throw err;
  }
  const parts: BlobPart[] = [SIGNATURE as BlobPart, ihdr(o.width, o.height) as BlobPart];
  if (o.dpi) parts.push(physChunk(o.dpi) as BlobPart);
  for (const c of idatChunks(compressed)) parts.push(c as BlobPart);
  parts.push(pngChunk("IEND", new Uint8Array()) as BlobPart);
  return new Blob(parts, { type: "image/png" });
}
