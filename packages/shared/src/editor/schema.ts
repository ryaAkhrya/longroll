import type { FilterPresetId } from "../studio/types";

/**
 * Editor kolaboratif (P07, 11 §2–§4). Dokumen = `Y.Doc` per sesi. Koordinat elemen = PUSAT elemen dalam
 * base px kanvas (10 §4); `rotation` derajat searah jarum jam mengelilingi pusat; ukuran dasar `w × h` lalu
 * `scaleX/scaleY` (skala seragam bawaan; non-uniform hanya lewat handle bebas-rasio oleh pengguna).
 */

export const EDITOR_LIMITS = {
  maxElements: 200,
  /** Ukuran satu update (byte, sebelum base64). */
  maxUpdateBytes: 256 * 1024,
  maxDocBytes: 2 * 1024 * 1024,
  maxHistory: 200,
  maxDoodlePoints: 2000,
  maxTextLength: 500,
  minFont: 8,
  maxFont: 400,
  minScale: 0.05,
  maxScale: 20,
  maxCoordFactor: 3,
  /** Penggabungan entri riwayat per elemen per peserta (ms). */
  historyMergeMs: 2000,
  /** Awareness ≤ 20 Hz; payload kecil. */
  maxAwarenessBytes: 4096,
  undoCaptureMs: 500,
  undoStack: 100,
  /** Jendela deteksi "kalah" (ms) & agregasi toast per elemen (ms). */
  conflictWindowMs: 10_000,
  conflictToastMs: 3_000,
  doodleSimplifyEps: 1.5,
  doodleMaxWidth: 80,
} as const;

export type ElementType = "photo" | "sticker" | "text" | "doodle";
export const ELEMENT_TYPES: readonly ElementType[] = ["photo", "sticker", "text", "doodle"];

export type TextFontStyle = "serif" | "display" | "rounded";
export const TEXT_FONT_STYLES: readonly TextFontStyle[] = ["serif", "display", "rounded"];
export const TEXT_FONT_LABEL: Record<TextFontStyle, string> = { serif: "Serif", display: "Tegas", rounded: "Bulat" };
export type TextAlign = "left" | "center" | "right";

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Key-key yang sah per tipe (validator menolak key asing: mencegah dokumen membengkak oleh sampah). */
export const COMMON_KEYS = ["type", "x", "y", "scaleX", "scaleY", "rotation", "opacity", "z", "hidden", "createdBy", "updatedBy"] as const;
export const TYPE_KEYS: Record<ElementType, readonly string[]> = {
  photo: ["attemptId", "ownerId", "ownerName", "slotId", "w", "h", "srcW", "srcH", "crop", "zoom", "flipX", "filter", "radius"],
  sticker: ["assetId", "w", "h", "tint"],
  text: ["content", "fontStyle", "color", "fontSize", "align", "w"],
  doodle: ["points", "color", "width"],
};

export type ElementSnapshot = Record<string, unknown>;

export interface HistoryEntry {
  id: string;
  at: number;
  by: string;
  label: string;
  elementId: string | null;
  /** null = elemen dibuat. */
  before: ElementSnapshot | null;
  /** null = elemen dihapus. */
  after: ElementSnapshot | null;
  /** Entri meta (frame/filter global): nama key meta yang berubah. */
  metaKey?: string;
  /** Entri hasil Balikin merujuk entri asal. */
  revertOf?: string;
}

export interface EditorMeta {
  canvas: { w: number; h: number };
  frame: string | null;
  frameStyle: { bgColor: string; overlayOpacity: number };
  globalFilter: FilterPresetId | null;
  schemaVersion: 1;
}

// ---------------------------------------------------------------- katalog stiker (DEC-055 — SEMENTARA)

export interface StickerPart {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}
export interface StickerAsset {
  id: string;
  name: string;
  category: "bentuk" | "dekor" | "seru";
  /** Semua path dalam viewBox 0 0 100 100. */
  parts: StickerPart[];
  /** Bagian yang memakai `tint` bila diset. */
  tintable: boolean;
  license: { source: string };
}

const OWN = { source: "LONGROLL original — digambar in-repo (P07, 2026-10-29); tanpa aset pihak ketiga. Set SEMENTARA sampai DEC-055 final" };

