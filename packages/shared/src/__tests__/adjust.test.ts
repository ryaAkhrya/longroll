import { describe, expect, it } from "vitest";
import { ADJUST_CONTROLS, NEUTRAL_ADJUST, adjustKey, applyAdjust, applyCssFilter, compactAdjust, hash01, isNeutral, sanitizeAdjust, seedOf, toneLut } from "../render/adjust";
import type { Adjust } from "../render/adjust";

const px = (r: number, g: number, b: number, w = 4, h = 4) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([r, g, b, 255], i * 4);
  return d;
};
const run = (d: Uint8ClampedArray, a: Partial<Adjust>, w = 4, h = 4, seed = 7) => {
  const c = new Uint8ClampedArray(d);
  applyAdjust(c, w, h, { ...NEUTRAL_ADJUST, ...a }, seed);
  return c;
};
const lum = (d: Uint8ClampedArray, i = 0) => 0.2126 * d[i * 4]! + 0.7152 * d[i * 4 + 1]! + 0.0722 * d[i * 4 + 2]!;
const mean = (d: Uint8ClampedArray) => {
  let s = 0;
  for (let i = 0; i < d.length / 4; i++) s += lum(d, i);
  return s / (d.length / 4);
};

describe("adjust: nilai & validasi", () => {
  it("default netral; semua kontrol punya rentang masuk akal dan default 0", () => {
    expect(isNeutral(NEUTRAL_ADJUST)).toBe(true);
    expect(isNeutral(null)).toBe(true);
    for (const c of ADJUST_CONTROLS) {
      expect(c.min).toBeLessThanOrEqual(0);
      expect(c.max).toBeGreaterThan(0);
      expect(NEUTRAL_ADJUST[c.key]).toBe(0);
    }
    expect(ADJUST_CONTROLS.map((c) => c.key).sort()).toEqual(Object.keys(NEUTRAL_ADJUST).sort());
  });

  it("sanitize: clamp, bulatkan, tolak NaN/bukan objek, kunci asing diabaikan", () => {
    expect(sanitizeAdjust({ exposure: 250, grain: -20, contrast: 12.6 })).toEqual({ ...NEUTRAL_ADJUST, exposure: 100, grain: 0, contrast: 13 });
    expect(sanitizeAdjust({ exposure: Number.NaN })).toBeNull();
    expect(sanitizeAdjust({ exposure: "10" })).toBeNull();
    expect(sanitizeAdjust(null)).toBeNull();
    expect(sanitizeAdjust([1, 2])).toBeNull();
    expect(sanitizeAdjust({ evil: 1 })).toEqual(NEUTRAL_ADJUST);
  });

  it("compact/key: hanya nilai ≠ 0; netral → null / string kosong", () => {
    expect(compactAdjust(NEUTRAL_ADJUST)).toBeNull();
    expect(compactAdjust({ ...NEUTRAL_ADJUST, tint: -5 })).toEqual({ tint: -5 });
    expect(adjustKey(NEUTRAL_ADJUST)).toBe("");
    expect(adjustKey({ ...NEUTRAL_ADJUST, exposure: 10 })).not.toBe(adjustKey({ ...NEUTRAL_ADJUST, exposure: 11 }));
  });
});

