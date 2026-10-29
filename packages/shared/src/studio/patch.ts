import type { Mode } from "../session";
import { DEFAULT_COUNTDOWN_SEC, DEFAULT_STYLE, FILTER_PRESETS, STUDIO_MODE_DEFAULTS } from "./config";
import { generatePlan, planFromHoles } from "./generate";
import type { PlanInput, QualityWarning, SafeguardViolation } from "./generate";
import { STUDIO_LIMITS } from "./limits";
import { validateLayout } from "./validate";
import { isCountdownChoice } from "../capture";
import {
  ARRANGEMENTS,
  BINDING_STRATEGIES,
  FRAME_ADAPTS,
  OUTPUT_PRESETS,
  SLOT_RATIOS,
  STRUCTURE_FIELDS,
} from "./types";
import type {
  Arrangement,
  ChangeKind,
  FilterPresetId,
  FrameRef,
  FrameTemplate,
  LayoutSpec,
  OutputPreset,
  ParticipantSlot,
  SlotGeometry,
  StudioField,
  StudioPatch,
  StudioState,
  StudioStyle,
  StudioUndo,
} from "./types";

/**
 * Logika studio bersama (P05) sebagai fungsi murni: dipakai server (otoritatif) dan klien (prediksi).
 * LWW per field dengan `baseVersion`; perubahan field berbeda digabung, field sama → penulis terakhir
 * menang dan tercatat di `overwrote`. "Balikin" = satu langkah (nilai sebelum perubahan terakhir).
 */

export type StudioErrorCode = "INVALID_PATCH" | "STRUCTURE_LOCKED" | "FRAME_NOT_FOUND";
export interface StudioError {
  code: StudioErrorCode;
  reason?: string;
  violation?: SafeguardViolation;
}
export type StudioResult = { ok: true; studio: StudioState; warnings: QualityWarning[] } | { ok: false; error: StudioError };

