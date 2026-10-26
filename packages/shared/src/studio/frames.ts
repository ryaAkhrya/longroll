import { MODES } from "../session";
import type { FrameCategory, FrameTemplate } from "./types";

/**
 * Library frame bawaan (10 §2, 05 §12, DEC-066 target MVP ≥ 6). Frame bawaan bersifat PARAMETRIK:
 * latar, gaya slot, dan dekor digambar oleh renderer mengikuti BindingPlan aktif (1–8 shot, kedua
 * strategi), jadi tidak ada artwork raster yang perlu di-stretch. Pola (titik, kertas) digambar
 * prosedural oleh renderer — tidak ada aset statis yang bisa gagal dimuat.
 *
 * Provenance: semua desain di bawah dibuat orisinal di repo ini (P05) mengikuti deskripsi gaya
 * 05 §12 & Brand_Identity bagian 04. Tidak memakai aset pihak ketiga.
 */
const ORIGINAL = { source: "LONGROLL original — dibuat in-repo (P05, 2026-10-26), tanpa aset pihak ketiga" };

export const BUILTIN_FRAMES: readonly FrameTemplate[] = [
  {
    id: "builtin/seoul-strip@1",
    name: "Seoul Strip",
    category: "KOREAN",
    modes: [...MODES],
    baseSize: { w: 600, h: 1800 },
    adapt: "CONTAIN",
    layers: {
      background: { kind: "solid", color: "#FFFFFF" },
      decor: [
        { type: "mark", anchor: "bottom-left", color: "#1B1720" },
        { type: "date", format: "YYYY.MM.DD", anchor: "bottom-right", color: "#6B6470", font: "mono", size: 0.022 },
      ],
    },
    slotStyle: { radius: 2 },
    palette: { bg: "#FFFFFF", ink: "#1B1720" },
    license: ORIGINAL,
    version: 1,
  },
  {
    id: "builtin/editorial@1",
    name: "Editorial",
    category: "MINIMAL",
    modes: [...MODES],
    baseSize: { w: 1200, h: 1500 },
    adapt: "CONTAIN",
    layers: {
      background: { kind: "solid", color: "#FBF8F2" },
      decor: [
        { type: "text", text: "cekrek bareng", anchor: "bottom-left", color: "#1B1720", font: "serif", size: 0.045, italic: true },
        { type: "names", anchor: "bottom-left", color: "#6B6470", size: 0.018 },
        { type: "date", format: "YYYY.MM.DD", anchor: "bottom-right", color: "#6B6470", font: "mono", size: 0.018 },
      ],
    },
    slotStyle: { radius: 0 },
    palette: { bg: "#FBF8F2", ink: "#1B1720" },
    license: ORIGINAL,
    version: 1,
  },
  {
    id: "builtin/film-400@1",
    name: "Film 400",
    category: "RETRO",
    modes: [...MODES],
    baseSize: { w: 600, h: 1800 },
    adapt: "CONTAIN",
    layers: {
      background: { kind: "solid", color: "#141114" },
      decor: [
        { type: "sprockets", color: "#F3EDE2" },
        { type: "frameNumbers", color: "#E39A3C" },
      ],
    },
    slotStyle: { radius: 0 },
    palette: { bg: "#141114", ink: "#F3EDE2" },
    license: ORIGINAL,
    version: 1,
  },
  {
    id: "builtin/scrapbook@1",
    name: "Scrapbook",
    category: "SCRAPBOOK",
    modes: [...MODES],
    baseSize: { w: 1600, h: 1600 },
    adapt: "PATTERN",
    layers: {
      background: { kind: "paper", bg: "#EFE5D3", fleck: "#D9C9AC", spacing: 22 },
      decor: [
        { type: "tape", color: "#F2D98A" },
        { type: "text", text: "jangan lupa kita ✶", anchor: "bottom-left", color: "#3B2350", font: "serif", size: 0.04, italic: true },
      ],
    },
    slotStyle: { polaroid: true, tilt: 4, shadow: true, radius: 0 },
    palette: { bg: "#EFE5D3", ink: "#3B2350" },
    license: ORIGINAL,
    version: 1,
  },
  {
    id: "builtin/lilac-dream@1",
    name: "Lilac Dream",
    category: "PASTEL",
    modes: [...MODES],
    baseSize: { w: 600, h: 1800 },
    adapt: "PATTERN",
    layers: {
      background: { kind: "dots", bg: "#F7D6E2", bgTo: "#DCD2F6", dot: "#FFFFFF", spacing: 18, radius: 2.4 },
      decor: [{ type: "text", text: "♡ besties ♡", anchor: "bottom-center", color: "#7A5A9E", font: "serif", size: 0.03, italic: true }],
    },
    slotStyle: { stroke: "#FFFFFF", strokeWidth: 6, radius: 18 },
    palette: { bg: "#EBD6EE", ink: "#3B2350" },
    license: ORIGINAL,
    version: 1,
  },
  {
    id: "builtin/mosaic@1",
    name: "Mosaic",
    category: "GRID",
    modes: [...MODES],
    baseSize: { w: 1600, h: 1600 },
    adapt: "CONTAIN",
    layers: {
      background: { kind: "solid", color: "#FFFFFF" },
      decor: [
        { type: "text", text: "sesi bareng", anchor: "bottom-left", color: "#1B1720", font: "display", size: 0.03 },
        { type: "date", format: "YYYY.MM.DD", anchor: "bottom-right", color: "#6B6470", font: "mono", size: 0.018 },
      ],
    },
    slotStyle: { radius: 0 },
    palette: { bg: "#FFFFFF", ink: "#1B1720" },
    license: ORIGINAL,
    version: 1,
  },
  {
    id: "builtin/linen@1",
    name: "Linen",
    category: "MINIMAL",
    modes: [...MODES],
    baseSize: { w: 1200, h: 1800 },
    adapt: "CONTAIN",
    layers: { background: { kind: "solid", color: "#F6F3EE" } },
    palette: { bg: "#F6F3EE", ink: "#1B1720" },
    license: ORIGINAL,
    version: 1,
  },
];

/** Fallback bila aset frame gagal dimuat (P05 §18). */
export const FALLBACK_FRAME_ID = "builtin/linen@1";

export const FRAME_CATEGORY_LABEL: Record<FrameCategory, string> = {
  KOREAN: "Korean",
  MINIMAL: "Minimal",
  RETRO: "Retro",
  SCRAPBOOK: "Scrapbook",
  PASTEL: "Pastel",
  GRID: "Grid",
  CUSTOM: "Punyaku",
};

export function builtinFrame(id: string): FrameTemplate | undefined {
  return BUILTIN_FRAMES.find((f) => f.id === id);
}
