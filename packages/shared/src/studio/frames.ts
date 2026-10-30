import { MODES } from "../session";
import type { Mode } from "../session";
import type { DecorSpec, FrameCategory, FrameTemplate, SlotStyle } from "./types";

/**
 * Library frame bawaan (10 §2, 05 §12, DEC-066). Frame bawaan bersifat PARAMETRIK: latar, gaya slot, dan dekor digambar
 * oleh renderer yang sama untuk studio, editor, dan export, mengikuti BindingPlan aktif (1–8 shot, kedua strategi). Tidak ada
 * artwork raster yang perlu di-stretch, tidak ada aset yang bisa gagal dimuat, dan tidak ada hotlink saat runtime.
 *
 * Provenance & lisensi: semua desain dibuat orisinal di repo ini (P05 + Phase 3, 2026-10). Warna, pola (garis, grid, papan
 * catur, titik, kertas) dan bentuk (bintang, hati, kilau, titik, plus) digambar prosedural dari path milik repo; font memakai
 * Bricolage Grotesque, Instrument Serif, Figtree (OFL, sudah dilampirkan di /public/fonts). Tidak memakai aset pihak ketiga.
 */
const ORIGINAL = { source: "LONGROLL original — dibuat in-repo (P05 2026-10-26; Phase 3 2026-10-30), tanpa aset pihak ketiga" };

const ALL: Mode[] = [...MODES];
/** Frame bertema film/kontak cocok untuk susunan baris-kolom (strip & grid), bukan kanvas lebar/bebas. */
const ROWS: Mode[] = ["PHOTO_STRIP", "PHOTO_GRID"];
/** Frame bergaya bingkai foto/majalah paling bagus di bidang lebar, grid, dan kolase. */
const WIDE: Mode[] = ["GROUP_SHOT", "PHOTO_GRID", "FREEFORM_COLLAGE", "PHOTO_STRIP"];

const MARK_BL: DecorSpec = { type: "mark", anchor: "bottom-left", color: "#1B1720" };
const dateMono = (color: string, anchor: "bottom-right" | "bottom-left" | "bottom-center" = "bottom-right", size = 0.02): DecorSpec => ({ type: "date", format: "YYYY.MM.DD", anchor, color, font: "mono", size });

function frame(id: string, name: string, category: FrameCategory, o: Omit<FrameTemplate, "id" | "name" | "category" | "modes" | "baseSize" | "adapt" | "license" | "version"> & { modes?: Mode[]; baseSize?: FrameTemplate["baseSize"]; adapt?: FrameTemplate["adapt"] }): FrameTemplate {
  return { id: `builtin/${id}@1`, name, category, modes: o.modes ?? ALL, baseSize: o.baseSize ?? { w: 600, h: 1800 }, adapt: o.adapt ?? "CONTAIN", license: ORIGINAL, version: 1, ...o } as FrameTemplate;
}

const slot = (s: SlotStyle): SlotStyle => s;

