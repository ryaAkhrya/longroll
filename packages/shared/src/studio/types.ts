import type { Mode } from "../session";

/** 14 §6.1 — slot peserta stabil (warna P1..P4), bukan participantId. */
export type ParticipantSlot = "P1" | "P2" | "P3" | "P4";
export const PARTICIPANT_SLOTS: readonly ParticipantSlot[] = ["P1", "P2", "P3", "P4"];

/** DEC-087. Strategi default per mode = OPEN (DEC-061). */
export type BindingStrategy = "PER_SHOT_GROUP" | "PER_PARTICIPANT_SHOT" | "FREEFORM";
export const BINDING_STRATEGIES: readonly BindingStrategy[] = ["PER_SHOT_GROUP", "PER_PARTICIPANT_SHOT", "FREEFORM"];

export type GroupArrangement = "ROW" | "COLUMN" | "GRID" | "BLEND";

export type SlotBinding =
  | { kind: "CELL"; shotIndex: number; participantSlot: ParticipantSlot }
  | { kind: "SHOT_GROUP"; shotIndex: number; arrangement: GroupArrangement }
  /** Collage: item bebas. `cell` hanya petunjuk feed mana yang ditampilkan di pratinjau studio. */
  | { kind: "FREE"; cell?: { shotIndex: number; participantSlot: ParticipantSlot } };

export interface LayoutSlot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  radius: number;
  z: number;
  fit: "cover";
  focal?: { x: number; y: number };
  binding: SlotBinding;
}

/** Susunan (SCR-11). CUSTOM = slot diedit manual / diambil dari lubang frame. */
export type Arrangement = "STRIP_VERTICAL" | "STRIP_HORIZONTAL" | "GRID" | "MOSAIC" | "WIDE" | "SCATTER" | "CUSTOM";
export const ARRANGEMENTS: readonly Arrangement[] = ["STRIP_VERTICAL", "STRIP_HORIZONTAL", "GRID", "MOSAIC", "WIDE", "SCATTER", "CUSTOM"];

export type SlotRatio = "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
export const SLOT_RATIOS: readonly SlotRatio[] = ["1:1", "4:3", "3:4", "16:9", "9:16"];

/** Preset output (10 §6). AUTO = ukuran mengikuti isi plan (plan besar otomatis lebih panjang). */
export type OutputPreset = "AUTO" | "STRIP_2X6" | "POSTCARD_4X6" | "SQUARE" | "STORY_9_16" | "CUSTOM";
export const OUTPUT_PRESETS: readonly OutputPreset[] = ["AUTO", "STRIP_2X6", "POSTCARD_4X6", "SQUARE", "STORY_9_16", "CUSTOM"];

export interface OutputSpec {
  preset: OutputPreset;
  /** Hanya untuk CUSTOM (base px, 600..8192). */
  widthPx?: number;
  heightPx?: number;
}

export interface LayoutSpec {
  canvas: { preset: OutputPreset; widthPx: number; heightPx: number };
  shotCount: number;
  arrangement: Arrangement;
  slotRatio: SlotRatio;
  output: OutputSpec;
  slots: LayoutSlot[];
  /** Plan diambil dari lubang frame custom (adaptasi FIXED). */
  sourceFrameId?: string;
}

export type FrameAdapt = "FIXED" | "CONTAIN" | "COVER" | "NINE_SLICE" | "PATTERN";
export const FRAME_ADAPTS: readonly FrameAdapt[] = ["FIXED", "CONTAIN", "COVER", "NINE_SLICE", "PATTERN"];

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FrameRef {
  frameId: string;
  source: "BUILTIN" | "CUSTOM";
  adapt: FrameAdapt;
  nineSlice?: Insets;
  /** Opacity overlay 0.5–1 (10 §11). */
  overlayOpacity: number;
}

export type FilterPresetId = "ASLI" | "HANGAT" | "SEJUK" | "PUDAR" | "FILM" | "MONO";

export interface StudioStyle {
  bgColor: string;
  gap: number;
  cornerRadius: number;
  filterPreset: FilterPresetId;
}

/** Field yang dilacak versi & konfliknya (LWW per field). */
export type StudioField =
  | "frame"
  | "bindingStrategy"
  | "arrangement"
  | "shotCount"
  | "slotRatio"
  | "output"
  | "slots"
  | "style.bgColor"
  | "style.gap"
  | "style.cornerRadius"
  | "style.filterPreset"
  | "countdownSec";

/** Struktur dikunci setelah shot pertama (DEC-065). */
export const STRUCTURE_FIELDS: readonly StudioField[] = ["bindingStrategy", "arrangement", "shotCount", "slotRatio", "output", "slots"];