describe("adjust: pemetaan nilai → piksel", () => {
  const mid = px(128, 128, 128);

  it("netral = identitas persis (tidak menyentuh piksel)", () => {
    const d = px(10, 120, 240);
    expect(Array.from(run(d, {}))).toEqual(Array.from(d));
  });

  it("LUT netral = identitas; eksposur & kecerahan monoton", () => {
    const id = toneLut({ exposure: 0, brightness: 0, contrast: 0 });
    for (let v = 0; v < 256; v += 17) expect(id[v]).toBe(v);
    const up = toneLut({ exposure: 60, brightness: 0, contrast: 0 });
    const down = toneLut({ exposure: -60, brightness: 0, contrast: 0 });
    for (let v = 8; v < 248; v += 20) {
      expect(up[v]!).toBeGreaterThanOrEqual(v);
      expect(down[v]!).toBeLessThanOrEqual(v);
    }
    // monoton non-turun
    for (const lut of [up, down, toneLut({ exposure: 0, brightness: 50, contrast: 70 })]) for (let v = 1; v < 256; v++) expect(lut[v]!).toBeGreaterThanOrEqual(lut[v - 1]!);
  });

  it("eksposur: positif mencerahkan, negatif menggelapkan; ±100 tetap dalam 0..255", () => {
    expect(mean(run(mid, { exposure: 50 }))).toBeGreaterThan(mean(mid));
    expect(mean(run(mid, { exposure: -50 }))).toBeLessThan(mean(mid));
    for (const e of [-100, 100]) for (const v of run(px(0, 128, 255), { exposure: e })) expect(v).toBeGreaterThanOrEqual(0);
  });

  it("kecerahan: geser merata; kontras: memperlebar jarak gelap-terang (pivot di tengah)", () => {
    expect(mean(run(mid, { brightness: 40 }))).toBeGreaterThan(mean(mid) + 10);
    const dark = px(80, 80, 80);
    const light = px(180, 180, 180);
    const gapBefore = mean(light) - mean(dark);
    expect(mean(run(light, { contrast: 60 })) - mean(run(dark, { contrast: 60 }))).toBeGreaterThan(gapBefore);
    expect(mean(run(light, { contrast: -60 })) - mean(run(dark, { contrast: -60 }))).toBeLessThan(gapBefore);
    expect(run(mid, { contrast: 80 })[0]).toBeGreaterThanOrEqual(126); // abu-abu tengah relatif tetap
    expect(run(mid, { contrast: 80 })[0]).toBeLessThanOrEqual(130);
  });

  it("saturasi: -100 = abu-abu (R=G=B); +100 menjauhkan kanal dari abu-abu; abu-abu tak berubah", () => {
    const c = px(200, 100, 50);
    const gray = run(c, { saturation: -100 });
    expect(Math.abs(gray[0]! - gray[1]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(gray[1]! - gray[2]!)).toBeLessThanOrEqual(1);
    const vivid = run(c, { saturation: 80 });
    expect(vivid[0]! - vivid[2]!).toBeGreaterThan(c[0]! - c[2]!);
    expect(Array.from(run(mid, { saturation: 90 }).slice(0, 3))).toEqual([128, 128, 128]);
  });

  it("suhu: positif = lebih merah/kurang biru; negatif sebaliknya. Tint positif = hijau turun (magenta)", () => {
    const w = run(mid, { temperature: 60 });
    expect(w[0]!).toBeGreaterThan(w[2]!);
    const cool = run(mid, { temperature: -60 });
    expect(cool[2]!).toBeGreaterThan(cool[0]!);
    const mag = run(mid, { tint: 60 });
    expect(mag[1]!).toBeLessThan(mag[0]!);
    const grn = run(mid, { tint: -60 });
    expect(grn[1]!).toBeGreaterThan(grn[0]!);
  });

  it("bayangan memengaruhi area gelap, bukan terang; sorotan memengaruhi area terang, bukan gelap", () => {
    const shadow = px(30, 30, 30);
    const high = px(235, 235, 235);
    expect(lum(run(shadow, { shadows: 80 }))).toBeGreaterThan(lum(shadow) + 8);
    expect(Math.abs(lum(run(high, { shadows: 80 })) - lum(high))).toBeLessThan(1.5);
    expect(lum(run(high, { highlights: -80 }))).toBeLessThan(lum(high) - 8);
    expect(Math.abs(lum(run(shadow, { highlights: -80 })) - lum(shadow))).toBeLessThan(1.5);
  });

  it("grain: deterministik (seed sama = hasil sama), seed beda = pola beda, amplitudo terbatas, rata-rata tetap", () => {
    const flat = px(128, 128, 128, 32, 32);
    const a = run(flat, { grain: 70 }, 32, 32, 5);
    const b = run(flat, { grain: 70 }, 32, 32, 5);
    const c = run(flat, { grain: 70 }, 32, 32, 6);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    let min = 255;
    let max = 0;
    for (let i = 0; i < 32 * 32; i++) {
      min = Math.min(min, a[i * 4]!);
      max = Math.max(max, a[i * 4]!);
    }
    expect(max - min).toBeGreaterThan(10);
    expect(max - min).toBeLessThan(110);
    expect(Math.abs(mean(a) - 128)).toBeLessThan(3);
    // grain 0 → tanpa noise
    expect(Array.from(run(flat, { grain: 0, exposure: 1 }, 32, 32)).every((v, i) => (i % 4 === 3 ? v === 255 : v === run(flat, { exposure: 1 }, 32, 32)[i]))).toBe(true);
  });

  it("alpha tidak berubah; tidak ada NaN pada kombinasi ekstrem", () => {
    const d = px(255, 0, 255);
    const out = run(d, { exposure: 100, brightness: 100, contrast: 100, saturation: 100, highlights: 100, shadows: 100, temperature: 100, tint: 100, grain: 100 });
    for (let i = 0; i < 16; i++) {
      expect(out[i * 4 + 3]).toBe(255);
      for (let k = 0; k < 3; k++) expect(Number.isFinite(out[i * 4 + k]!)).toBe(true);
    }
    const neg = run(px(0, 0, 0), { exposure: -100, brightness: -100, contrast: -100, saturation: -100, highlights: -100, shadows: -100, temperature: -100, tint: -100 });
    expect(neg.every((v) => v >= 0 && v <= 255)).toBe(true);
  });

  it("invarian skala (preview vs export): gambar datar menghasilkan warna sama pada ukuran berbeda", () => {
    const small = run(px(90, 140, 200, 8, 8), { exposure: 25, contrast: 20, saturation: 30, temperature: 15, highlights: -20, shadows: 30 }, 8, 8);
    const big = run(px(90, 140, 200, 40, 40), { exposure: 25, contrast: 20, saturation: 30, temperature: 15, highlights: -20, shadows: 30 }, 40, 40);
    expect(Array.from(small.slice(0, 3))).toEqual(Array.from(big.slice(0, 3)));
  });

  it("hash01 stabil & seedOf deterministik", () => {
    expect(hash01(3, 4, 5)).toBe(hash01(3, 4, 5));
    expect(hash01(3, 4, 5)).not.toBe(hash01(4, 3, 5));
    expect(seedOf("abc")).toBe(seedOf("abc"));
    expect(seedOf("abc")).not.toBe(seedOf("abd"));
  });
});

describe("applyCssFilter (fallback ctx.filter untuk Safari/WebKit)", () => {
  const one = (r: number, g: number, b: number, css: string) => {
    const d = px(r, g, b, 1, 1);
    applyCssFilter(d, css);
    return Array.from(d.slice(0, 4));
  };
  it("none/kosong/tak dikenal tidak mengubah piksel", () => {
    expect(one(10, 120, 240, "none")).toEqual([10, 120, 240, 255]);
    expect(one(10, 120, 240, "")).toEqual([10, 120, 240, 255]);
    expect(one(10, 120, 240, "blur(4px)")).toEqual([10, 120, 240, 255]);
  });
  it("grayscale(1) menghasilkan abu-abu berbobot luma Rec.709", () => {
    const [r, g, b] = one(255, 0, 0, "grayscale(1)");
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(Math.abs(r! - 0.2126 * 255)).toBeLessThanOrEqual(1);
  });
  it("sepia(1) pada putih mengikuti matriks W3C", () => {
    expect(one(255, 255, 255, "sepia(1)")).toEqual([255, 255, 239, 255]);
  });
  it("brightness & contrast", () => {
    expect(one(200, 100, 50, "brightness(.5)")).toEqual([100, 50, 25, 255]);
    expect(one(255, 255, 255, "contrast(.5)")).toEqual([191, 191, 191, 255]);
    expect(one(128, 128, 128, "contrast(.5)")[0]).toBeGreaterThanOrEqual(127);
  });
  it("saturate(0) = abu-abu; hue-rotate(0deg) = identitas; alpha tetap", () => {
    const [r, g, b, a] = one(200, 40, 90, "saturate(0)");
    expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!)).toBeLessThanOrEqual(1);
    expect(a).toBe(255);
    expect(one(200, 40, 90, "hue-rotate(0deg)")).toEqual([200, 40, 90, 255]);
  });
  it("urutan fungsi dipertahankan (dikomposisi kiri ke kanan) dan semua preset valid", async () => {
    expect(one(100, 100, 100, "brightness(2) contrast(.5)")).not.toEqual(one(100, 100, 100, "contrast(.5) brightness(2)"));
    const { FILTER_PRESETS } = await import("../studio/config");
    for (const p of FILTER_PRESETS) {
      const d = px(180, 120, 90, 2, 2);
      applyCssFilter(d, p.css);
      for (let i = 0; i < d.length; i += 4) expect(d[i + 3]).toBe(255);
    }
    // Preset Asli tidak berubah, selain Asli semuanya mengubah piksel.
    const changed = FILTER_PRESETS.filter((p) => one(180, 120, 90, p.css).join() !== "180,120,90,255").map((p) => p.id);
    expect(changed).toEqual(FILTER_PRESETS.filter((p) => p.id !== "ASLI").map((p) => p.id));
  });
});
