import type { Mode } from "../session";
import type { Arrangement, BindingStrategy, FilterPresetId, OutputPreset, SlotRatio, StudioStyle } from "./types";

/**
 * Default studio per mode (konfigurasi terpusat).
 *
 * ⚠ `bindingStrategy` di sini adalah DEFAULT SEMENTARA — DEC-061 masih OPEN (pemilik produk).
 * Kedua strategi (PER_SHOT_GROUP & PER_PARTICIPANT_SHOT) tetap tersedia dan bisa diganti lewat
 * `studio.bindingStrategy` sebelum shot pertama. Mengubah default cukup di objek ini.
 */
export const STUDIO_MODE_DEFAULTS: Record<
  Mode,
  { bindingStrategy: BindingStrategy; strategies: BindingStrategy[]; arrangement: Arrangement; arrangements: Arrangement[]; shotCount: number; maxShots: number; slotRatio: SlotRatio; frameId: string }
> = {
  PHOTO_STRIP: {
    bindingStrategy: "PER_SHOT_GROUP",
    strategies: ["PER_SHOT_GROUP", "PER_PARTICIPANT_SHOT"],
    arrangement: "STRIP_VERTICAL",
    arrangements: ["STRIP_VERTICAL", "STRIP_HORIZONTAL", "STRIP_ZIGZAG"],
    shotCount: 4,
    maxShots: 8,
    slotRatio: "4:3",
    frameId: "builtin/seoul-strip@1",
  },
  GROUP_SHOT: {
    bindingStrategy: "PER_SHOT_GROUP",
    strategies: ["PER_SHOT_GROUP", "PER_PARTICIPANT_SHOT"],
    arrangement: "WIDE",
    arrangements: ["WIDE", "GRID", "FEATURE"],
    shotCount: 1,
    maxShots: 4,
    slotRatio: "16:9",
    frameId: "builtin/editorial@1",
  },
  PHOTO_GRID: {
    bindingStrategy: "PER_PARTICIPANT_SHOT",
    strategies: ["PER_SHOT_GROUP", "PER_PARTICIPANT_SHOT"],
    arrangement: "GRID",
    arrangements: ["GRID", "MOSAIC", "MAGAZINE"],
    shotCount: 1,
    maxShots: 8,
    slotRatio: "1:1",
    frameId: "builtin/mosaic@1",
  },
  FREEFORM_COLLAGE: {
    bindingStrategy: "FREEFORM",
    strategies: ["FREEFORM"],
    arrangement: "SCATTER",
    arrangements: ["SCATTER", "MASONRY"],
    shotCount: 4,
    maxShots: 8,
    slotRatio: "3:4",
    frameId: "builtin/scrapbook@1",
  },
};

/** Status DEC-061 untuk ditampilkan/dicatat (bukan keputusan). */
export const DEC_061_STATUS = "OPEN" as const;

export const DEFAULT_STYLE: StudioStyle = { bgColor: "#FFFFFF", gap: 16, cornerRadius: 6, filterPreset: "ASLI" };

/** Ukuran base preset (10 §6). Export: skala seragam `EXPORT_SCALE`. */
export const OUTPUT_PRESET_SIZES: Record<Exclude<OutputPreset, "AUTO" | "CUSTOM">, { w: number; h: number; label: string; exportScale: number }> = {
  STRIP_2X6: { w: 600, h: 1800, label: 'Strip 2×6"', exportScale: 2 },
  POSTCARD_4X6: { w: 1200, h: 1800, label: 'Postcard 4×6"', exportScale: 1 },
  SQUARE: { w: 1600, h: 1600, label: "Square", exportScale: 1 },
  STORY_9_16: { w: 1080, h: 1920, label: "Story 9:16", exportScale: 1 },
};

export const OUTPUT_PRESET_LABEL: Record<OutputPreset, string> = {
  AUTO: "Otomatis",
  STRIP_2X6: 'Strip 2×6"',
  POSTCARD_4X6: 'Postcard 4×6"',
  SQUARE: "Square",
  STORY_9_16: "Story 9:16",
  CUSTOM: "Custom",
};

export const ARRANGEMENT_LABEL: Record<Arrangement, string> = {
  STRIP_VERTICAL: "Strip vertikal",
  STRIP_HORIZONTAL: "Strip horizontal",
  STRIP_ZIGZAG: "Strip zig-zag",
  GRID: "Grid",
  MOSAIC: "Mosaik",
  MAGAZINE: "Majalah",
  FEATURE: "Satu menonjol",
  MASONRY: "Kolase tertata",
  WIDE: "Bidang lebar",
  SCATTER: "Kanvas bebas",
  CUSTOM: "Custom",
};

export const STRATEGY_LABEL: Record<BindingStrategy, string> = {
  PER_SHOT_GROUP: "Foto bareng per shot",
  PER_PARTICIPANT_SHOT: "Foto per orang",
  FREEFORM: "Bebas",
};

export const DEFAULT_COUNTDOWN_SEC = 5;

/** Preset filter grup (05 §12, nilai PROPOSED). String yang sama dipakai CSS (pratinjau) & `ctx.filter` (export). */
export const FILTER_PRESETS: readonly { id: FilterPresetId; label: string; css: string }[] = [
  { id: "ASLI", label: "Asli", css: "none" },
  { id: "HANGAT", label: "Hangat", css: "sepia(.18) saturate(1.12) brightness(1.03)" },
  { id: "SEJUK", label: "Sejuk", css: "saturate(.88) hue-rotate(-6deg) brightness(1.04)" },
  { id: "PUDAR", label: "Pudar", css: "contrast(.88) brightness(1.08) saturate(.82)" },
  { id: "FILM", label: "Film", css: "contrast(1.08) saturate(.9) sepia(.12)" },
  { id: "MONO", label: "Mono", css: "grayscale(1) contrast(1.08) brightness(1.03)" },
];

export function filterCss(id: FilterPresetId | null | undefined): string {
  return FILTER_PRESETS.find((f) => f.id === id)?.css ?? "none";
}
