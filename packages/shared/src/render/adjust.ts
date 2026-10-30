/**
 * Penyesuaian foto non-destruktif (Phase 3). Satu implementasi piksel MURNI (tanpa DOM) yang dipakai kanvas editor dan
 * export lewat `drawDocument`, jadi pratinjau dan hasil akhir tak bisa berbeda (10 §1, §13). Foto asli tidak pernah diubah:
 * nilai disimpan di dokumen (`meta.globalAdjust` untuk semua foto, `photo.adjust` untuk satu foto) dan diterapkan saat render.
 *
 * Urutan operasi per piksel (ruang sRGB 8-bit; LUT untuk kurva nada, bobot luminans untuk cahaya):
 *   1. kurva nada per kanal (LUT 256): eksposur (±1,5 stop) → kecerahan (±0,25) → kontras (pivot 0,5)
 *   2. keseimbangan warna: suhu (biru↔kuning) lalu tint (hijau↔magenta) sebagai gain per kanal
 *   3. bayangan/sorotan: geser terang berbobot luminans (bayangan = area gelap, sorotan = area terang)
 *   4. saturasi: campur dengan abu-abu luminans (Rec.709)
 *   5. grain: noise deterministik (hash koordinat + seed), lebih kuat di nada tengah
 * Nilai netral (semua 0) = identitas persis; `isNeutral` dipakai agar jalur tanpa adjustment tak menyentuh piksel.
 */

export interface Adjust {
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  highlights: number;
  shadows: number;
  temperature: number;
  tint: number;
  /** 0..100 (tak ada nilai negatif). */
  grain: number;
}

export type AdjustKey = keyof Adjust;
export type AdjustGroup = "basic" | "light" | "color" | "effects";

export interface AdjustControl {
  key: AdjustKey;
  label: string;
  group: AdjustGroup;
  min: number;
  max: number;
  step: number;
}

/** Urutan = urutan tampil di panel. Semua kontrol adalah pemrosesan piksel nyata (bukan CSS pratinjau saja). */
export const ADJUST_CONTROLS: readonly AdjustControl[] = [
  { key: "exposure", label: "Eksposur", group: "basic", min: -100, max: 100, step: 1 },
  { key: "brightness", label: "Kecerahan", group: "basic", min: -100, max: 100, step: 1 },
  { key: "contrast", label: "Kontras", group: "basic", min: -100, max: 100, step: 1 },
  { key: "saturation", label: "Saturasi", group: "basic", min: -100, max: 100, step: 1 },
  { key: "highlights", label: "Sorotan", group: "light", min: -100, max: 100, step: 1 },
  { key: "shadows", label: "Bayangan", group: "light", min: -100, max: 100, step: 1 },
  { key: "temperature", label: "Suhu warna", group: "color", min: -100, max: 100, step: 1 },
  { key: "tint", label: "Tint", group: "color", min: -100, max: 100, step: 1 },
  { key: "grain", label: "Grain", group: "effects", min: 0, max: 100, step: 1 },
];

export const ADJUST_GROUP_LABEL: Record<AdjustGroup, string> = { basic: "Dasar", light: "Cahaya", color: "Warna", effects: "Efek" };

export const NEUTRAL_ADJUST: Readonly<Adjust> = Object.freeze({
  exposure: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  highlights: 0,
  shadows: 0,
  temperature: 0,
  tint: 0,
  grain: 0,
});

const KEYS = ADJUST_CONTROLS.map((c) => c.key);

export function isNeutral(a: Partial<Adjust> | null | undefined): boolean {
  if (!a) return true;
  return KEYS.every((k) => !a[k]);
}

/** Validasi + clamp + pembulatan bilangan bulat. null bila bentuk salah (bukan objek / angka tak hingga). */
export function sanitizeAdjust(input: unknown): Adjust | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const src = input as Record<string, unknown>;
  const out = { ...NEUTRAL_ADJUST } as Adjust;
  for (const c of ADJUST_CONTROLS) {
    const v = src[c.key];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out[c.key] = Math.round(Math.min(c.max, Math.max(c.min, v)));
  }
  return out;
}

