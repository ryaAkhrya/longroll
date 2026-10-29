import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import * as Y from "yjs";
import { acceptedForCell } from "../capture";
import type { CaptureState } from "../capture";
import { buildScene } from "../studio/scene";
import { builtinFrame } from "../studio/frames";
import type { FilterPresetId, FrameRef, FrameTemplate, StudioState } from "../studio/types";
import { EDITOR_LIMITS, STICKER_IDS, TYPE_KEYS } from "./schema";
import type { CropRect, EditorMeta, ElementSnapshot, ElementType, HistoryEntry, TextAlign, TextFontStyle } from "./schema";

/**
 * Operasi dokumen Yjs (11 §2–§7). Semua mutasi lokal = SATU transaksi dengan `origin` peserta
 * (supaya UndoManager hanya membatalkan operasi sendiri) dan menulis `HistoryEntry` bersama di
 * transaksi yang sama. Posisi transient saat drag TIDAK lewat dokumen (awareness).
 */

export class EditorError extends Error {
  constructor(readonly code: "FULL" | "NOT_FOUND" | "INVALID" | "READ_ONLY") {
    super(code);
    this.name = "EditorError";
  }
}

/** clientID tetap untuk seed deterministik → seed ganda (restart/balapan) bergabung tanpa duplikasi. */
export const SEED_CLIENT_ID = 0x5eed1234;
export const SEED_ORIGIN = { seed: true };

export interface EditorCtx {
  participantId: string;
  name: string;
  /** Identitas transaksi lokal (objek unik per klien) untuk UndoManager. */
  origin: object;
  now?: () => number;
}