export interface StudioContext {
  mode: Mode;
  participantSlots: ParticipantSlot[];
  by: string;
  nowMs: number;
  changeId: string;
  frameLookup: (frameId: string, source: FrameRef["source"]) => FrameTemplate | undefined;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const fail = (code: StudioErrorCode, reason?: string, violation?: SafeguardViolation): StudioResult => ({ ok: false, error: { code, reason, violation } });

function planParams(mode: Mode, studio: Pick<StudioState, "bindingStrategy" | "style" | "layout">, participantSlots: ParticipantSlot[], override: Partial<PlanInput> = {}): PlanInput {
  const arr = studio.layout.arrangement === "CUSTOM" ? (STUDIO_MODE_DEFAULTS[mode].arrangement as Exclude<Arrangement, "CUSTOM">) : studio.layout.arrangement;
  return {
    mode,
    strategy: studio.bindingStrategy,
    shotCount: studio.layout.shotCount,
    participantSlots,
    arrangement: arr,
    slotRatio: studio.layout.slotRatio,
    output: studio.layout.output.preset === "CUSTOM" && studio.layout.sourceFrameId ? { preset: "AUTO" } : studio.layout.output,
    gap: studio.style.gap,
    cornerRadius: studio.style.cornerRadius,
    ...override,
  };
}

/** Studio awal saat mode terkunci (dipanggil server sekali, DEC-087). */
export function initStudio(mode: Mode, participantSlots: ParticipantSlot[]): StudioState {
  const d = STUDIO_MODE_DEFAULTS[mode];
  const style: StudioStyle = { ...DEFAULT_STYLE };
  const input: PlanInput = {
    mode,
    strategy: d.bindingStrategy,
    shotCount: d.shotCount,
    participantSlots,
    arrangement: d.arrangement as Exclude<Arrangement, "CUSTOM">,
    slotRatio: d.slotRatio,
    output: { preset: "AUTO" },
    gap: style.gap,
    cornerRadius: style.cornerRadius,
  };
  const plan = generatePlan(input);
  if (!plan.ok) throw new Error(`initStudio: ${plan.violation.code}`);
  return {
    version: 1,
    layout: plan.layout,
    bindingStrategy: d.bindingStrategy,
    frame: { frameId: d.frameId, source: "BUILTIN", adapt: "CONTAIN", overlayOpacity: 1 },
    style,
    countdownSec: DEFAULT_COUNTDOWN_SEC,
    participantSlots: [...participantSlots],
    structureLocked: false,
    fieldVersions: {},
    lastChange: null,
    undo: null,
  };
}

/** Validasi bentuk patch (input tak tepercaya). Key tak dikenal → null. */
export function sanitizePatch(raw: unknown): StudioPatch | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  const allowed = new Set(["frame", "bindingStrategy", "arrangement", "shotCount", "slotRatio", "output", "slots", "style", "countdownSec"]);
  if (Object.keys(p).some((k) => !allowed.has(k))) return null;
  const out: StudioPatch = {};
  if (p.frame !== undefined) {
    if (p.frame === null) out.frame = null;
    else {
      const f = p.frame as Record<string, unknown>;
      if (typeof f !== "object" || typeof f.frameId !== "string" || f.frameId.length > 120) return null;
      if (f.source !== "BUILTIN" && f.source !== "CUSTOM") return null;
      if (!FRAME_ADAPTS.includes(f.adapt as FrameRef["adapt"])) return null;
      const opacity = f.overlayOpacity === undefined ? 1 : f.overlayOpacity;
      if (!finite(opacity) || opacity < 0.5 || opacity > 1) return null;
      const ref: FrameRef = { frameId: f.frameId, source: f.source, adapt: f.adapt as FrameRef["adapt"], overlayOpacity: opacity };
      if (f.nineSlice !== undefined) {
        const n = f.nineSlice as Record<string, unknown>;
        if (!n || typeof n !== "object" || ![n.top, n.right, n.bottom, n.left].every((v) => finite(v) && (v as number) >= 0 && (v as number) <= 6000)) return null;
        ref.nineSlice = { top: n.top as number, right: n.right as number, bottom: n.bottom as number, left: n.left as number };
      }
      out.frame = ref;
    }
  }
  if (p.bindingStrategy !== undefined) {
    if (!BINDING_STRATEGIES.includes(p.bindingStrategy as never)) return null;
    out.bindingStrategy = p.bindingStrategy as StudioPatch["bindingStrategy"];
  }
  if (p.arrangement !== undefined) {
    if (!ARRANGEMENTS.includes(p.arrangement as Arrangement) || p.arrangement === "CUSTOM") return null;
    out.arrangement = p.arrangement as StudioPatch["arrangement"];
  }
  if (p.shotCount !== undefined) {
    if (!Number.isInteger(p.shotCount)) return null;
    out.shotCount = p.shotCount as number;
  }
  if (p.slotRatio !== undefined) {
    if (!SLOT_RATIOS.includes(p.slotRatio as never)) return null;
    out.slotRatio = p.slotRatio as StudioPatch["slotRatio"];
  }
  if (p.output !== undefined) {
    const o = p.output as Record<string, unknown>;
    if (!o || typeof o !== "object" || !OUTPUT_PRESETS.includes(o.preset as never)) return null;
    if (o.preset === "CUSTOM") {
      if (!Number.isInteger(o.widthPx) || !Number.isInteger(o.heightPx)) return null;
      out.output = { preset: "CUSTOM", widthPx: o.widthPx as number, heightPx: o.heightPx as number };
    } else out.output = { preset: o.preset as Exclude<OutputPreset, "CUSTOM"> };
  }
  if (p.slots !== undefined) {
    if (!Array.isArray(p.slots) || p.slots.length === 0 || p.slots.length > STUDIO_LIMITS.MAX_CELLS) return null;
    const slots: SlotGeometry[] = [];
    for (const s of p.slots as Record<string, unknown>[]) {
      if (!s || typeof s !== "object" || typeof s.id !== "string" || s.id.length > 32) return null;
      if (![s.x, s.y, s.w, s.h].every(finite) || (s.rotation !== undefined && !finite(s.rotation))) return null;
      slots.push({ id: s.id, x: s.x as number, y: s.y as number, w: s.w as number, h: s.h as number, ...(s.rotation !== undefined ? { rotation: s.rotation as number } : {}) });
    }
    out.slots = slots;
  }
  if (p.countdownSec !== undefined) {
    if (!isCountdownChoice(p.countdownSec)) return null;
    out.countdownSec = p.countdownSec;
  }
  if (p.style !== undefined) {
    const st = p.style as Record<string, unknown>;
    if (!st || typeof st !== "object" || Array.isArray(st)) return null;
    if (Object.keys(st).some((k) => !["bgColor", "gap", "cornerRadius", "filterPreset"].includes(k))) return null;
    const style: Partial<StudioStyle> = {};
    if (st.bgColor !== undefined) {
      if (typeof st.bgColor !== "string" || !HEX.test(st.bgColor)) return null;
      style.bgColor = st.bgColor.toUpperCase();
    }
    if (st.gap !== undefined) {
      if (!finite(st.gap) || st.gap < 0 || st.gap > STUDIO_LIMITS.MAX_GAP_PX) return null;
      style.gap = st.gap;
    }
    if (st.cornerRadius !== undefined) {
      if (!finite(st.cornerRadius) || st.cornerRadius < 0 || st.cornerRadius > STUDIO_LIMITS.MAX_RADIUS_PX) return null;
      style.cornerRadius = st.cornerRadius;
    }
    if (st.filterPreset !== undefined) {
      if (!FILTER_PRESETS.some((f) => f.id === st.filterPreset)) return null;
      style.filterPreset = st.filterPreset as FilterPresetId;
    }
    if (Object.keys(style).length === 0) return null;
    out.style = style;
  }
  return out;
}