/** Kunci cache yang stabil (hanya nilai yang bukan nol). */
export function adjustKey(a: Adjust): string {
  return KEYS.filter((k) => a[k]).map((k) => `${k[0]}${k.slice(1, 3)}${a[k]}`).join(",");
}

/** Objek yang aman disimpan di dokumen (hanya kunci bernilai ≠ 0) atau null bila netral. */
export function compactAdjust(a: Adjust | null | undefined): Partial<Adjust> | null {
  if (!a || isNeutral(a)) return null;
  const out: Partial<Adjust> = {};
  for (const k of KEYS) if (a[k]) out[k] = a[k];
  return out;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Kurva nada 8-bit (LUT) dari eksposur, kecerahan, kontras. */
export function toneLut(a: Pick<Adjust, "exposure" | "brightness" | "contrast">): Uint8Array {
  const lut = new Uint8Array(256);
  const gain = Math.pow(2, (a.exposure / 100) * 1.5);
  const bright = (a.brightness / 100) * 0.25;
  const k = 1 + (a.contrast / 100) * 0.8;
  for (let v = 0; v < 256; v++) {
    // Eksposur dalam cahaya linear (perilaku "stop" yang benar), lalu kembali ke sRGB.
    const s = v / 255;
    const lin = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    const l2 = clamp01(lin * gain);
    let x = l2 <= 0.0031308 ? l2 * 12.92 : 1.055 * Math.pow(l2, 1 / 2.4) - 0.055;
    x = clamp01(x + bright);
    x = clamp01((x - 0.5) * k + 0.5);
    lut[v] = Math.round(x * 255);
  }
  return lut;
}

/** Hash deterministik 0..1 dari (x, y, seed): sama di setiap klien dan setiap skala render. */
export function hash01(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Terapkan penyesuaian pada buffer RGBA (in-place). `seed` membuat grain stabil per foto; koordinat grain memakai
 * indeks piksel sehingga tampilan (skala kecil) dan export (skala besar) memiliki butiran sepadan secara visual.
 */
export function applyAdjust(data: Uint8ClampedArray, width: number, height: number, adj: Adjust, seed = 1): void {
  if (isNeutral(adj)) return;
  const lut = toneLut(adj);
  const t = adj.temperature / 100;
  const ti = adj.tint / 100;
  // Suhu: hangat = merah naik, biru turun. Tint: positif = magenta (hijau turun).
  const gr = 1 + t * 0.14;
  const gb = 1 - t * 0.14;
  const gg = 1 - ti * 0.1;
  const grT = 1 + ti * 0.04;
  const gbT = 1 + ti * 0.04;
  const sat = 1 + adj.saturation / 100;
  const hi = adj.highlights / 100;
  const sh = adj.shadows / 100;
  const grain = adj.grain / 100;
  const doColor = t !== 0 || ti !== 0;
  const doLight = hi !== 0 || sh !== 0;
  const doSat = adj.saturation !== 0;
  const n = width * height;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    let r = lut[data[p]!]!;
    let g = lut[data[p + 1]!]!;
    let b = lut[data[p + 2]!]!;
    if (doColor) {
      r = r * gr * grT;
      g = g * gg;
      b = b * gb * gbT;
    }
    if (doLight) {
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      // Bayangan mengangkat/menekan area gelap; sorotan menekan/mengangkat area terang. Bobot halus, tanpa tepi keras.
      const d = sh * 0.3 * (1 - smooth(0.05, 0.6, l)) * 255 + hi * 0.3 * smooth(0.45, 0.95, l) * 255;
      r += d;
      g += d;
      b += d;
    }
    if (doSat) {
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = y + (r - y) * sat;
      g = y + (g - y) * sat;
      b = y + (b - y) * sat;
    }
    if (grain > 0) {
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const mid = 1 - Math.abs(l - 0.5) * 1.2;
      const nz = (hash01(i % width, (i / width) | 0, seed) - 0.5) * 2;
      const amp = nz * grain * 46 * (0.5 + 0.5 * clamp01(mid));
      r += amp;
      g += amp;
      b += amp;
    }
    data[p] = r < 0 ? 0 : r > 255 ? 255 : r;
    data[p + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    data[p + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}

/** Seed stabil dari id (mis. attemptId). */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Fallback piksel untuk `ctx.filter` (tidak ada di Safari/WebKit): menerapkan daftar fungsi filter CSS preset di ruang sRGB,
 * dengan matriks Filter Effects W3C, sehingga preset tampil sama di setiap browser. Fungsi yang tak dikenal dilewati.
 * Hanya fungsi yang dipakai FILTER_PRESETS: brightness, contrast, saturate, sepia, grayscale, hue-rotate.
 */
export function applyCssFilter(data: Uint8ClampedArray, css: string): void {
  if (!css || css === "none") return;
  type M = readonly [number, number, number, number, number, number, number, number, number];
  const ops: ({ m: M } | { mul: number } | { con: number })[] = [];
  const re = /([a-z-]+)\(\s*(-?[\d.]+)(deg|%)?\s*\)/g;
  for (let t = re.exec(css); t; t = re.exec(css)) {
    const fn = t[1]!;
    let v = Number(t[2]);
    if (t[3] === "%") v /= 100;
    if (!Number.isFinite(v)) continue;
    const a = Math.min(1, Math.max(0, v));
    if (fn === "brightness") ops.push({ mul: Math.max(0, v) });
    else if (fn === "contrast") ops.push({ con: Math.max(0, v) });
    else if (fn === "saturate") {
      const s = Math.max(0, v);
      ops.push({ m: [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s] });
    } else if (fn === "sepia") {
      const k = 1 - a;
      ops.push({ m: [0.393 + 0.607 * k, 0.769 - 0.769 * k, 0.189 - 0.189 * k, 0.349 - 0.349 * k, 0.686 + 0.314 * k, 0.168 - 0.168 * k, 0.272 - 0.272 * k, 0.534 - 0.534 * k, 0.131 + 0.869 * k] });
    } else if (fn === "grayscale") {
      const k = 1 - a;
      ops.push({ m: [0.2126 + 0.7874 * k, 0.7152 - 0.7152 * k, 0.0722 - 0.0722 * k, 0.2126 - 0.2126 * k, 0.7152 + 0.2848 * k, 0.0722 - 0.0722 * k, 0.2126 - 0.2126 * k, 0.7152 - 0.7152 * k, 0.0722 + 0.9278 * k] });
    } else if (fn === "hue-rotate") {
      const r = (t[3] === "%" ? 0 : v) * (Math.PI / 180);
      const c = Math.cos(r);
      const s = Math.sin(r);
      ops.push({ m: [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072] });
    }
  }
  if (!ops.length) return;
  for (let p = 0; p < data.length; p += 4) {
    let r = data[p]! / 255;
    let g = data[p + 1]! / 255;
    let b = data[p + 2]! / 255;
    for (const o of ops) {
      if ("m" in o) {
        const m = o.m;
        const nr = m[0] * r + m[1] * g + m[2] * b;
        const ng = m[3] * r + m[4] * g + m[5] * b;
        const nb = m[6] * r + m[7] * g + m[8] * b;
        r = nr < 0 ? 0 : nr > 1 ? 1 : nr;
        g = ng < 0 ? 0 : ng > 1 ? 1 : ng;
        b = nb < 0 ? 0 : nb > 1 ? 1 : nb;
      } else if ("mul" in o) {
        r = Math.min(1, r * o.mul);
        g = Math.min(1, g * o.mul);
        b = Math.min(1, b * o.mul);
      } else {
        const k = o.con;
        const off = 0.5 - 0.5 * k;
        r = Math.min(1, Math.max(0, r * k + off));
        g = Math.min(1, Math.max(0, g * k + off));
        b = Math.min(1, Math.max(0, b * k + off));
      }
    }
    data[p] = Math.round(r * 255);
    data[p + 1] = Math.round(g * 255);
    data[p + 2] = Math.round(b * 255);
  }
}