const nowOf = (c: EditorCtx) => (c.now ? c.now() : Date.now());
export const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-3)}`;

// ---------------------------------------------------------------- akses dasar

export function createEditorDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap("meta");
  doc.getMap("elements");
  doc.getArray("history");
  return doc;
}

export const metaMap = (doc: Y.Doc) => doc.getMap<unknown>("meta");
export const elementsMap = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("elements");
export const historyArray = (doc: Y.Doc) => doc.getArray<HistoryEntry>("history");

export function readElement(el: Y.Map<unknown>): ElementSnapshot {
  const out: ElementSnapshot = {};
  el.forEach((v, k) => {
    out[k] = v instanceof Y.Text ? v.toString() : v;
  });
  return out;
}

export interface ElementView extends ElementSnapshot {
  id: string;
  type: ElementType;
  z: string;
}

/** Urutan render: z lalu elementId (11 §2). */
export function listElements(doc: Y.Doc): ElementView[] {
  const out: ElementView[] = [];
  elementsMap(doc).forEach((el, id) => out.push({ ...readElement(el), id } as ElementView));
  return out.sort((a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1));
}

export function readMeta(doc: Y.Doc): EditorMeta | null {
  const m = metaMap(doc);
  const canvas = m.get("canvas") as EditorMeta["canvas"] | undefined;
  if (!canvas) return null;
  return {
    canvas,
    frame: (m.get("frame") as string | null | undefined) ?? null,
    frameStyle: (m.get("frameStyle") as EditorMeta["frameStyle"] | undefined) ?? { bgColor: "#FFFFFF", overlayOpacity: 1 },
    globalFilter: (m.get("globalFilter") as FilterPresetId | null | undefined) ?? null,
    schemaVersion: 1,
  };
}

export function readHistory(doc: Y.Doc): HistoryEntry[] {
  return historyArray(doc).toArray();
}

export function elementLabel(s: ElementSnapshot, names?: (pid: string) => string): string {
  switch (s.type) {
    case "photo":
      return `Foto ${String(s.ownerName ?? "")}`.trim();
    case "sticker":
      return `Stiker ${String(s.assetId ?? "")}`;
    case "text":
      return `Teks "${String(s.content ?? "").slice(0, 24)}"`;
    case "doodle":
      return "Coretan";
    default:
      return names ? names(String(s.createdBy ?? "")) : "Elemen";
  }
}

// ---------------------------------------------------------------- z (fractional index)

export function topZ(doc: Y.Doc): string {
  const last = listElements(doc).at(-1);
  return generateKeyBetween(last?.z ?? null, null);
}
export function bottomZ(doc: Y.Doc): string {
  const first = listElements(doc)[0];
  return generateKeyBetween(null, first?.z ?? null);
}

// ---------------------------------------------------------------- riwayat

function pushHistory(doc: Y.Doc, ctx: EditorCtx, e: Omit<HistoryEntry, "id" | "at" | "by">) {
  const arr = historyArray(doc);
  const at = nowOf(ctx);
  const last = arr.length ? arr.get(arr.length - 1) : null;
  // Digabung per elemen per peserta dalam 2 detik (11 §7.2): before dari entri awal, after dari yang terbaru.
  if (last && e.elementId && last.elementId === e.elementId && last.by === ctx.participantId && !e.revertOf && !last.revertOf && at - last.at < EDITOR_LIMITS.historyMergeMs && last.after && e.after && last.before !== null) {
    arr.delete(arr.length - 1, 1);
    arr.push([{ ...last, at, after: { ...last.after, ...e.after }, label: e.label }]);
    return;
  }
  arr.push([{ id: newId("h"), at, by: ctx.participantId, ...e }]);
  if (arr.length > EDITOR_LIMITS.maxHistory) arr.delete(0, arr.length - EDITOR_LIMITS.maxHistory);
}

function snap(el: Y.Map<unknown>, keys?: string[]): ElementSnapshot {
  const all = readElement(el);
  if (!keys) return all;
  const out: ElementSnapshot = {};
  for (const k of keys) out[k] = all[k] ?? null;
  return out;
}

/** Pangkas riwayat bersama ke batas FIFO (dipakai server setelah menggabungkan update bersamaan). */
export function trimHistory(doc: Y.Doc, origin: unknown = "server"): boolean {
  const arr = historyArray(doc);
  if (arr.length <= EDITOR_LIMITS.maxHistory) return false;
  doc.transact(() => arr.delete(0, arr.length - EDITOR_LIMITS.maxHistory), origin);
  return true;
}

// ---------------------------------------------------------------- pembuatan elemen

function baseProps(ctx: EditorCtx, type: ElementType, x: number, y: number, z: string): Record<string, unknown> {
  return { type, x, y, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, z, hidden: false, createdBy: ctx.participantId, updatedBy: ctx.participantId };
}

function create(doc: Y.Doc, ctx: EditorCtx, id: string, props: Record<string, unknown>, text: string | null, label: string) {
  if (elementsMap(doc).size >= EDITOR_LIMITS.maxElements) throw new EditorError("FULL");
  const el = new Y.Map<unknown>();
  for (const [k, v] of Object.entries(props)) el.set(k, v);
  if (text !== null) el.set("content", new Y.Text(text));
  elementsMap(doc).set(id, el);
  pushHistory(doc, ctx, { label, elementId: id, before: null, after: readElement(el) });
}

export function addSticker(doc: Y.Doc, ctx: EditorCtx, assetId: string, at: { x: number; y: number }, size = 160, tint?: string): string {
  if (!STICKER_IDS.has(assetId)) throw new EditorError("INVALID");
  const id = newId("stk");
  doc.transact(() => {
    create(doc, ctx, id, { ...baseProps(ctx, "sticker", at.x, at.y, topZ(doc)), assetId, w: size, h: size, ...(tint ? { tint } : {}) }, null, `nempel ${assetId}`);
  }, ctx.origin);
  return id;
}

export function addText(doc: Y.Doc, ctx: EditorCtx, at: { x: number; y: number }, content = "teks", style: TextFontStyle = "display", color = "#1B1720", fontSize = 64): string {
  const id = newId("txt");
  doc.transact(() => {
    create(doc, ctx, id, { ...baseProps(ctx, "text", at.x, at.y, topZ(doc)), fontStyle: style, color, fontSize, align: "center" }, content, `teks "${content.slice(0, 20)}"`);
  }, ctx.origin);
  return id;
}

export function addDoodle(doc: Y.Doc, ctx: EditorCtx, points: string, color: string, width: number, bounds: { x: number; y: number }): string {
  const id = newId("dd");
  doc.transact(() => {
    create(doc, ctx, id, { ...baseProps(ctx, "doodle", bounds.x, bounds.y, topZ(doc)), points, color, width }, null, `coretan ${color}`);
  }, ctx.origin);
  return id;
}

// ---------------------------------------------------------------- perubahan properti

export interface Patch {
  [key: string]: unknown;
}

/** Terapkan patch properti (bukan teks) sebagai SATU transaksi + entri riwayat. Tanpa perubahan nyata → no-op. */
export function updateElement(doc: Y.Doc, ctx: EditorCtx, id: string, patch: Patch, label: string): boolean {
  const el = elementsMap(doc).get(id);
  if (!el) throw new EditorError("NOT_FOUND");
  const type = el.get("type") as ElementType;
  const allowed = new Set<string>([...TYPE_KEYS[type], "x", "y", "scaleX", "scaleY", "rotation", "opacity", "z", "hidden"]);
  const keys = Object.keys(patch).filter((k) => allowed.has(k) && JSON.stringify(el.get(k)) !== JSON.stringify(patch[k]));
  if (!keys.length) return false;
  doc.transact(() => {
    const before = snap(el, keys);
    for (const k of keys) el.set(k, patch[k]);
    el.set("updatedBy", ctx.participantId);
    pushHistory(doc, ctx, { label, elementId: id, before, after: Object.fromEntries(keys.map((k) => [k, patch[k]])) });
  }, ctx.origin);
  return true;
}

export const commitTransform = (doc: Y.Doc, ctx: EditorCtx, id: string, t: { x: number; y: number; scaleX: number; scaleY: number; rotation: number }) =>
  updateElement(doc, ctx, id, t, "geser / ubah ukuran");

export const setCrop = (doc: Y.Doc, ctx: EditorCtx, id: string, crop: CropRect, zoom: number) => updateElement(doc, ctx, id, { crop, zoom }, "crop foto");
export const setPhotoFilter = (doc: Y.Doc, ctx: EditorCtx, id: string, filter: FilterPresetId | null) => updateElement(doc, ctx, id, { filter }, "filter foto");

export function setZ(doc: Y.Doc, ctx: EditorCtx, id: string, mode: "front" | "back" | "up" | "down" | { steps: number }): boolean {
  const list = listElements(doc);
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) throw new EditorError("NOT_FOUND");
  let z: string;
  const others = list.filter((e) => e.id !== id);
  const steps = typeof mode === "object" ? mode.steps : mode === "up" ? 1 : mode === "down" ? -1 : 0;
  if (mode === "front") z = generateKeyBetween(others.at(-1)?.z ?? null, null);
  else if (mode === "back") z = generateKeyBetween(null, others[0]?.z ?? null);
  else {
    const target = Math.max(0, Math.min(others.length, i + steps));
    z = generateKeyBetween(others[target - 1]?.z ?? null, others[target]?.z ?? null);
  }
  return updateElement(doc, ctx, id, { z }, "ubah urutan layer");
}

export const setHidden = (doc: Y.Doc, ctx: EditorCtx, id: string, hidden: boolean) => updateElement(doc, ctx, id, { hidden }, hidden ? "sembunyikan" : "tampilkan");

export function deleteElement(doc: Y.Doc, ctx: EditorCtx, id: string, label?: string): boolean {
  const el = elementsMap(doc).get(id);
  if (!el) return false;
  doc.transact(() => {
    const before = readElement(el);
    elementsMap(doc).delete(id);
    pushHistory(doc, ctx, { label: label ?? `hapus ${elementLabel(before)}`, elementId: id, before, after: null });
  }, ctx.origin);
  return true;
}

export function duplicateElement(doc: Y.Doc, ctx: EditorCtx, id: string): string | null {
  const el = elementsMap(doc).get(id);
  if (!el) return null;
  const s = readElement(el);
  if (s.type === "photo") return null; // foto asli tidak digandakan (sumber terlindungi)
  const nid = newId("dup");
  const { content, ...rest } = s;
  doc.transact(() => {
    create(doc, ctx, nid, { ...rest, x: Number(s.x) + 40, y: Number(s.y) + 40, z: topZ(doc), createdBy: ctx.participantId, updatedBy: ctx.participantId }, s.type === "text" ? String(content ?? "") : null, `duplikat ${elementLabel(s)}`);
  }, ctx.origin);
  return nid;
}

/** Edit teks via Y.Text: diff awalan/akhiran saja → edit bersamaan digabung CRDT (11 §5). */
export function editText(doc: Y.Doc, ctx: EditorCtx, id: string, next: string): boolean {
  const el = elementsMap(doc).get(id);
  const t = el?.get("content");
  if (!el || !(t instanceof Y.Text)) throw new EditorError("NOT_FOUND");
  const cur = t.toString();
  if (cur === next) return false;
  if (next.length > EDITOR_LIMITS.maxTextLength) throw new EditorError("INVALID");
  let p = 0;
  while (p < cur.length && p < next.length && cur[p] === next[p]) p++;
  let s = 0;
  while (s < cur.length - p && s < next.length - p && cur[cur.length - 1 - s] === next[next.length - 1 - s]) s++;
  doc.transact(() => {
    if (cur.length - p - s > 0) t.delete(p, cur.length - p - s);
    const ins = next.slice(p, next.length - s);
    if (ins) t.insert(p, ins);
    el.set("updatedBy", ctx.participantId);
    pushHistory(doc, ctx, { label: `teks "${next.slice(0, 20)}"`, elementId: id, before: { content: cur }, after: { content: next } });
  }, ctx.origin);
  return true;
}

// ---------------------------------------------------------------- meta (frame / filter global)

export function setFrame(doc: Y.Doc, ctx: EditorCtx, frame: FrameRef | null, name: string): boolean {
  const value = frame ? JSON.stringify(frame) : null;
  const m = metaMap(doc);
  if ((m.get("frame") ?? null) === value) return false;
  doc.transact(() => {
    const before = (m.get("frame") as string | null | undefined) ?? null;
    m.set("frame", value);
    pushHistory(doc, ctx, { label: `ganti frame ke ${name}`, elementId: null, metaKey: "frame", before: { frame: before }, after: { frame: value } });
  }, ctx.origin);
  return true;
}

export function setGlobalFilter(doc: Y.Doc, ctx: EditorCtx, filter: FilterPresetId | null): boolean {
  const m = metaMap(doc);
  if ((m.get("globalFilter") ?? null) === filter) return false;
  doc.transact(() => {
    const before = (m.get("globalFilter") as FilterPresetId | null | undefined) ?? null;
    m.set("globalFilter", filter);
    pushHistory(doc, ctx, { label: `filter semua foto: ${filter ?? "asli"}`, elementId: null, metaKey: "globalFilter", before: { globalFilter: before }, after: { globalFilter: filter } });
  }, ctx.origin);
  return true;
}

// ---------------------------------------------------------------- Balikin (11 §7.2)

export type RevertResult = { ok: true } | { ok: false; reason: "NOT_FOUND" | "CHANGED"; changedBy?: string };

/**
 * Balikin entri E oleh siapa pun. Bila state sekarang == E.after → terapkan E.before. Bila sudah diubah lagi
 * → `CHANGED` (UI meminta konfirmasi) kecuali `force`. Selalu menambah entri baru; riwayat tidak dihapus.
 */
export function revertEntry(doc: Y.Doc, ctx: EditorCtx, entryId: string, force = false): RevertResult {
  const entry = readHistory(doc).find((h) => h.id === entryId);
  if (!entry) return { ok: false, reason: "NOT_FOUND" };
  const label = `balikin "${entry.label}"`;

  if (entry.metaKey) {
    const m = metaMap(doc);
    const key = entry.metaKey;
    if (!force && JSON.stringify(m.get(key) ?? null) !== JSON.stringify(entry.after?.[key] ?? null)) return { ok: false, reason: "CHANGED" };
    doc.transact(() => {
      const cur = m.get(key) ?? null;
      const restore = entry.before?.[key] ?? null;
      m.set(key, restore);
      pushHistory(doc, ctx, { label, elementId: null, metaKey: key, before: { [key]: cur }, after: { [key]: restore }, revertOf: entry.id });
    }, ctx.origin);
    return { ok: true };
  }

  const id = entry.elementId;
  if (!id) return { ok: false, reason: "NOT_FOUND" };
  const el = elementsMap(doc).get(id);

  if (entry.before === null) {
    // Elemen dibuat → balikin = hapus.
    if (!el) return { ok: true };
    const cur = readElement(el);
    doc.transact(() => {
      elementsMap(doc).delete(id);
      pushHistory(doc, ctx, { label, elementId: id, before: cur, after: null, revertOf: entry.id });
    }, ctx.origin);
    return { ok: true };
  }
  if (entry.after === null) {
    // Elemen dihapus → pulihkan dari snapshot `before`.
    if (el) return { ok: true };
    doc.transact(() => {
      const { content, ...rest } = entry.before!;
      if (elementsMap(doc).size >= EDITOR_LIMITS.maxElements) throw new EditorError("FULL");
      const n = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(rest)) n.set(k, v);
      if (rest.type === "text") n.set("content", new Y.Text(String(content ?? "")));
      elementsMap(doc).set(id, n);
      pushHistory(doc, ctx, { label, elementId: id, before: null, after: readElement(n), revertOf: entry.id });
    }, ctx.origin);
    return { ok: true };
  }
  if (!el) return { ok: false, reason: "NOT_FOUND" };
  const keys = Object.keys(entry.after);
  const cur = snap(el, keys);
  if (!force && JSON.stringify(cur) !== JSON.stringify(Object.fromEntries(keys.map((k) => [k, entry.after![k] ?? null])))) {
    return { ok: false, reason: "CHANGED", changedBy: String(el.get("updatedBy") ?? "") };
  }
  doc.transact(() => {
    for (const k of keys) {
      const v = entry.before![k] ?? null;
      if (k === "content") {
        const t = el.get("content");
        if (t instanceof Y.Text) {
          t.delete(0, t.length);
          t.insert(0, String(v ?? ""));
        }
      } else el.set(k, v);
    }
    el.set("updatedBy", ctx.participantId);
    pushHistory(doc, ctx, { label, elementId: id, before: cur, after: Object.fromEntries(keys.map((k) => [k, entry.before![k] ?? null])), revertOf: entry.id });
  }, ctx.origin);
  return { ok: true };
}

// ---------------------------------------------------------------- undo pribadi (DEC-032)

/** Undo/redo hanya transaksi dengan origin ini (milik peserta sendiri), walau ada perubahan orang lain di antaranya. */
export function createUndo(doc: Y.Doc, origin: object): Y.UndoManager {
  const um = new Y.UndoManager([elementsMap(doc), metaMap(doc)], { trackedOrigins: new Set([origin]), captureTimeout: EDITOR_LIMITS.undoCaptureMs });
  um.on("stack-item-added", () => {
    while (um.undoStack.length > EDITOR_LIMITS.undoStack) um.undoStack.shift();
  });
  return um;
}

// ---------------------------------------------------------------- doodle encode/decode + RDP

export type Pt = [number, number];

/** "x0,y0;dx,dy;..." dalam persepuluhan px, delta-encoded (kompak, immutable setelah stroke selesai). */
export function encodePoints(points: Pt[]): string {
  let px = 0;
  let py = 0;
  return points
    .map(([x, y], i) => {
      const ix = Math.round(x * 10);
      const iy = Math.round(y * 10);
      const s = i === 0 ? `${ix},${iy}` : `${ix - px},${iy - py}`;
      px = ix;
      py = iy;
      return s;
    })
    .join(";");
}

export function decodePoints(s: string): Pt[] | null {
  if (!s) return [];
  const out: Pt[] = [];
  let x = 0;
  let y = 0;
  for (const [i, part] of s.split(";").entries()) {
    const m = /^(-?\d+),(-?\d+)$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    x = i === 0 ? a : x + a;
    y = i === 0 ? b : y + b;
    out.push([x / 10, y / 10]);
  }
  return out;
}

/** Ramer–Douglas–Peucker; hasil dipangkas ≤ maxPoints (epsilon dinaikkan bertahap). */
export function simplifyRdp(points: Pt[], eps: number = EDITOR_LIMITS.doodleSimplifyEps, maxPoints: number = EDITOR_LIMITS.maxDoodlePoints): Pt[] {
  const run = (pts: Pt[], e: number): Pt[] => {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack: [number, number][] = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      let max = 0;
      let idx = -1;
      const [ax, ay] = pts[a]!;
      const [bx, by] = pts[b]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1e-9;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = pts[i]!;
        const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
        if (d > max) {
          max = d;
          idx = i;
        }
      }
      if (max > e && idx > 0) {
        keep[idx] = 1;
        stack.push([a, idx], [idx, b]);
      }
    }
    return pts.filter((_, i) => keep[i]);
  };
  let e = eps;
  let out = run(points, e);
  while (out.length > maxPoints) {
    e *= 1.5;
    out = run(points, e);
  }
  return out;
}

// ---------------------------------------------------------------- seed (11 §13)

export interface SeedInput {
  studio: StudioState;
  capture: CaptureState;
  /** participantId → nama saat capture. */
  names: Record<string, string>;
  /** Dimensi sumber foto accepted per attemptId. */
  srcDims: (attemptId: string) => { w: number; h: number } | null;
  frameTemplate?: FrameTemplate | null;
}

const rot = (dx: number, dy: number, deg: number): [number, number] => {
  const r = (deg * Math.PI) / 180;
  return [dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r)];
};

function coverCrop(srcW: number, srcH: number, boxW: number, boxH: number, focalY = 0.35): CropRect {
  const sr = srcW / srcH;
  const br = boxW / boxH;
  if (sr > br) {
    const w = br / sr;
    return { x: (1 - w) / 2, y: 0, w, h: 1 };
  }
  const h = sr / br;
  return { x: 0, y: Math.max(0, Math.min(1 - h, focalY - h / 2)), w: 1, h };
}

/**
 * Seed elemen `photo` dari foto accepted + BindingPlan terkunci (DEC-087), tanpa bergantung pada
 * jawaban DEC-061: CELL → 1 foto di slot; SHOT_GROUP → 1 foto per peserta pada sub-tile susunan grup;
 * FREE → 1 foto per cell accepted. `meta` disalin dari studio. Deterministik (id `photo:{attemptId}`).
 */
export function seedDocument(doc: Y.Doc, input: SeedInput): void {
  const { studio, capture } = input;
  const template = input.frameTemplate ?? (studio.frame?.source === "BUILTIN" ? builtinFrame(studio.frame.frameId) : null) ?? null;
  const scene = buildScene(studio, template, { names: [], dateText: "" });
  const slotOwner = (shotIndex: number, slot: string): [string, string] | null => {
    const shot = capture.shots[shotIndex];
    if (!shot) return null;
    for (const [pid, s] of Object.entries(shot.slotOf)) if (s === slot) return [pid, shot.perParticipant[pid]?.acceptedAttemptId ?? ""];
    return null;
  };
  type Planned = { attemptId: string; ownerId: string; slotId: string; cx: number; cy: number; w: number; h: number; rotation: number };
  const planned: Planned[] = [];
  for (const slot of scene.slots) {
    const cxSlot = slot.x + slot.w / 2;
    const cySlot = slot.y + slot.h / 2;
    for (const tile of slot.tiles) {
      if (!tile.participantSlot) continue;
      const own = slotOwner(tile.shotIndex, tile.participantSlot);
      if (!own || !own[1] || acceptedForCell(capture, tile.shotIndex, tile.participantSlot) !== own[1]) continue;
      const [dx, dy] = rot(slot.photo.x + tile.x + tile.w / 2 - slot.w / 2, slot.photo.y + tile.y + tile.h / 2 - slot.h / 2, slot.rotation);
      planned.push({ attemptId: own[1], ownerId: own[0], slotId: slot.id, cx: cxSlot + dx, cy: cySlot + dy, w: tile.w, h: tile.h, rotation: slot.rotation });
    }
  }
  const zs = generateNKeysBetween(null, null, planned.length);
  doc.transact(() => {
    const m = metaMap(doc);
    m.set("canvas", { w: studio.layout.canvas.widthPx, h: studio.layout.canvas.heightPx });
    m.set("frame", studio.frame ? JSON.stringify(studio.frame) : null);
    m.set("frameStyle", { bgColor: studio.style.bgColor, overlayOpacity: studio.frame?.overlayOpacity ?? 1 });
    m.set("globalFilter", studio.style.filterPreset === "ASLI" ? null : studio.style.filterPreset);
    m.set("schemaVersion", 1);
    m.set("layout", JSON.stringify({ layout: studio.layout, participantSlots: studio.participantSlots, style: studio.style, bindingStrategy: studio.bindingStrategy, fieldVersions: studio.fieldVersions }));
    planned.forEach((p, i) => {
      const dims = input.srcDims(p.attemptId) ?? { w: 1280, h: 960 };
      const el = new Y.Map<unknown>();
      const props: Record<string, unknown> = {
        type: "photo",
        x: Math.round(p.cx * 100) / 100,
        y: Math.round(p.cy * 100) / 100,
        scaleX: 1,
        scaleY: 1,
        rotation: p.rotation,
        opacity: 1,
        z: zs[i]!,
        hidden: false,
        createdBy: p.ownerId,
        updatedBy: p.ownerId,
        attemptId: p.attemptId,
        ownerId: p.ownerId,
        ownerName: input.names[p.ownerId] ?? "",
        slotId: p.slotId,
        w: Math.round(p.w * 100) / 100,
        h: Math.round(p.h * 100) / 100,
        srcW: dims.w,
        srcH: dims.h,
        crop: coverCrop(dims.w, dims.h, p.w, p.h),
        zoom: 1,
        flipX: false,
        filter: null,
        radius: studio.layout.slots.find((s) => s.id === p.slotId)?.radius ?? 0,
      };
      for (const [k, v] of Object.entries(props)) el.set(k, v);
      elementsMap(doc).set(`photo:${p.attemptId}`, el);
    });
  }, SEED_ORIGIN);
}

/** Dokumen baru ter-seed secara deterministik (clientID tetap). */
export function createSeededDoc(input: SeedInput): Y.Doc {
  const doc = createEditorDoc();
  doc.clientID = SEED_CLIENT_ID;
  seedDocument(doc, input);
  return doc;
}

// ---------------------------------------------------------------- sinkron & snapshot

export function toBase64(u8: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(s, "base64"));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Snapshot penuh dokumen (dipakai P08 saat FINAL untuk render ulang; DEC-060). */
export const snapshotDoc = (doc: Y.Doc): Uint8Array => Y.encodeStateAsUpdate(doc);

export function docFromSnapshot(bytes: Uint8Array): Y.Doc {
  const doc = createEditorDoc();
  Y.applyUpdate(doc, bytes);
  return doc;
}

export type { TextAlign };
