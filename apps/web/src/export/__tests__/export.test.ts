import { inflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { computeExportSize } from "@longroll/shared";
import type { DocumentModel } from "@longroll/shared";
import { chooseDelivery, deliver, isIos } from "../download";
import type { DeliveryEnv } from "../download";
import { encodePngStream } from "../pngStream";
import { EXPORT_MESSAGES, ExportError, neededLongSide, renderExport } from "../render";

// ---------------------------------------------------------------- dekoder PNG minimal (verifikasi encoder streaming)
async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function parsePng(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  expect([...b.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: { type: string; data: Uint8Array }[] = [];
  for (let off = 8; off < b.length; ) {
    const len = dv.getUint32(off);
    chunks.push({ type: String.fromCharCode(...b.subarray(off + 4, off + 8)), data: b.subarray(off + 8, off + 8 + len) });
    off += 12 + len;
  }
  const ihdr = new DataView(chunks[0]!.data.buffer, chunks[0]!.data.byteOffset);
  const width = ihdr.getUint32(0);
  const height = ihdr.getUint32(4);
  const idat = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => Buffer.from(c.data)));
  const raw = inflateSync(idat);
  const stride = width * 4;
  // Filter 0 saja (encoder kita hanya menulis None).
  const rgba = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (stride + 1)]).toBe(0);
    rgba.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return { chunks, width, height, rgba };
}

const px = (x: number, y: number): [number, number, number, number] => [(x * 7 + y * 13) & 255, x & 255, y & 255, 255];

