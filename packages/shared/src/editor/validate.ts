import * as Y from "yjs";
import { FILTER_PRESETS } from "../studio/config";
import { FRAME_ADAPTS } from "../studio/types";
import { decodePoints, elementsMap, historyArray, metaMap, readElement } from "./doc";
import { COMMON_KEYS, EDITOR_LIMITS, ELEMENT_TYPES, STICKER_IDS, TEXT_FONT_STYLES, TYPE_KEYS } from "./schema";
import type { ElementType } from "./schema";

/**
 * Validasi dokumen & update di SERVER (11 §8, 14 §8.2, TC-EDIT-022): update diterapkan dulu ke salinan
 * (probe), hasilnya divalidasi penuh (skema, rentang angka, katalog, attemptId accepted, imutabilitas
 * foto sumber, batas jumlah/ukuran). Update tidak valid ditolak seluruhnya; klien disinkronkan ulang
 * dari state server. Tidak ada isi dokumen yang dicatat di log.
 */

export type IssueCode = "SCHEMA" | "LIMIT" | "ATTEMPT" | "IMMUTABLE" | "TOO_LARGE" | "MALFORMED";
export interface DocIssue {
  code: IssueCode;
  detail: string;
}

export interface ValidateCtx {
  /** attemptId accepted di sesi ini → participantId pemilik. */
  acceptedAttempts: ReadonlyMap<string, string>;
}

const num = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const COLOR = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const issue = (code: IssueCode, detail: string): DocIssue => ({ code, detail });
const FILTER_IDS = new Set<string>(FILTER_PRESETS.map((f) => f.id));
const META_KEYS = new Set(["canvas", "frame", "frameStyle", "globalFilter", "schemaVersion", "layout"]);

function validateElement(id: string, s: Record<string, unknown>, canvas: { w: number; h: number }, ctx: ValidateCtx): DocIssue | null {
  const type = s.type as ElementType;
  if (!ELEMENT_TYPES.includes(type)) return issue("SCHEMA", `${id}: tipe`);
  if (id.length > 64) return issue("SCHEMA", `${id}: id`);
  const allowed = new Set<string>([...COMMON_KEYS, ...TYPE_KEYS[type]]);
  for (const k of Object.keys(s)) if (!allowed.has(k)) return issue("SCHEMA", `${id}: key ${k}`);
  const lim = EDITOR_LIMITS;
  if (!num(s.x, -canvas.w * lim.maxCoordFactor, canvas.w * lim.maxCoordFactor) || !num(s.y, -canvas.h * lim.maxCoordFactor, canvas.h * lim.maxCoordFactor)) return issue("SCHEMA", `${id}: posisi`);
  if (!num(s.scaleX, lim.minScale, lim.maxScale) || !num(s.scaleY, lim.minScale, lim.maxScale)) return issue("SCHEMA", `${id}: skala`);
  if (!num(s.rotation, -3600, 3600) || !num(s.opacity, 0, 1)) return issue("SCHEMA", `${id}: rotasi/opacity`);
  if (typeof s.z !== "string" || !s.z || s.z.length > 40 || !/^[0-9A-Za-z]+$/.test(s.z)) return issue("SCHEMA", `${id}: z`);
  if (typeof s.hidden !== "boolean") return issue("SCHEMA", `${id}: hidden`);
  if (typeof s.createdBy !== "string" || typeof s.updatedBy !== "string" || s.createdBy.length > 64 || s.updatedBy.length > 64) return issue("SCHEMA", `${id}: oleh`);

  switch (type) {
    case "photo": {
      if (typeof s.attemptId !== "string" || id !== `photo:${s.attemptId}`) return issue("ATTEMPT", `${id}: id foto`);
      const owner = ctx.acceptedAttempts.get(s.attemptId);
      if (!owner || owner !== s.ownerId) return issue("ATTEMPT", `${id}: bukan foto accepted`);
      if (!num(s.w, 10, 8192) || !num(s.h, 10, 8192) || !num(s.srcW, 1, 8192) || !num(s.srcH, 1, 8192)) return issue("SCHEMA", `${id}: ukuran foto`);
      const c = s.crop as Record<string, unknown> | undefined;
      if (!c || !num(c.x, 0, 1) || !num(c.y, 0, 1) || !num(c.w, 0.02, 1) || !num(c.h, 0.02, 1) || (c.x as number) + (c.w as number) > 1.0001 || (c.y as number) + (c.h as number) > 1.0001) return issue("SCHEMA", `${id}: crop`);
      if (!num(s.zoom, 1, 4) || typeof s.flipX !== "boolean") return issue("SCHEMA", `${id}: zoom`);
      if (s.filter !== null && (typeof s.filter !== "string" || !FILTER_IDS.has(s.filter))) return issue("SCHEMA", `${id}: filter`);
      if (s.radius !== undefined && !num(s.radius, 0, 400)) return issue("SCHEMA", `${id}: radius`);
      if (s.slotId !== undefined && (typeof s.slotId !== "string" || s.slotId.length > 40)) return issue("SCHEMA", `${id}: slot`);
      if (typeof s.ownerName !== "string" || s.ownerName.length > 40) return issue("SCHEMA", `${id}: nama`);
      return null;
    }
    case "sticker":
      if (typeof s.assetId !== "string" || !STICKER_IDS.has(s.assetId)) return issue("SCHEMA", `${id}: aset`);
      if (!num(s.w, 10, 1200) || !num(s.h, 10, 1200)) return issue("SCHEMA", `${id}: ukuran`);
      if (s.tint !== undefined && (typeof s.tint !== "string" || !COLOR.test(s.tint))) return issue("SCHEMA", `${id}: tint`);
      return null;
    case "text":
      if (typeof s.content !== "string" || s.content.length > lim.maxTextLength) return issue("SCHEMA", `${id}: isi`);
      if (!TEXT_FONT_STYLES.includes(s.fontStyle as never) || typeof s.color !== "string" || !COLOR.test(s.color)) return issue("SCHEMA", `${id}: gaya`);
      if (!num(s.fontSize, lim.minFont, lim.maxFont) || !["left", "center", "right"].includes(s.align as string)) return issue("SCHEMA", `${id}: font`);
      if (s.w !== undefined && !num(s.w, 10, 4000)) return issue("SCHEMA", `${id}: lebar`);
      return null;
    case "doodle": {
      if (typeof s.points !== "string" || s.points.length > 60_000) return issue("SCHEMA", `${id}: titik`);
      const pts = decodePoints(s.points);
      if (!pts || pts.length > lim.maxDoodlePoints || pts.length < 1) return issue("SCHEMA", `${id}: titik`);
      if (pts.some(([px, py]) => Math.abs(px) > 40_000 || Math.abs(py) > 40_000)) return issue("SCHEMA", `${id}: jangkauan`);
      if (typeof s.color !== "string" || !COLOR.test(s.color) || !num(s.width, 1, lim.doodleMaxWidth)) return issue("SCHEMA", `${id}: gaya`);
      return null;
    }
  }
}