export const BUILTIN_FRAMES: readonly FrameTemplate[] = [
  // ------------------------------------------------------------------ KOREAN / MINIMAL (bawaan P05)
  frame("seoul-strip", "Seoul Strip", "KOREAN", {
    layers: { background: { kind: "solid", color: "#FFFFFF" }, decor: [MARK_BL, dateMono("#6B6470", "bottom-right", 0.022)] },
    slotStyle: slot({ radius: 2 }),
    palette: { bg: "#FFFFFF", ink: "#1B1720" },
  }),
  frame("editorial", "Editorial", "MINIMAL", {
    baseSize: { w: 1200, h: 1500 },
    layers: {
      background: { kind: "solid", color: "#FBF8F2" },
      decor: [
        { type: "text", text: "foto bareng", anchor: "bottom-left", color: "#1B1720", font: "serif", size: 0.045, italic: true },
        { type: "names", anchor: "bottom-left", color: "#6B6470", size: 0.018 },
        dateMono("#6B6470", "bottom-right", 0.018),
      ],
    },
    slotStyle: slot({ radius: 0 }),
    palette: { bg: "#FBF8F2", ink: "#1B1720" },
  }),
  frame("linen", "Linen", "MINIMAL", {
    baseSize: { w: 1200, h: 1800 },
    layers: { background: { kind: "solid", color: "#F6F3EE" } },
    palette: { bg: "#F6F3EE", ink: "#1B1720" },
  }),

  // ------------------------------------------------------------------ MONO
  frame("classic-black", "Classic Black", "MONO", {
    layers: {
      background: { kind: "solid", color: "#121012" },
      decor: [{ type: "border", color: "#F4F1EA", inset: 0.016, width: 0.003 }, { type: "mark", anchor: "bottom-left", color: "#F4F1EA" }, dateMono("#A9A3AE")],
    },
    slotStyle: slot({ stroke: "#F4F1EA", strokeWidth: 3, radius: 0 }),
    palette: { bg: "#121012", ink: "#F4F1EA" },
  }),
  frame("mono-press", "Mono Press", "MONO", {
    layers: {
      background: { kind: "solid", color: "#FFFFFF" },
      decor: [
        { type: "border", color: "#111111", inset: 0.02, width: 0.004 },
        { type: "text", text: "FOTO BARENG", anchor: "bottom-left", color: "#111111", font: "display", size: 0.026 },
        dateMono("#111111"),
      ],
    },
    slotStyle: slot({ stroke: "#111111", strokeWidth: 2, radius: 0 }),
    palette: { bg: "#FFFFFF", ink: "#111111" },
  }),

  // ------------------------------------------------------------------ RETRO
  frame("film-400", "Film 400", "RETRO", {
    modes: ROWS,
    layers: { background: { kind: "solid", color: "#141114" }, decor: [{ type: "sprockets", color: "#F3EDE2" }, { type: "frameNumbers", color: "#E39A3C" }] },
    slotStyle: slot({ radius: 0 }),
    palette: { bg: "#141114", ink: "#F3EDE2" },
  }),
  frame("super-8", "Super 8", "RETRO", {
    modes: ROWS,
    layers: { background: { kind: "solid", color: "#2A1A12" }, decor: [{ type: "sprockets", color: "#E9C27A" }, { type: "frameNumbers", color: "#E9C27A" }, dateMono("#C99F55")] },
    slotStyle: slot({ radius: 0 }),
    palette: { bg: "#2A1A12", ink: "#E9C27A" },
  }),
  frame("contact-sheet", "Contact Sheet", "RETRO", {
    modes: ROWS,
    baseSize: { w: 1200, h: 1800 },
    layers: {
      background: { kind: "grid", bg: "#EDE8DF", line: "#C9C1B3", spacing: 20 },
      decor: [{ type: "label", text: "CONTACT 400", anchor: "top-left", color: "#5E5648", font: "mono", size: 0.02 }, { type: "frameNumbers", color: "#8A4B2A" }, dateMono("#5E5648")],
    },
    slotStyle: slot({ stroke: "#1B1720", strokeWidth: 2, radius: 0 }),
    palette: { bg: "#EDE8DF", ink: "#1B1720" },
  }),
  frame("vhs-night", "VHS Night", "RETRO", {
    layers: {
      background: { kind: "linear", from: "#1B1038", to: "#3B1D5E", angle: 160 },
      decor: [
        { type: "label", text: "● REC", anchor: "top-left", color: "#FF5C7A", font: "mono", size: 0.026 },
        { type: "text", text: "PLAY ▶", anchor: "bottom-left", color: "#BDB2E6", font: "mono", size: 0.022 },
        dateMono("#BDB2E6"),
      ],
    },
    slotStyle: slot({ radius: 4 }),
    palette: { bg: "#2B1650", ink: "#E6DEFF" },
  }),
  frame("sunset-stripe", "Sunset Stripe", "RETRO", {
    layers: {
      background: { kind: "stripes", bg: "#F7E3C6", stripe: "#F2A65A", spacing: 26, width: 9 },
      decor: [{ type: "text", text: "golden hour", anchor: "bottom-center", color: "#8A3B12", font: "serif", size: 0.04, italic: true }],
    },
    slotStyle: slot({ stroke: "#FFF8EC", strokeWidth: 9, radius: 14 }),
    palette: { bg: "#F7E3C6", ink: "#8A3B12" },
  }),

  // ------------------------------------------------------------------ POLAROID
  frame("polaroid-classic", "Polaroid Classic", "POLAROID", {
    modes: WIDE,
    baseSize: { w: 1200, h: 1500 },
    adapt: "PATTERN",
    layers: {
      background: { kind: "solid", color: "#EFE9DD" },
      decor: [{ type: "text", text: "foto bareng", anchor: "bottom-center", color: "#6B6470", font: "serif", size: 0.036, italic: true }, dateMono("#8A8290", "bottom-right", 0.018)],
    },
    slotStyle: slot({ polaroid: true, shadow: true, polaroidBottom: 0.2, radius: 0 }),
    palette: { bg: "#EFE9DD", ink: "#1B1720" },
  }),
  frame("polaroid-pile", "Polaroid Pile", "POLAROID", {
    modes: ["PHOTO_GRID", "GROUP_SHOT", "FREEFORM_COLLAGE"],
    baseSize: { w: 1600, h: 1600 },
    adapt: "PATTERN",
    layers: {
      background: { kind: "linear", from: "#E9D8C0", to: "#D9B995", angle: 160 },
      decor: [{ type: "tape", color: "#F2D98A" }, dateMono("#6B4A2A")],
    },
    slotStyle: slot({ polaroid: true, tilt: 6, shadow: true, radius: 0 }),
    palette: { bg: "#E2C9A8", ink: "#3B2A18" },
  }),
  frame("instax-mint", "Instax Mini", "POLAROID", {
    modes: WIDE,
    baseSize: { w: 1200, h: 1500 },
    adapt: "PATTERN",
    layers: {
      background: { kind: "solid", color: "#DDEFE6" },
      decor: [{ type: "shapes", shape: "sparkle", color: "#FFFFFF", edge: "top", count: 5, size: 0.028, opacity: 0.9 }, dateMono("#3E7D63", "bottom-right", 0.018)],
    },
    slotStyle: slot({ polaroid: true, shadow: true, tilt: 2, polaroidBottom: 0.25, polaroidSide: 0.06, polaroidColor: "#FBFBF6", radius: 0 }),
    palette: { bg: "#DDEFE6", ink: "#2E6B52" },
  }),

  // ------------------------------------------------------------------ SCRAPBOOK
  frame("scrapbook", "Scrapbook", "SCRAPBOOK", {
    baseSize: { w: 1600, h: 1600 },
    adapt: "PATTERN",
    layers: {
      background: { kind: "paper", bg: "#EFE5D3", fleck: "#D9C9AC", spacing: 22 },
      decor: [{ type: "tape", color: "#F2D98A" }, { type: "text", text: "jangan lupa kita ✶", anchor: "bottom-left", color: "#3B2350", font: "serif", size: 0.04, italic: true }],
    },
    slotStyle: slot({ polaroid: true, tilt: 4, shadow: true, radius: 0 }),
    palette: { bg: "#EFE5D3", ink: "#3B2350" },
  }),

  // ------------------------------------------------------------------ EDITORIAL
  frame("magazine", "Magazine", "EDITORIAL", {
    modes: WIDE,
    baseSize: { w: 1200, h: 1500 },
    layers: {
      background: { kind: "solid", color: "#F7F3EA" },
      decor: [
        { type: "border", color: "#1B1720", inset: 0.018, width: 0.003 },
        { type: "text", text: "LONGROLL", anchor: "bottom-left", color: "#1B1720", font: "display", size: 0.05 },
        { type: "names", anchor: "bottom-left", color: "#6B6470", size: 0.016 },
        dateMono("#8A3B12", "bottom-right", 0.018),
      ],
    },
    slotStyle: slot({ radius: 0 }),
    palette: { bg: "#F7F3EA", ink: "#1B1720" },
  }),
  frame("gallery-wall", "Gallery Wall", "EDITORIAL", {
    modes: WIDE,
    baseSize: { w: 1200, h: 1500 },
    adapt: "PATTERN",
    layers: {
      background: { kind: "solid", color: "#E6E4E1" },
      decor: [{ type: "text", text: "no. 1", anchor: "bottom-left", color: "#4A4451", font: "serif", size: 0.034, italic: true }, dateMono("#6B6470", "bottom-right", 0.016)],
    },
    slotStyle: slot({ polaroid: true, shadow: true, polaroidBottom: 0.08, polaroidSide: 0.08, radius: 0 }),
    palette: { bg: "#E6E4E1", ink: "#1B1720" },
  }),

  // ------------------------------------------------------------------ PASTEL
  frame("lilac-dream", "Lilac Dream", "PASTEL", {
    adapt: "PATTERN",
    layers: {
      background: { kind: "dots", bg: "#F7D6E2", bgTo: "#DCD2F6", dot: "#FFFFFF", spacing: 18, radius: 2.4 },
      decor: [{ type: "text", text: "♡ besties ♡", anchor: "bottom-center", color: "#7A5A9E", font: "serif", size: 0.03, italic: true }],
    },
    slotStyle: slot({ stroke: "#FFFFFF", strokeWidth: 6, radius: 18 }),
    palette: { bg: "#EBD6EE", ink: "#3B2350" },
  }),
  frame("mint-soda", "Mint Soda", "PASTEL", {
    layers: {
      background: { kind: "stripes", bg: "#E4F6EE", stripe: "#CFEFE0", spacing: 24, width: 8 },
      decor: [{ type: "text", text: "mint soda", anchor: "bottom-left", color: "#2E6B52", font: "display", size: 0.03 }, dateMono("#3E7D63")],
    },
    slotStyle: slot({ stroke: "#FFFFFF", strokeWidth: 6, radius: 12 }),
    palette: { bg: "#E4F6EE", ink: "#2E6B52" },
  }),

  // ------------------------------------------------------------------ COUPLE
  frame("date-night", "Date Night", "COUPLE", {
    layers: {
      background: { kind: "solid", color: "#2A0F1C" },
      decor: [
        { type: "border", color: "#D9B26F", inset: 0.02, width: 0.003, double: true },
        { type: "shapes", shape: "sparkle", color: "#D9B26F", edge: "corners", count: 4, size: 0.03 },
        { type: "text", text: "date night", anchor: "bottom-center", color: "#F3D9A4", font: "serif", size: 0.05, italic: true },
      ],
    },
    slotStyle: slot({ stroke: "#D9B26F", strokeWidth: 2, radius: 0 }),
    palette: { bg: "#2A0F1C", ink: "#F3D9A4" },
  }),
  frame("rose", "Rose", "COUPLE", {
    layers: {
      background: { kind: "linear", from: "#FCE3E6", to: "#F7C8D2", angle: 160 },
      decor: [{ type: "shapes", shape: "heart", color: "#E8788F", edge: "top", count: 5, size: 0.028, opacity: 0.85 }, { type: "text", text: "momen kita", anchor: "bottom-center", color: "#B3465E", font: "serif", size: 0.04, italic: true }],
    },
    slotStyle: slot({ stroke: "#FFFFFF", strokeWidth: 6, radius: 16 }),
    palette: { bg: "#FAD5DC", ink: "#8E2E45" },
  }),

  // ------------------------------------------------------------------ FRIENDS
  frame("bestie-club", "Bestie Club", "FRIENDS", {
    adapt: "PATTERN",
    layers: {
      background: { kind: "checker", bg: "#FFE8F0", alt: "#FFFFFF", size: 22 },
      decor: [{ type: "text", text: "BESTIE CLUB", anchor: "bottom-left", color: "#1B1720", font: "display", size: 0.036 }, { type: "names", anchor: "bottom-left", color: "#6B6470", size: 0.016 }],
    },
    slotStyle: slot({ stroke: "#1B1720", strokeWidth: 4, radius: 10 }),
    palette: { bg: "#FFE8F0", ink: "#1B1720" },
  }),
  frame("geng", "Geng", "FRIENDS", {
    layers: {
      background: { kind: "solid", color: "#F2C94C" },
      decor: [{ type: "text", text: "GENG", anchor: "bottom-center", color: "#1B1720", font: "display", size: 0.07 }],
    },
    slotStyle: slot({ stroke: "#1B1720", strokeWidth: 5, radius: 0 }),
    palette: { bg: "#F2C94C", ink: "#1B1720" },
  }),

  // ------------------------------------------------------------------ SEASON (musiman / tema)
  frame("merdeka", "Merdeka", "SEASON", {
    layers: {
      background: { kind: "solid", color: "#FFFFFF" },
      decor: [{ type: "border", color: "#D8232A", inset: 0, width: 0.024 }, { type: "text", text: "MERDEKA", anchor: "bottom-center", color: "#D8232A", font: "display", size: 0.045 }],
    },
    slotStyle: slot({ stroke: "#D8232A", strokeWidth: 4, radius: 0 }),
    palette: { bg: "#FFFFFF", ink: "#D8232A" },
  }),
  frame("holiday", "Holiday", "SEASON", {
    layers: {
      background: { kind: "solid", color: "#123B2A" },
      decor: [
        { type: "border", color: "#D9B26F", inset: 0.02, width: 0.003 },
        { type: "shapes", shape: "star", color: "#F2C94C", edge: "corners", count: 4, size: 0.034 },
        { type: "text", text: "selamat liburan", anchor: "bottom-center", color: "#F3E3B5", font: "serif", size: 0.044, italic: true },
      ],
    },
    slotStyle: slot({ stroke: "#D9B26F", strokeWidth: 2, radius: 0 }),
    palette: { bg: "#123B2A", ink: "#F3E3B5" },
  }),

  // ------------------------------------------------------------------ GRID
  frame("mosaic", "Mosaic", "GRID", {
    baseSize: { w: 1600, h: 1600 },
    adapt: "PATTERN",
    // Kertas milimeter biru muda + ubin berbingkai putih: berbeda jelas dari frame putih polos (Seoul/Mono Press).
    layers: { background: { kind: "grid", bg: "#E6EEFF", line: "#B7C8F5", spacing: 36 }, decor: [{ type: "text", text: "sesi bareng", anchor: "bottom-left", color: "#1F2F66", font: "display", size: 0.03 }, dateMono("#4A5A94", "bottom-right", 0.018)] },
    slotStyle: slot({ stroke: "#FFFFFF", strokeWidth: 8, radius: 0 }),
    palette: { bg: "#E6EEFF", ink: "#1F2F66" },
  }),
];