export function patchFields(patch: StudioPatch): StudioField[] {
  const f: StudioField[] = [];
  if (patch.frame !== undefined) f.push("frame");
  if (patch.bindingStrategy !== undefined) f.push("bindingStrategy");
  if (patch.arrangement !== undefined) f.push("arrangement");
  if (patch.shotCount !== undefined) f.push("shotCount");
  if (patch.slotRatio !== undefined) f.push("slotRatio");
  if (patch.output !== undefined) f.push("output");
  if (patch.slots !== undefined) f.push("slots");
  for (const k of Object.keys(patch.style ?? {})) f.push(`style.${k}` as StudioField);
  if (patch.countdownSec !== undefined) f.push("countdownSec");
  return f;
}

function changeKind(fields: StudioField[]): ChangeKind {
  if (fields.every((f) => f === "frame")) return "frame";
  if (fields.every((f) => f === "style.filterPreset")) return "filter";
  if (fields.every((f) => f === "countdownSec")) return "timer";
  if (fields.includes("bindingStrategy")) return "strategy";
  if (fields.every((f) => f === "slots")) return "slots";
  if (fields.some((f) => STRUCTURE_FIELDS.includes(f))) return "layout";
  return "style";
}

/** Frame custom FIXED dengan lubang → plan mengikuti lubang. */
function holeFrame(ref: FrameRef | null, ctx: StudioContext): FrameTemplate | null {
  if (!ref || ref.adapt !== "FIXED") return null;
  const t = ctx.frameLookup(ref.frameId, ref.source);
  return t?.slots?.length ? t : null;
}

function bumpVersion(prev: StudioState, next: StudioState, fields: StudioField[], change: StudioState["lastChange"], undo: StudioUndo | null) {
  next.version = prev.version + 1;
  next.fieldVersions = { ...prev.fieldVersions };
  for (const f of fields) next.fieldVersions[f] = next.version;
  next.lastChange = change;
  next.undo = undo;
}

/**
 * Terapkan `studio.update`. `baseVersion` = versi studio yang dilihat pengirim; field yang sudah diubah
 * orang lain sesudahnya tetap ditimpa (LWW) dan dicatat di `overwrote` supaya UI bisa memberi tahu.
 */
