import type { Adjust } from "../render/adjust";
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
  photo: ["attemptId", "ownerId", "ownerName", "slotId", "w", "h", "srcW", "srcH", "crop", "zoom", "flipX", "filter", "radius", "adjust"],
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
  /** Penyesuaian foto untuk semua foto (non-destruktif, Phase 3). Hanya kunci ≠ 0; absen/null = netral. */
  globalAdjust?: Partial<Adjust> | null;
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

const OWN3 = { source: "LONGROLL original — digambar in-repo (Phase 3, 2026-10-30); tanpa aset pihak ketiga" };
const OWN = { source: "LONGROLL original — digambar in-repo (P07, 2026-10-29); tanpa aset pihak ketiga. Set SEMENTARA sampai DEC-055 final" };

export const STICKER_CATALOG: readonly StickerAsset[] = [
  { id: "heart", name: "Hati", category: "bentuk", tintable: true, license: OWN, parts: [{ d: "M50 88 C12 60 6 36 22 22 C34 12 46 18 50 30 C54 18 66 12 78 22 C94 36 88 60 50 88 Z", fill: "#F2778F" }] },
  { id: "star", name: "Bintang", category: "bentuk", tintable: true, license: OWN, parts: [{ d: "M50 8 L61 38 L92 40 L68 60 L76 92 L50 74 L24 92 L32 60 L8 40 L39 38 Z", fill: "#F2C94C" }] },
  { id: "sparkle", name: "Kilau", category: "bentuk", tintable: true, license: OWN, parts: [{ d: "M50 4 C54 34 66 46 96 50 C66 54 54 66 50 96 C46 66 34 54 4 50 C34 46 46 34 50 4 Z", fill: "#FFE066" }] },
  { id: "dot", name: "Bulat", category: "bentuk", tintable: true, license: OWN, parts: [{ d: "M50 12 A38 38 0 1 1 49.99 12 Z", fill: "#A893E0" }] },
  { id: "ring", name: "Cincin", category: "bentuk", tintable: true, license: OWN, parts: [{ d: "M50 10 A40 40 0 1 1 49.99 10 Z M50 28 A22 22 0 1 0 50.01 28 Z", fill: "#7DC49D" }] },
  { id: "flower", name: "Bunga", category: "dekor", tintable: false, license: OWN, parts: [
    { d: "M50 7 A17 17 0 1 1 49.99 7 Z M76 26 A17 17 0 1 1 75.99 26 Z M66 57 A17 17 0 1 1 65.99 57 Z M34 57 A17 17 0 1 1 33.99 57 Z M24 26 A17 17 0 1 1 23.99 26 Z", fill: "#F7B6D0" },
    { d: "M50 39 A13 13 0 1 1 49.99 39 Z", fill: "#F2C94C" },
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
  // ---- Phase 3 (2026-10-30): selotip washi, garis tangan, dan ikon photobooth. Digambar in-repo (viewBox 100×100), tanpa aset pihak ketiga.
  { id: "tape-dots", name: "Selotip titik", category: "dekor", tintable: false, license: OWN3, parts: [
    { d: "M4 30 L96 30 L96 70 L4 70 L10 62 L4 54 L10 46 L4 38 Z", fill: "#F8D4DE" },
    { d: "M22 44 A4 4 0 1 1 21.99 44 Z M40 56 A4 4 0 1 1 39.99 56 Z M58 44 A4 4 0 1 1 57.99 44 Z M76 56 A4 4 0 1 1 75.99 56 Z", fill: "#E8788F" },
  ] },
  { id: "tape-stripe", name: "Selotip garis", category: "dekor", tintable: false, license: OWN3, parts: [
    { d: "M4 30 L96 30 L96 70 L4 70 L10 62 L4 54 L10 46 L4 38 Z", fill: "#CDEBDD" },
    { d: "M20 30 L32 30 L22 70 L10 70 Z M46 30 L58 30 L48 70 L36 70 Z M72 30 L84 30 L74 70 L62 70 Z", fill: "#9FD3BB" },
  ] },
  { id: "star-line", name: "Bintang garis", category: "bentuk", tintable: false, license: OWN3, parts: [{ d: "M50 10 L60 38 L90 40 L66 58 L74 88 L50 72 L26 88 L34 58 L10 40 L40 38 Z", stroke: "#3B2350", strokeWidth: 4 }] },
  { id: "heart-line", name: "Hati garis", category: "bentuk", tintable: false, license: OWN3, parts: [{ d: "M50 86 C16 60 10 38 25 26 C36 17 46 22 50 33 C54 22 64 17 75 26 C90 38 84 60 50 86 Z", stroke: "#F2778F", strokeWidth: 5 }] },
  { id: "squiggle", name: "Gelombang", category: "dekor", tintable: false, license: OWN3, parts: [{ d: "M6 58 C18 28 30 28 38 54 S58 82 68 52 S86 34 94 46", stroke: "#A893E0", strokeWidth: 7 }] },
  { id: "sparkles", name: "Kilau tiga", category: "bentuk", tintable: true, license: OWN3, parts: [
    { d: "M35 38 C37 52 43 58 57 60 C43 62 37 68 35 82 C33 68 27 62 13 60 C27 58 33 52 35 38 Z M70 16 C72 26 76 30 86 32 C76 34 72 38 70 48 C68 38 64 34 54 32 C64 30 68 26 70 16 Z M72 64 C73 70 76 72 82 74 C76 76 73 78 72 84 C71 78 68 76 62 74 C68 72 71 70 72 64 Z", fill: "#FFE066" },
  ] },
  { id: "plus", name: "Plus", category: "bentuk", tintable: true, license: OWN3, parts: [{ d: "M40 12 H60 V40 H88 V60 H60 V88 H40 V60 H12 V40 H40 Z", fill: "#F2778F" }] },
  { id: "sun", name: "Matahari", category: "dekor", tintable: false, license: OWN3, parts: [
    { d: "M50 2 L57 24 L78 12 L70 33 L94 36 L76 50 L94 64 L70 67 L78 88 L57 76 L50 98 L43 76 L22 88 L30 67 L6 64 L24 50 L6 36 L30 33 L22 12 L43 24 Z", fill: "#F6C453" },
    { d: "M50 32 A18 18 0 1 1 49.99 32 Z", fill: "#FFE9A0" },
  ] },
  { id: "camera", name: "Kamera", category: "seru", tintable: false, license: OWN3, parts: [
    { d: "M10 32 L30 32 L36 22 L64 22 L70 32 L90 32 L90 80 L10 80 Z", fill: "#3B2350" },
    { d: "M50 40 A20 20 0 1 1 49.99 40 Z", fill: "#F6F3EE" },
    { d: "M50 49 A11 11 0 1 1 49.99 49 Z", fill: "#A893E0" },
    { d: "M76 38 L84 38 L84 44 L76 44 Z", fill: "#F2C94C" },
  ] },
  { id: "film-roll", name: "Rol film", category: "dekor", tintable: false, license: OWN3, parts: [
    { d: "M6 22 L94 22 L94 78 L6 78 Z", fill: "#1B1720" },
    { d: "M12 27 H20 V33 H12 Z M28 27 H36 V33 H28 Z M44 27 H52 V33 H44 Z M60 27 H68 V33 H60 Z M76 27 H84 V33 H76 Z M12 67 H20 V73 H12 Z M28 67 H36 V73 H28 Z M44 67 H52 V73 H44 Z M60 67 H68 V73 H60 Z M76 67 H84 V73 H76 Z", fill: "#F6F3EE" },
    { d: "M12 38 H36 V62 H12 Z M40 38 H64 V62 H40 Z M68 38 H88 V62 H68 Z", fill: "#6B6470" },
  ] },
  { id: "ticket", name: "Tiket", category: "dekor", tintable: false, license: OWN3, parts: [
    { d: "M8 24 L92 24 L92 44 A6 6 0 0 0 92 56 L92 76 L8 76 L8 56 A6 6 0 0 0 8 44 Z", fill: "#FFE5A8" },
    { d: "M68 28 L70 28 L70 72 L68 72 Z", fill: "#C99A3E" },
    { d: "M18 40 H56 V46 H18 Z M18 54 H44 V60 H18 Z", fill: "#C99A3E" },
  ] },
];

export const STICKER_IDS: ReadonlySet<string> = new Set(STICKER_CATALOG.map((s) => s.id));
export const STICKER_CATEGORY_LABEL: Record<StickerAsset["category"], string> = { bentuk: "Bentuk", dekor: "Dekor", seru: "Seru" };

export function stickerAsset(id: string): StickerAsset | undefined {
  return STICKER_CATALOG.find((s) => s.id === id);
}

export const TEXT_COLORS = ["#1B1720", "#FFFFFF", "#F2778F", "#F2C94C", "#7DC49D", "#A893E0", "#3B2350"] as const;
export const DOODLE_COLORS = ["#F2778F", "#1B1720", "#FFFFFF", "#F2C94C", "#7DC49D", "#A893E0"] as const;
export const DOODLE_WIDTHS = [4, 8, 14] as const;