/** Fallback bila aset frame gagal dimuat (P05 §18). */
export const FALLBACK_FRAME_ID = "builtin/linen@1";

export const FRAME_CATEGORY_LABEL: Record<FrameCategory, string> = {
  KOREAN: "Korean",
  MINIMAL: "Minimal",
  MONO: "Monokrom",
  RETRO: "Retro",
  POLAROID: "Polaroid",
  SCRAPBOOK: "Scrapbook",
  EDITORIAL: "Editorial",
  PASTEL: "Pastel",
  COUPLE: "Date night",
  FRIENDS: "Sahabat",
  SEASON: "Musiman",
  GRID: "Grid",
  CUSTOM: "Punyaku",
};

/** Urutan kategori di galeri frame (hanya yang punya frame yang ditampilkan). */
export const FRAME_CATEGORY_ORDER: readonly FrameCategory[] = ["KOREAN", "MINIMAL", "MONO", "RETRO", "POLAROID", "SCRAPBOOK", "EDITORIAL", "PASTEL", "COUPLE", "FRIENDS", "SEASON", "GRID", "CUSTOM"];

export function builtinFrame(id: string): FrameTemplate | undefined {
  return BUILTIN_FRAMES.find((f) => f.id === id);
}

/** Frame bawaan yang cocok untuk mode tertentu (frame custom tidak dibatasi mode). */
export function framesForMode(mode: Mode): FrameTemplate[] {
  return BUILTIN_FRAMES.filter((f) => f.modes.includes(mode));
}