export function applyStudioPatch(studio: StudioState, patch: StudioPatch, baseVersion: number | undefined, ctx: StudioContext): StudioResult {
  const fields = patchFields(patch);
  if (fields.length === 0) return fail("INVALID_PATCH", "EMPTY");
  const next: StudioState = structuredClone(studio);
  const holeBefore = studio.layout.sourceFrameId ?? null;

  if (patch.frame !== undefined) {
    if (patch.frame) {
      const t = ctx.frameLookup(patch.frame.frameId, patch.frame.source);
      if (!t) return fail("FRAME_NOT_FOUND");
      if (patch.frame.adapt === "NINE_SLICE") {
        const n = patch.frame.nineSlice ?? t.nineSlice;
        if (!n || n.left + n.right >= t.baseSize.w || n.top + n.bottom >= t.baseSize.h) return fail("INVALID_PATCH", "NINE_SLICE");
        patch = { ...patch, frame: { ...patch.frame, nineSlice: n } };
      }
    }
    next.frame = patch.frame ?? null;
  }
  if (patch.style) next.style = { ...next.style, ...patch.style };
  if (patch.bindingStrategy) next.bindingStrategy = patch.bindingStrategy;
  if (patch.countdownSec !== undefined) next.countdownSec = patch.countdownSec;

  const hole = holeFrame(next.frame, ctx);
  const structural = fields.some((f) => STRUCTURE_FIELDS.includes(f)) || (hole?.id ?? null) !== holeBefore;
  if (studio.structureLocked && structural) return fail("STRUCTURE_LOCKED");

  const regenParams = patch.bindingStrategy || patch.arrangement || patch.shotCount !== undefined || patch.slotRatio || patch.output;
  const geometryStyle = (patch.style?.gap !== undefined || patch.style?.cornerRadius !== undefined) && studio.layout.arrangement !== "CUSTOM";
  if (hole && (regenParams || hole.id !== holeBefore || patch.style?.gap !== undefined)) {
    const r = planFromHoles({
      mode: ctx.mode,
      strategy: next.bindingStrategy,
      shotCount: patch.shotCount ?? next.layout.shotCount,
      participantSlots: ctx.participantSlots,
      slotRatio: patch.slotRatio ?? next.layout.slotRatio,
      gap: next.style.gap,
      cornerRadius: next.style.cornerRadius,
      holes: hole.slots!,
      art: hole.baseSize,
    });
    if (!r.ok) return fail("INVALID_PATCH", "SAFEGUARD", r.violation);
    next.layout = { ...r.layout, sourceFrameId: hole.id };
  } else if (regenParams || geometryStyle || (!hole && holeBefore)) {
    const override: Partial<PlanInput> = {};
    if (patch.arrangement) override.arrangement = patch.arrangement;
    if (patch.shotCount !== undefined) override.shotCount = patch.shotCount;
    if (patch.slotRatio) override.slotRatio = patch.slotRatio;
    if (patch.output) override.output = patch.output;
    const r = generatePlan(planParams(ctx.mode, next, ctx.participantSlots, override));
    if (!r.ok) return fail("INVALID_PATCH", "SAFEGUARD", r.violation);
    next.layout = r.layout;
  } else if (patch.style?.cornerRadius !== undefined) {
    for (const s of next.layout.slots) s.radius = patch.style.cornerRadius;
  }

  if (patch.slots) {
    const byId = new Map(next.layout.slots.map((s) => [s.id, s]));
    for (const g of patch.slots) {
      const s = byId.get(g.id);
      if (!s) return fail("INVALID_PATCH", "SLOT_UNKNOWN");
      const r2 = (n: number) => Math.round(n * 100) / 100;
      s.x = r2(g.x);
      s.y = r2(g.y);
      s.w = r2(g.w);
      s.h = r2(g.h);
      if (g.rotation !== undefined) s.rotation = r2(g.rotation);
    }
    next.layout.arrangement = "CUSTOM";
  }

  const issue = validateLayout(next.layout, next.bindingStrategy, ctx.participantSlots);
  if (issue) return fail("INVALID_PATCH", issue.reason);
  next.participantSlots = [...ctx.participantSlots];

  const overwrote = baseVersion === undefined ? [] : fields.filter((f) => (studio.fieldVersions[f] ?? 0) > baseVersion);
  const prev: StudioUndo["prev"] = {};
  if (patch.frame !== undefined) prev.frame = structuredClone(studio.frame);
  if (patch.style) prev.style = structuredClone(studio.style);
  if (patch.bindingStrategy) prev.bindingStrategy = studio.bindingStrategy;
  if (patch.countdownSec !== undefined) prev.countdownSec = studio.countdownSec;
  if (JSON.stringify(next.layout) !== JSON.stringify(studio.layout)) prev.layout = structuredClone(studio.layout);
  bumpVersion(studio, next, fields, { changeId: ctx.changeId, by: ctx.by, atMs: ctx.nowMs, kind: changeKind(fields), fields, overwrote }, { changeId: ctx.changeId, prev });
  const warnings = generateWarnings(ctx, next);
  return { ok: true, studio: next, warnings };
}

function generateWarnings(ctx: StudioContext, s: StudioState): QualityWarning[] {
  if (s.layout.arrangement === "CUSTOM") return [];
  const r = generatePlan(planParams(ctx.mode, s, ctx.participantSlots));
  return r.ok ? r.warnings : [];
}