/** Validasi penuh sebuah dokumen. */
export function validateDoc(doc: Y.Doc, ctx: ValidateCtx): DocIssue | null {
  const meta = metaMap(doc);
  for (const k of meta.keys()) if (!META_KEYS.has(k)) return issue("SCHEMA", `meta.${k}`);
  const canvas = meta.get("canvas") as { w: number; h: number } | undefined;
  if (!canvas || !num(canvas.w, 60, 8192) || !num(canvas.h, 60, 8192)) return issue("SCHEMA", "meta.canvas");
  if (meta.get("schemaVersion") !== 1) return issue("SCHEMA", "meta.schemaVersion");
  const gf = meta.get("globalFilter");
  if (gf !== null && gf !== undefined && (typeof gf !== "string" || !FILTER_IDS.has(gf))) return issue("SCHEMA", "meta.globalFilter");
  const fr = meta.get("frame");
  if (fr !== null && fr !== undefined) {
    if (typeof fr !== "string" || fr.length > 600) return issue("SCHEMA", "meta.frame");
    try {
      const f = JSON.parse(fr) as { frameId?: unknown; source?: unknown; adapt?: unknown };
      if (typeof f.frameId !== "string" || (f.source !== "BUILTIN" && f.source !== "CUSTOM") || !FRAME_ADAPTS.includes(f.adapt as never)) return issue("SCHEMA", "meta.frame");
    } catch {
      return issue("SCHEMA", "meta.frame");
    }
  }
  const fs = meta.get("frameStyle") as { bgColor?: unknown; overlayOpacity?: unknown } | undefined;
  if (fs && (typeof fs.bgColor !== "string" || !COLOR.test(fs.bgColor) || !num(fs.overlayOpacity, 0.5, 1))) return issue("SCHEMA", "meta.frameStyle");
  const layout = meta.get("layout");
  if (layout !== undefined && (typeof layout !== "string" || layout.length > 200_000)) return issue("SCHEMA", "meta.layout");

  const els = elementsMap(doc);
  if (els.size > EDITOR_LIMITS.maxElements) return issue("LIMIT", `elemen ${els.size}`);
  for (const [id, el] of els) {
    if (!(el instanceof Y.Map)) return issue("SCHEMA", `${id}: bukan map`);
    const s = readElement(el);
    // `content` teks harus Y.Text (bukan string polos) agar penggabungan CRDT berlaku.
    if (s.type === "text" && !(el.get("content") instanceof Y.Text)) return issue("SCHEMA", `${id}: content`);
    const bad = validateElement(id, s, canvas, ctx);
    if (bad) return bad;
  }
  const hist = historyArray(doc);
  // Pemangkasan FIFO dilakukan tiap klien/server; penulisan bersamaan bisa sesaat melebihi batas → toleransi 2×.
  if (hist.length > EDITOR_LIMITS.maxHistory * 2) return issue("LIMIT", "riwayat");
  for (const h of hist.toArray()) {
    if (!h || typeof h !== "object" || typeof h.id !== "string" || typeof h.by !== "string" || typeof h.label !== "string" || h.label.length > 160 || JSON.stringify(h).length > 12_000) return issue("SCHEMA", "riwayat");
  }
  return null;
}