export const STICKER_CATALOG: readonly StickerAsset[] = [
  { id: "heart", name: "Hati", category: "bentuk", tintable: true, license: OWN, parts: [{ d: "M50 88 C12 60 6 36 22 22 C34 12 46 18 50 30 C54 18 66 12 78 22 C94 36 88 60 50 88 Z", fill: "#F2778F" }] },
  { id: "star", name: "Bintang", category: "bentuk", tintable: true, license: OWN, parts: [{ d: "M50 8 L61 38 L92 40 L68 60 L76 92 L50 74 L24 92 L32 60 L8 40 L39 38 Z", fill: "#F2C94C" }] },
  { id: "sparkle", name: "Kilau", category: "bentuk", tintable: true, license: OWN, parts: [{ d: "M50 4 C54 34 66 46 96 50 C66 54 54 66 50 96 C46 66 34 54 4 50 C34 46 46 34 50 4 Z", fill: "#FFE066" }] },
  { id: "dot", name: "Bulat", category: "bentuk", tintable: true, license: OWN, parts: [{ d: "M50 12 A38 38 0 1 1 49.99 12 Z", fill: "#A893E0" }] },
  { id: "ring", name: "Cincin", category: "bentuk", tintable: true, license: OWN, parts: [{ d: "M50 10 A40 40 0 1 1 49.99 10 Z M50 28 A22 22 0 1 0 50.01 28 Z", fill: "#7DC49D" }] },
  { id: "flower", name: "Bunga", category: "dekor", tintable: false, license: OWN, parts: [
    { d: "M50 6 A18 18 0 1 1 49.9 6 Z M84 28 A18 18 0 1 1 83.9 28 Z M74 70 A18 18 0 1 1 73.9 70 Z M26 70 A18 18 0 1 1 25.9 70 Z M16 28 A18 18 0 1 1 15.9 28 Z", fill: "#F7B6D0" },
    { d: "M50 36 A14 14 0 1 1 49.99 36 Z", fill: "#F2C94C" },
  ] },
  { id: "cloud", name: "Awan", category: "dekor", tintable: true, license: OWN, parts: [{ d: "M26 74 C8 74 6 50 26 48 C26 30 52 22 62 40 C80 34 94 54 80 68 C78 76 70 74 70 74 Z", fill: "#BFD7F5" }] },
  { id: "bolt", name: "Petir", category: "seru", tintable: true, license: OWN, parts: [{ d: "M58 4 L20 56 L46 56 L38 96 L80 40 L54 40 Z", fill: "#F2C94C" }] },
  { id: "tape", name: "Selotip", category: "dekor", tintable: true, license: OWN, parts: [{ d: "M6 30 L94 30 L94 70 L6 70 L12 62 L6 54 L12 46 L6 38 Z", fill: "#F5E3A1" }] },
  { id: "crown", name: "Mahkota", category: "seru", tintable: true, license: OWN, parts: [{ d: "M10 72 L16 30 L36 52 L50 24 L64 52 L84 30 L90 72 Z", fill: "#F2C94C" }, { d: "M10 80 L90 80 L90 88 L10 88 Z", fill: "#E0A92A" }] },
  { id: "smile", name: "Senyum", category: "seru", tintable: false, license: OWN, parts: [
    { d: "M50 6 A44 44 0 1 1 49.99 6 Z", fill: "#FFE066" },
    { d: "M34 38 A6 8 0 1 1 33.99 38 Z M66 38 A6 8 0 1 1 65.99 38 Z", fill: "#3B2350" },
    { d: "M28 60 C36 78 64 78 72 60", stroke: "#3B2350", strokeWidth: 6 },
  ] },
  { id: "arrow", name: "Panah", category: "seru", tintable: true, license: OWN, parts: [{ d: "M8 40 L58 40 L58 22 L94 50 L58 78 L58 60 L8 60 Z", fill: "#F2778F" }] },
  { id: "bubble", name: "Gelembung", category: "seru", tintable: true, license: OWN, parts: [{ d: "M14 14 L86 14 L86 66 L56 66 L38 88 L40 66 L14 66 Z", fill: "#FFFFFF", stroke: "#3B2350", strokeWidth: 4 }] },
  { id: "moon", name: "Bulan", category: "dekor", tintable: true, license: OWN, parts: [{ d: "M64 8 C34 12 18 40 28 66 C38 90 70 96 90 78 C60 78 46 52 56 28 C58 20 60 14 64 8 Z", fill: "#DCD2F6" }] },
  { id: "leaf", name: "Daun", category: "dekor", tintable: true, license: OWN, parts: [{ d: "M12 88 C8 40 40 8 90 10 C92 60 62 92 12 88 Z", fill: "#7DC49D" }, { d: "M16 84 C34 62 54 42 78 24", stroke: "#2E7D5B", strokeWidth: 3 }] },
  { id: "burst", name: "Meledak", category: "seru", tintable: true, license: OWN, parts: [{ d: "M50 4 L58 28 L82 14 L72 38 L96 44 L74 58 L90 80 L64 72 L58 96 L48 74 L28 92 L30 66 L6 62 L26 48 L10 28 L36 36 Z", fill: "#FF8A5C" }] },
];

export const STICKER_IDS: ReadonlySet<string> = new Set(STICKER_CATALOG.map((s) => s.id));
export const STICKER_CATEGORY_LABEL: Record<StickerAsset["category"], string> = { bentuk: "Bentuk", dekor: "Dekor", seru: "Seru" };

export function stickerAsset(id: string): StickerAsset | undefined {
  return STICKER_CATALOG.find((s) => s.id === id);
}

export const TEXT_COLORS = ["#1B1720", "#FFFFFF", "#F2778F", "#F2C94C", "#7DC49D", "#A893E0", "#3B2350"] as const;
export const DOODLE_COLORS = ["#F2778F", "#1B1720", "#FFFFFF", "#F2C94C", "#7DC49D", "#A893E0"] as const;
export const DOODLE_WIDTHS = [4, 8, 14] as const;