/** "Balikin" satu langkah: hanya untuk perubahan TERAKHIR. Revert bisa di-Balikin lagi. */
export function revertStudio(studio: StudioState, changeId: string, ctx: StudioContext): StudioResult {
  const undo = studio.undo;
  if (!undo || undo.changeId !== changeId || studio.lastChange?.changeId !== changeId) return fail("INVALID_PATCH", "STALE_UNDO");
  if (studio.structureLocked && (undo.prev.layout || undo.prev.bindingStrategy)) return fail("STRUCTURE_LOCKED");
  const next: StudioState = structuredClone(studio);
  const prev: StudioUndo["prev"] = {};
  if (undo.prev.frame !== undefined) {
    prev.frame = structuredClone(studio.frame);
    next.frame = structuredClone(undo.prev.frame) ?? null;
  }
  if (undo.prev.style) {
    prev.style = structuredClone(studio.style);
    next.style = structuredClone(undo.prev.style);
  }
  if (undo.prev.countdownSec !== undefined) {
    prev.countdownSec = studio.countdownSec;
    next.countdownSec = undo.prev.countdownSec;
  }
  if (undo.prev.bindingStrategy) {
    prev.bindingStrategy = studio.bindingStrategy;
    next.bindingStrategy = undo.prev.bindingStrategy;
  }
  if (undo.prev.layout) {
    prev.layout = structuredClone(studio.layout);
    next.layout = structuredClone(undo.prev.layout);
  }
  if (validateLayout(next.layout, next.bindingStrategy, ctx.participantSlots)) return fail("INVALID_PATCH", "STALE_UNDO");
  const fields = studio.lastChange!.fields;
  bumpVersion(
    studio,
    next,
    fields,
    { changeId: ctx.changeId, by: ctx.by, atMs: ctx.nowMs, kind: "revert", fields, overwrote: [], revertOf: changeId },
    { changeId: ctx.changeId, prev },
  );
  return { ok: true, studio: next, warnings: [] };
}

/**
 * Peserta berubah saat STUDIO sebelum shot 1 (07 §7.2): BindingPlan dibangkitkan ulang sesuai strategi
 * aktif. Setelah struktur terkunci → null (plan tetap; P06 menangani peserta yang tidak ada).
 */
export function regenerateForParticipants(studio: StudioState, mode: Mode, participantSlots: ParticipantSlot[], frameLookup: StudioContext["frameLookup"]): StudioState | null {
  if (studio.structureLocked || participantSlots.length === 0) return null;
  if (JSON.stringify(studio.participantSlots) === JSON.stringify(participantSlots)) return null;
  const next: StudioState = structuredClone(studio);
  const hole = studio.layout.sourceFrameId && next.frame ? frameLookup(next.frame.frameId, next.frame.source) : undefined;
  let layout: LayoutSpec | null = null;
  if (hole?.slots?.length) {
    const r = planFromHoles({
      mode,
      strategy: next.bindingStrategy,
      shotCount: next.layout.shotCount,
      participantSlots,
      slotRatio: next.layout.slotRatio,
      gap: next.style.gap,
      cornerRadius: next.style.cornerRadius,
      holes: hole.slots,
      art: hole.baseSize,
    });
    if (r.ok) layout = { ...r.layout, sourceFrameId: hole.id };
  }
  if (!layout) {
    const r = generatePlan(planParams(mode, next, participantSlots));
    if (r.ok) layout = r.layout;
  }
  if (!layout) {
    // Kombinasi lama tidak valid lagi: kembali ke default mode (tercatat sebagai perubahan sistem).
    const d = STUDIO_MODE_DEFAULTS[mode];
    next.bindingStrategy = d.bindingStrategy;
    const r = generatePlan(planParams(mode, { ...next, layout: { ...next.layout, arrangement: d.arrangement, shotCount: d.shotCount } }, participantSlots));
    if (!r.ok) return null;
    layout = r.layout;
  }
  next.layout = layout;
  next.participantSlots = [...participantSlots];
  next.version = studio.version + 1;
  next.fieldVersions = { ...studio.fieldVersions, slots: next.version };
  // Nilai "Balikin" sebelumnya merujuk plan peserta lama → tidak berlaku lagi.
  next.undo = null;
  return next;
}

/** Kunci struktur setelah shot pertama (DEC-065). Dipanggil P06. */
export function lockStudioStructure(studio: StudioState): StudioState {
  return studio.structureLocked ? studio : { ...structuredClone(studio), structureLocked: true, version: studio.version + 1 };
}

/** Studio yang dikirim ke klien: tanpa nilai undo internal. */
export function publicStudio(studio: StudioState | null): StudioState | null {
  if (!studio) return null;
  const { undo, ...rest } = studio;
  void undo;
  return { ...rest, undo: null };
}