/** Aturan yang membandingkan sebelum/sesudah: foto sumber & kanvas tak boleh diubah/ditukar. */
export function validateTransition(prev: Y.Doc, next: Y.Doc): DocIssue | null {
  const pc = metaMap(prev).get("canvas");
  const nc = metaMap(next).get("canvas");
  if (pc !== undefined && JSON.stringify(pc) !== JSON.stringify(nc)) return issue("IMMUTABLE", "meta.canvas");
  const pl = metaMap(prev).get("layout");
  if (pl !== undefined && pl !== metaMap(next).get("layout")) return issue("IMMUTABLE", "meta.layout");
  for (const [id, pe] of elementsMap(prev)) {
    const ne = elementsMap(next).get(id);
    if (!ne) continue; // dihapus: boleh (bisa dipulihkan lewat Balikin)
    if (pe.get("type") !== ne.get("type")) return issue("IMMUTABLE", `${id}: tipe`);
    if (pe.get("createdBy") !== ne.get("createdBy")) return issue("IMMUTABLE", `${id}: createdBy`);
    if (pe.get("type") === "photo") {
      for (const k of ["attemptId", "ownerId", "ownerName", "srcW", "srcH"]) if (pe.get(k) !== ne.get(k)) return issue("IMMUTABLE", `${id}: ${k}`);
    }
  }
  return null;
}

export type CheckResult = { ok: true } | { ok: false; issue: DocIssue };

/**
 * Periksa sebuah update biner terhadap state server tanpa mengubahnya. Dipanggil sebelum menerapkan &
 * me-relay update. Ukuran update > 256 KB atau dokumen hasil > 2 MB → TOO_LARGE (`DOC_TOO_LARGE`).
 */
export function checkUpdate(server: Y.Doc, update: Uint8Array, ctx: ValidateCtx): CheckResult {
  if (update.byteLength > EDITOR_LIMITS.maxUpdateBytes) return { ok: false, issue: issue("TOO_LARGE", "update") };
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, Y.encodeStateAsUpdate(server));
    Y.applyUpdate(probe, update);
  } catch {
    probe.destroy();
    return { ok: false, issue: issue("MALFORMED", "update") };
  }
  try {
    // Update dengan celah (dependensi hilang) tidak terintegrasi & menggantung di `pending*`: bila celahnya diisi
    // kemudian, isi menggantung ikut masuk TANPA validasi. Tolak sejak awal (klien wajib resync dari state server).
    const st = probe.store as unknown as { pendingStructs: unknown; pendingDs: unknown };
    if (st.pendingStructs || st.pendingDs) return { ok: false, issue: issue("MALFORMED", "celah dependensi") };
    if (Y.encodeStateAsUpdate(probe).byteLength > EDITOR_LIMITS.maxDocBytes) return { ok: false, issue: issue("TOO_LARGE", "dokumen") };
    const bad = validateDoc(probe, ctx) ?? validateTransition(server, probe);
    return bad ? { ok: false, issue: bad } : { ok: true };
  } finally {
    probe.destroy();
  }
}