describe("encodePngStream (output besar tanpa canvas penuh)", () => {
  it("pita baris → PNG valid: ukuran, pHYs 300 dpi, urutan chunk, piksel identik", async () => {
    const W = 37;
    const H = 23;
    const blob = await encodePngStream({
      width: W,
      height: H,
      dpi: 300,
      bandHeight: 8,
      renderBand: async (y, h) => {
        const out = new Uint8ClampedArray(W * h * 4);
        for (let r = 0; r < h; r++) for (let x = 0; x < W; x++) out.set(px(x, y + r), (r * W + x) * 4);
        return out;
      },
    });
    expect(blob.type).toBe("image/png");
    const png = parsePng(await bytesOf(blob));
    expect(png.chunks.map((c) => c.type)).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
    expect(png.width).toBe(W);
    expect(png.height).toBe(H);
    expect(new DataView(png.chunks[1]!.data.buffer, png.chunks[1]!.data.byteOffset).getUint32(0)).toBe(11811);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) expect([...png.rgba.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)]).toEqual(px(x, y));
  });

  it("tanpa dpi → tanpa pHYs; tidak ada chunk metadata lain (tanpa EXIF); progres naik sampai 1; dibatalkan lewat AbortSignal", async () => {
    const seen: number[] = [];
    const ok = await encodePngStream({ width: 4, height: 10, dpi: null, bandHeight: 4, renderBand: async (_y, h) => new Uint8Array(4 * h * 4), onProgress: (f) => seen.push(f) });
    expect(parsePng(await bytesOf(ok)).chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(seen.at(-1)).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    const ac = new AbortController();
    ac.abort();
    await expect(encodePngStream({ width: 4, height: 10, dpi: null, bandHeight: 4, renderBand: async (_y, h) => new Uint8Array(4 * h * 4), signal: ac.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(encodePngStream({ width: 4, height: 4, dpi: null, bandHeight: 4, renderBand: async () => new Uint8Array(3) })).rejects.toThrow();
  });
});

// ---------------------------------------------------------------- renderExport: tiling lintas kolom & baris
function fakeCanvasFactory() {
  const made: { w: number; h: number }[] = [];
  const create = (w: number, h: number) => {
    let tx = 0;
    let ty = 0;
    const canvas = {
      width: w,
      height: h,
      getContext: () =>
        new Proxy({} as Record<string, unknown>, {
          get(_t, prop: string) {
            if (prop === "translate") return (x: number, y: number) => ((tx = -x), (ty = -y)); // tile: translate(-tile.x, -tile.y)
            if (prop === "getImageData") {
              return (_x: number, _y: number, cw: number, ch: number) => {
                made.push({ w: cw, h: ch });
                const data = new Uint8ClampedArray(cw * ch * 4);
                for (let r = 0; r < ch; r++) for (let c = 0; c < cw; c++) data.set(px(tx + c, ty + r), (r * cw + c) * 4);
                return { data };
              };
            }
            if (prop === "measureText") return () => ({ width: 1 });
            return () => undefined;
          },
          set: () => true,
        }),
    } as unknown as HTMLCanvasElement;
    return canvas;
  };
  return { create, made };
}

const emptyModel = (w: number, h: number): DocumentModel => ({
  meta: { canvas: { w, h }, globalFilter: null, frameStyle: { bgColor: "#FFFFFF", overlayOpacity: 1 } },
  elements: [],
  scene: null,
});

describe("renderExport (tile)", () => {
  it("output > 4096 px dipecah ke tile 2×2; hasil PNG tepat piksel-per-piksel (tanpa celah/tumpang tindih); 300 dpi", async () => {
    const W = 4100;
    const H = 3950;
    const { create, made } = fakeCanvasFactory();
    const progress: number[] = [];
    const size = { width: W, height: H, scale: 1, offsetX: 0, offsetY: 0, reduced: false, dpi: 300 };
    const out = await renderExport({ model: emptyModel(W, H), size, format: "png", loadPhoto: async () => Promise.reject(new Error("tak dipakai")), overlay: null, createCanvas: create, onProgress: (f) => progress.push(f) });
    expect(out.tiled).toBe(true);
    expect(made).toHaveLength(4);
    const png = parsePng(await bytesOf(out.blob));
    expect(png.chunks.map((c) => c.type)).toContain("pHYs");
    expect([png.width, png.height]).toEqual([W, H]);
    for (const [x, y] of [[0, 0], [4095, 0], [4096, 0], [4099, 0], [0, 3905], [0, 3906], [4099, 3949], [2048, 1975]] as const) {
      expect([...png.rgba.subarray((y * W + x) * 4, (y * W + x) * 4 + 4)]).toEqual(px(x, y));
    }
    expect(progress.at(-1)).toBeCloseTo(1, 5);
  }, 60_000);

  it("JPEG tidak boleh tile → ExportError JPEG_TOO_LARGE dengan pesan Indonesia", async () => {
    const size = { width: 5000, height: 100, scale: 1, offsetX: 0, offsetY: 0, reduced: false, dpi: null };
    await expect(renderExport({ model: emptyModel(5000, 100), size, format: "jpeg", loadPhoto: async () => Promise.reject(new Error("x")), overlay: null })).rejects.toMatchObject({ code: "JPEG_TOO_LARGE", message: EXPORT_MESSAGES.JPEG_TOO_LARGE });
  });

  it("foto gagal dimuat → PHOTO_LOAD (bukan crash), bitmap yang sudah termuat dibebaskan", async () => {
    const close = vi.fn();
    const model = emptyModel(100, 100);
    model.elements = ["a", "b"].map((k, i) => ({ id: `photo:${k}`, z: `A${i}`, type: "photo", attemptId: k, x: 50, y: 50, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, w: 50, h: 50, srcW: 800, srcH: 600, crop: { x: 0, y: 0, w: 1, h: 1 }, radius: 0, flipX: false, filter: null, zoom: 1, ownerName: "x" })) as never;
    const size = computeExportSize({ w: 100, h: 100 }, "ASLI");
    const err = await renderExport({
      model,
      size,
      format: "png",
      overlay: null,
      loadPhoto: async (id) => {
        if (id === "b") throw new Error("404");
        return { naturalWidth: 800, naturalHeight: 600, close };
      },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExportError);
    expect((err as ExportError).code).toBe("PHOTO_LOAD");
    expect(close).toHaveBeenCalled();
  });

  it("neededLongSide: varian foto dipilih dari kebutuhan piksel sel (edit ≤1600 cukup untuk sel kecil)", () => {
    const e = { w: 400, h: 300, scaleX: 1, scaleY: 1, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } };
    expect(neededLongSide(e, 1)).toBe(800);
    expect(neededLongSide(e, 2)).toBe(1600);
    expect(neededLongSide(e, 4)).toBe(3200);
    expect(neededLongSide({ ...e, scaleX: -1 }, 1)).toBe(800); // flip tidak mengubah kebutuhan
  });
});

// ---------------------------------------------------------------- download per platform
const base: DeliveryEnv = { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120", maxTouchPoints: 0, platform: "Win32", canShareFile: false, anchorDownload: true };

describe("download per platform (12 §5)", () => {
  it("desktop & Android → <a download>; iOS → share bila bisa, kalau tidak tab baru; iPadOS (mengaku Mac) terdeteksi", () => {
    expect(chooseDelivery(base)).toBe("anchor");
    expect(chooseDelivery({ ...base, userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile", platform: "Linux armv8l", maxTouchPoints: 5, canShareFile: true })).toBe("anchor");
    const ios = { ...base, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1", platform: "iPhone", maxTouchPoints: 5 };
    expect(chooseDelivery({ ...ios, canShareFile: true })).toBe("share");
    expect(chooseDelivery({ ...ios, canShareFile: false })).toBe("newtab");
    const ipad = { ...base, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5 };
    expect(isIos(ipad)).toBe(true);
    expect(isIos({ ...ipad, maxTouchPoints: 0 })).toBe(false); // Mac asli
    expect(chooseDelivery({ ...base, anchorDownload: false, canShareFile: true })).toBe("share");
  });

  it("anchor: nama file dipakai, revoke setelah 60 detik; share dibatalkan pengguna → cancelled (bukan galat)", async () => {
    vi.useFakeTimers();
    const created: string[] = [];
    const revoked: string[] = [];
    URL.createObjectURL = vi.fn(() => (created.push("blob:x"), "blob:x"));
    URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe("LONGROLL_BOBA27_sesi1_2026-10-29.png");
    });
    const res = await deliver(new Blob(["x"], { type: "image/png" }), "LONGROLL_BOBA27_sesi1_2026-10-29.png", base);
    expect(res).toEqual({ method: "anchor", cancelled: false });
    expect(click).toHaveBeenCalledOnce();
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(revoked).toEqual(["blob:x"]);
    click.mockRestore();

    Object.assign(navigator, { share: vi.fn(async () => Promise.reject(new DOMException("batal", "AbortError"))) });
    const ios = { ...base, userAgent: "iPhone", platform: "iPhone", maxTouchPoints: 5, canShareFile: true };
    expect(await deliver(new Blob(["x"], { type: "image/png" }), "a.png", ios)).toEqual({ method: "share", cancelled: true });
    vi.useRealTimers();
  });
});