export type ChangeKind = "frame" | "layout" | "strategy" | "filter" | "style" | "slots" | "timer" | "revert";

export interface StudioChange {
  changeId: string;
  by: string;
  atMs: number;
  kind: ChangeKind;
  fields: StudioField[];
  /** Field yang ditimpa padahal diubah orang lain setelah baseVersion pengirim (LWW). */
  overwrote: StudioField[];
  revertOf?: string;
}

/** Nilai sebelum perubahan terakhir (Balikin satu langkah). Disimpan di server, tidak dikirim ke klien. */
export interface StudioUndo {
  changeId: string;
  prev: Partial<Pick<StudioState, "layout" | "bindingStrategy" | "frame" | "style" | "countdownSec">>;
}

export interface StudioState {
  version: number;
  layout: LayoutSpec;
  bindingStrategy: BindingStrategy;
  frame: FrameRef | null;
  style: StudioStyle;
  countdownSec: number;
  /** Slot peserta yang dipakai generator (peserta wajib per shot). */
  participantSlots: ParticipantSlot[];
  /** DEC-065: true setelah shot pertama (dipicu P06). */
  structureLocked: boolean;
  fieldVersions: Partial<Record<StudioField, number>>;
  lastChange: StudioChange | null;
  undo?: StudioUndo | null;
}

/** Perubahan slot manual (drag/resize). */
export interface SlotGeometry {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation?: number;
}

/** `studio.update` (14 §6). Hanya field yang berubah dikirim. */
export interface StudioPatch {
  frame?: FrameRef | null;
  bindingStrategy?: BindingStrategy;
  arrangement?: Exclude<Arrangement, "CUSTOM">;
  shotCount?: number;
  slotRatio?: SlotRatio;
  output?: OutputSpec;
  slots?: SlotGeometry[];
  style?: Partial<StudioStyle>;
  /** Timer countdown bersama 3/5/10 detik (DEC-027). */
  countdownSec?: number;
}

export type FrameCategory = "KOREAN" | "MINIMAL" | "RETRO" | "SCRAPBOOK" | "PASTEL" | "GRID" | "CUSTOM";

export type Fill =
  | { kind: "solid"; color: string }
  | { kind: "linear"; from: string; to: string; angle: number }
  | { kind: "dots"; bg: string; bgTo?: string; dot: string; spacing: number; radius: number }
  | { kind: "paper"; bg: string; fleck: string; spacing: number };

export type DecorSpec =
  | { type: "date"; format: "YYYY.MM.DD"; anchor: "bottom-right" | "bottom-left" | "bottom-center"; color: string; font: "mono" | "serif" | "display"; size: number }
  | { type: "mark"; anchor: "bottom-left" | "bottom-center"; color: string }
  | { type: "text"; text: string; anchor: "bottom-left" | "bottom-center"; color: string; font: "mono" | "serif" | "display"; size: number; italic?: boolean }
  | { type: "names"; anchor: "bottom-left" | "bottom-center"; color: string; size: number }
  | { type: "sprockets"; color: string }
  | { type: "frameNumbers"; color: string }
  | { type: "tape"; color: string };

export interface SlotStyle {
  stroke?: string;
  strokeWidth?: number;
  /** Polaroid: bingkai putih tebal di bawah foto. */
  polaroid?: boolean;
  /** Rotasi acak terkendali (derajat) per slot, deterministik. */
  tilt?: number;
  shadow?: boolean;
  /** Radius minimum slot (base px pada lebar 600). */
  radius?: number;
}

export type AssetRef = { kind: "custom"; frameId: string; width: number; height: number };

export interface HoleRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 10 §8. Frame bawaan bersifat parametrik (menyesuaikan plan), frame custom berupa artwork beralpha. */
export interface FrameTemplate {
  id: string;
  name: string;
  category: FrameCategory;
  modes: Mode[];
  baseSize: { w: number; h: number };
  adapt: FrameAdapt;
  nineSlice?: Insets;
  /** Lubang foto (base px artwork). */
  slots?: HoleRect[];
  layers: { background?: Fill; overlay?: AssetRef; decor?: DecorSpec[] };
  slotStyle?: SlotStyle;
  /** Ruang tepi tambahan yang dibutuhkan dekor (fraksi lebar kanvas). */
  margin?: { side: number; footer: number };
  palette: { bg: string; ink: string };
  license: { source: string; attribution?: string };
  version: number;
  /** Frame custom: pengunggah & nama file (dirender sebagai teks). */
  uploadedBy?: string;
  fileName?: string;
}

/** Ringkasan frame custom di RoomView (tanpa URL; URL bertanda tangan diminta terpisah). */
export interface CustomFrameView {
  frameId: string;
  template: FrameTemplate;
  createdAtMs: number;
}
