import { MODE_INFO } from "../session";
import type { Mode } from "../session";
import { OUTPUT_PRESET_SIZES, STRATEGY_LABEL, STUDIO_MODE_DEFAULTS } from "./config";
import { STUDIO_LIMITS } from "./limits";
import type {
  Arrangement,
  BindingStrategy,
  GroupArrangement,
  HoleRect,
  LayoutSlot,
  LayoutSpec,
  OutputSpec,
  ParticipantSlot,
  SlotBinding,
  SlotRatio,
  StudioPatch,
} from "./types";

/**
 * Generator BindingPlan (10 §5, DEC-087): data, bukan logika per mode yang di-hardcode di renderer.
 * Mendukung PER_SHOT_GROUP & PER_PARTICIPANT_SHOT di Strip/Group/Grid, FREEFORM di Collage, 1–8 shot ×
 * 1–4 peserta. Pelanggaran safeguard (DEC-042) TIDAK dipotong diam-diam: hasilnya `violation` + alternatif.
 */

export interface PlanInput {
  mode: Mode;
  strategy: BindingStrategy;
  shotCount: number;
  participantSlots: ParticipantSlot[];
  arrangement: Exclude<Arrangement, "CUSTOM">;
  slotRatio: SlotRatio;
  output: OutputSpec;
  gap: number;
  cornerRadius: number;
}

export interface PlanAlternative {
  label: string;
  patch: StudioPatch;
}

export type SafeguardCode =
  | "MAX_SHOTS"
  | "MAX_CELLS"
  | "MAX_GRID_SIDE"
  | "MAX_OUTPUT_PX"
  | "MIN_OUTPUT_PX"
  | "STRATEGY_MODE"
  | "ARRANGEMENT_MODE"
  | "NO_PARTICIPANTS"
  | "FRAME_SLOTS"
  | "SLOT_TOO_SMALL";

export interface SafeguardViolation {
  code: SafeguardCode;
  limit: number;
  actual: number;
  message: string;
  alternatives: PlanAlternative[];
}

export interface QualityWarning {
  code: "SMALL_CELL" | "MANY_CELLS";
  message: string;
  cellPx: number;
  alternatives: PlanAlternative[];
}

export type PlanResult = { ok: true; layout: LayoutSpec; warnings: QualityWarning[] } | { ok: false; violation: SafeguardViolation };

export function ratioValue(r: SlotRatio): number {
  const [a, b] = r.split(":").map(Number);
  return a! / b!;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Susunan sub-tile komposit grup di dalam satu slot SHOT_GROUP (relatif slot, base px). */
export function groupTiles(w: number, h: number, arrangement: GroupArrangement, n: number): HoleRect[] {
  if (n <= 1) return [{ x: 0, y: 0, w, h }];
  if (arrangement === "COLUMN") return Array.from({ length: n }, (_, i) => ({ x: 0, y: (h / n) * i, w, h: h / n }));
  if (arrangement === "HERO") {
    // Peserta pertama menonjol di kiri (56–60% lebar), yang lain ditumpuk rata di kanan.
    const hw = w * (n === 2 ? 0.6 : 0.56);
    const rest = n - 1;
    return [{ x: 0, y: 0, w: hw, h }, ...Array.from({ length: rest }, (_, i) => ({ x: hw, y: (h / rest) * i, w: w - hw, h: h / rest }))];
  }
  if (arrangement === "GRID") {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return Array.from({ length: n }, (_, i) => ({ x: (w / cols) * (i % cols), y: (h / rows) * Math.floor(i / cols), w: w / cols, h: h / rows }));
  }
  if (arrangement === "BLEND") {
    // Berdampingan dengan tumpang tindih 12% yang dilembutkan masker (DEC-062); tanpa segmentasi (DEC-095).
    const overlap = 0.12;
    const tw = w / (n - (n - 1) * overlap);
    return Array.from({ length: n }, (_, i) => ({ x: tw * (1 - overlap) * i, y: 0, w: tw, h }));
  }
  return Array.from({ length: n }, (_, i) => ({ x: (w / n) * i, y: 0, w: w / n, h }));
}

function groupArrangementFor(arr: Arrangement): GroupArrangement {
  if (arr === "WIDE") return "BLEND";
  if (arr === "FEATURE") return "HERO";
  if (arr === "GRID" || arr === "MOSAIC" || arr === "MAGAZINE" || arr === "MASONRY") return "GRID";
  if (arr === "STRIP_HORIZONTAL") return "ROW";
  return "ROW";
}

interface Unit {
  id: string;
  binding: SlotBinding;
}

function units(input: PlanInput): Unit[] {
  const out: Unit[] = [];
  const { shotCount: S, participantSlots: ps, strategy } = input;
  for (let s = 0; s < S; s++) {
    if (strategy === "PER_SHOT_GROUP") {
      out.push({ id: `s${s + 1}`, binding: { kind: "SHOT_GROUP", shotIndex: s, arrangement: groupArrangementFor(input.arrangement) } });
    } else {
      for (const p of ps) {
        out.push(
          strategy === "FREEFORM"
            ? { id: `f${s + 1}-${p}`, binding: { kind: "FREE", cell: { shotIndex: s, participantSlot: p } } }
            : { id: `s${s + 1}-${p}`, binding: { kind: "CELL", shotIndex: s, participantSlot: p } },
        );
      }
    }
  }
  return out;
}

function nearSquare(u: number): { rows: number; cols: number } {
  const cols = Math.ceil(Math.sqrt(u));
  return { rows: Math.ceil(u / cols), cols };
}

/** Majalah: 3 kolom; foto utama 2×2 + pendukung (1 tinggi / 2 bertumpuk di kanan, sisanya baris bawah). */
function magazineShape(u: number): { rows: number; cols: number } {
  if (u <= 1) return { rows: 1, cols: 1 };
  return { rows: 2 + Math.ceil(Math.max(0, u - 3) / 3), cols: 3 };
}

function gridShape(input: PlanInput, u: number): { rows: number; cols: number } {
  const S = input.shotCount;
  const n = input.participantSlots.length;
  const perGroup = input.strategy === "PER_SHOT_GROUP";
  switch (input.arrangement) {
    case "STRIP_VERTICAL":
    case "STRIP_ZIGZAG":
    case "WIDE":
      return perGroup ? { rows: S, cols: 1 } : { rows: S, cols: n };
    case "FEATURE":
      // Satu komposisi hero per shot; tanpa grup (per orang) → susunan majalah.
      return perGroup ? { rows: S, cols: 1 } : magazineShape(u);
    case "MAGAZINE":
      return magazineShape(u);
    case "MASONRY": {
      const mc = masonryCols(u);
      return { rows: Math.max(1, Math.ceil(u / mc)), cols: mc };
    }
    case "STRIP_HORIZONTAL":
      return perGroup ? { rows: 1, cols: S } : { rows: n, cols: S };
    case "GRID":
      return perGroup || n < 2 ? nearSquare(u) : { rows: S, cols: n };
    case "MOSAIC": {
      const cols = Math.min(3, Math.max(1, u - 1));
      return { rows: u === 1 ? 1 : 2 + Math.ceil((u - 1) / cols), cols };
    }
    case "SCATTER":
      return nearSquare(u);
  }
}

/** Skala export (10 §6): Strip 2×6 → 2×; preset lain 1×; AUTO: 2× bila sisi panjang base ≤ 2000. */
export function exportScaleFor(canvas: { preset: OutputSpec["preset"]; widthPx: number; heightPx: number }): number {
  if (canvas.preset !== "AUTO" && canvas.preset !== "CUSTOM") return OUTPUT_PRESET_SIZES[canvas.preset].exportScale;
  const long = Math.max(canvas.widthPx, canvas.heightPx);
  return long * 2 <= STUDIO_LIMITS.MAX_OUTPUT_PX && long <= 2000 ? 2 : 1;
}

function alternativesFor(input: PlanInput): PlanAlternative[] {
  const d = STUDIO_MODE_DEFAULTS[input.mode];
  const alts: PlanAlternative[] = [];
  if (input.strategy === "PER_PARTICIPANT_SHOT") alts.push({ label: STRATEGY_LABEL.PER_SHOT_GROUP, patch: { bindingStrategy: "PER_SHOT_GROUP" } });
  if (input.mode === "PHOTO_STRIP" && input.arrangement === "STRIP_VERTICAL" && input.strategy === "PER_SHOT_GROUP")
    alts.push({ label: "Pakai strip per orang", patch: { bindingStrategy: "PER_PARTICIPANT_SHOT" } });
  if (input.mode === "PHOTO_GRID" && input.arrangement !== "GRID") alts.push({ label: "Pakai grid", patch: { arrangement: "GRID" } });
  const fewer = Math.max(1, Math.min(input.shotCount - 1, d.shotCount));
  if (input.shotCount > 1 && fewer < input.shotCount) alts.push({ label: `Kurangi jadi ${fewer} shot`, patch: { shotCount: fewer } });
  return alts;
}

/** Pemeriksaan safeguard sebelum geometri (DEC-042). */
export function checkSafeguards(input: PlanInput): SafeguardViolation | null {
  const d = STUDIO_MODE_DEFAULTS[input.mode];
  const S = input.shotCount;
  const n = input.participantSlots.length;
  if (n < 1 || n > STUDIO_LIMITS.MAX_PARTICIPANTS)
    return { code: "NO_PARTICIPANTS", limit: STUDIO_LIMITS.MAX_PARTICIPANTS, actual: n, message: "Belum ada peserta di studio.", alternatives: [] };
  if (!d.strategies.includes(input.strategy))
    return {
      code: "STRATEGY_MODE",
      limit: 0,
      actual: 0,
      message: `${MODE_INFO[input.mode].name} gak bisa pakai strategi ini.`,
      alternatives: [{ label: STRATEGY_LABEL[d.bindingStrategy], patch: { bindingStrategy: d.bindingStrategy } }],
    };
  if (!d.arrangements.includes(input.arrangement))
    return {
      code: "ARRANGEMENT_MODE",
      limit: 0,
      actual: 0,
      message: `Susunan ini gak tersedia buat ${MODE_INFO[input.mode].name}.`,
      alternatives: [{ label: "Susunan bawaan", patch: { arrangement: d.arrangement as Exclude<Arrangement, "CUSTOM"> } }],
    };
  const maxShots = Math.min(STUDIO_LIMITS.MAX_SHOTS, d.maxShots);
  if (!Number.isInteger(S) || S < 1 || S > maxShots)
    return {
      code: "MAX_SHOTS",
      limit: maxShots,
      actual: S,
      message: `Jumlah shot ${MODE_INFO[input.mode].name} 1–${maxShots}. ${S} shot belum bisa.`,
      alternatives: S > maxShots ? [{ label: `Pakai ${maxShots} shot`, patch: { shotCount: maxShots } }] : [{ label: "Pakai 1 shot", patch: { shotCount: 1 } }],
    };
  const cells = S * n;
  if (cells > STUDIO_LIMITS.MAX_CELLS)
    return { code: "MAX_CELLS", limit: STUDIO_LIMITS.MAX_CELLS, actual: cells, message: `${cells} foto melebihi ${STUDIO_LIMITS.MAX_CELLS}.`, alternatives: alternativesFor(input) };
  const u = input.strategy === "PER_SHOT_GROUP" ? S : cells;
  const { rows, cols } = gridShape(input, u);
  if (rows > STUDIO_LIMITS.MAX_GRID_SIDE || cols > STUDIO_LIMITS.MAX_GRID_SIDE || rows * cols > STUDIO_LIMITS.MAX_GRID_CELLS)
    return {
      code: "MAX_GRID_SIDE",
      limit: STUDIO_LIMITS.MAX_GRID_SIDE,
      actual: Math.max(rows, cols),
      message: `Susunan ${rows}×${cols} melebihi batas ${STUDIO_LIMITS.MAX_GRID_SIDE} per sisi.`,
      alternatives: alternativesFor(input),
    };
  if (input.output.preset === "CUSTOM") {
    const w = input.output.widthPx ?? 0;
    const h = input.output.heightPx ?? 0;
    const long = Math.max(w, h);
    if (long > STUDIO_LIMITS.MAX_OUTPUT_PX)
      return { code: "MAX_OUTPUT_PX", limit: STUDIO_LIMITS.MAX_OUTPUT_PX, actual: long, message: `Sisi terpanjang maksimal ${STUDIO_LIMITS.MAX_OUTPUT_PX} px.`, alternatives: [{ label: "Ukuran otomatis", patch: { output: { preset: "AUTO" } } }] };
    if (Math.min(w, h) < STUDIO_LIMITS.MIN_SLOT_PX * 2 || long < STUDIO_LIMITS.MIN_OUTPUT_PX)
      return { code: "MIN_OUTPUT_PX", limit: STUDIO_LIMITS.MIN_OUTPUT_PX, actual: long, message: `Sisi terpanjang minimal ${STUDIO_LIMITS.MIN_OUTPUT_PX} px.`, alternatives: [{ label: "Ukuran otomatis", patch: { output: { preset: "AUTO" } } }] };
  }
  return null;
}

/** Ukuran kanvas & kotak isi. */
function canvasFor(input: PlanInput, rows: number, cols: number, r: number, gap: number) {
  const arr = input.arrangement;
  const vertical = arr === "STRIP_VERTICAL" || arr === "STRIP_ZIGZAG";
  const horizontal = arr === "STRIP_HORIZONTAL";
  const mosaic = arr === "MOSAIC";
  // Baris "efektif" mosaik: slot besar = 2 baris kecil.
  const preset = input.output.preset;
  if (preset === "AUTO") {
    if (horizontal) {
      const H = rows <= 2 ? 600 : 1200;
      const pad = Math.round(H * 0.06);
      const footer = Math.round(H * 0.08);
      const uh = (H - 2 * pad - footer - (rows - 1) * gap) / rows;
      const uw = uh * r;
      return { W: Math.round(2 * pad + cols * uw + (cols - 1) * gap), H, pad, footer, uw, uh };
    }
    const W = vertical ? (cols <= 2 ? 600 : 1200) : arr === "WIDE" || (arr === "FEATURE" && input.strategy === "PER_SHOT_GROUP") ? 1800 : 1600;
    const pad = Math.round(W * 0.06);
    const footer = Math.round(W * (vertical ? 0.12 : 0.07));
    const uw = (W - 2 * pad - (cols - 1) * gap) / cols;
    const uh = uw / r;
    const H = Math.round(2 * pad + footer + rows * uh + (rows - 1) * gap);
    if (arr === "SCATTER") return { W, H: Math.max(H, Math.round(W * 0.75)), pad, footer, uw, uh };
    return { W, H, pad, footer, uw, uh };
  }
  const size = preset === "CUSTOM" ? { w: input.output.widthPx!, h: input.output.heightPx! } : OUTPUT_PRESET_SIZES[preset];
  const W = size.w;
  const H = size.h;
  const short = Math.min(W, H);
  const pad = Math.round(short * 0.06);
  const footer = Math.round(short * (vertical ? 0.12 : 0.07));
  const aw = W - 2 * pad;
  const ah = H - 2 * pad - footer;
  let uw = Math.min((aw - (cols - 1) * gap) / cols, ((ah - (rows - 1) * gap) / rows) * r);
  if (mosaic) uw = Math.min((aw - (cols - 1) * gap) / cols, ((ah - (rows - 1) * gap) / rows) * r);
  uw = Math.max(1, uw);
  return { W, H, pad, footer, uw, uh: uw / r };
}

const MASONRY_FACTORS = [1.22, 0.86, 1, 1.3, 0.9, 1.12, 0.95, 1.2];

/** Kolase tertata: 2 kolom untuk ≤ 6 foto, 3 kolom di atasnya (supaya tinggi kanvas tetap wajar). */
export const masonryCols = (count: number) => (count <= 6 ? 2 : 3);

/** Kolase tertata: dua kolom, tiap foto ditaruh di kolom yang lebih pendek; tinggi bervariasi deterministik; tanpa tumpang tindih. */
export function masonryLayout(count: number, uw: number, uh: number, gap: number): { items: { col: number; y: number; h: number }[]; blockH: number } {
  const colY: number[] = Array.from({ length: masonryCols(count) }, () => 0);
  const items: { col: number; y: number; h: number }[] = [];
  for (let i = 0; i < count; i++) {
    const col = colY.indexOf(Math.min(...colY));
    const h = uh * MASONRY_FACTORS[i % MASONRY_FACTORS.length]!;
    items.push({ col, y: colY[col]!, h });
    colY[col]! += h + gap;
  }
  return { items, blockH: Math.max(...colY) - gap };
}

export function generatePlan(input: PlanInput): PlanResult {
  const violation = checkSafeguards(input);
  if (violation) return { ok: false, violation };
  const list = units(input);
  const u = list.length;
  const { rows, cols } = gridShape(input, u);
  const r = ratioValue(input.slotRatio);
  const gap = Math.max(0, Math.min(STUDIO_LIMITS.MAX_GAP_PX, input.gap));
  const c = canvasFor(input, rows, cols, r, gap);
  let masonry: ReturnType<typeof masonryLayout> | null = null;
  if (input.arrangement === "MASONRY") {
    masonry = masonryLayout(u, c.uw, c.uh, gap);
    if (input.output.preset === "AUTO") {
      c.H = Math.round(2 * c.pad + c.footer + masonry.blockH);
    } else {
      // Ukuran tetap: perkecil seragam sampai muat (tinggi ∝ lebar sel; selisih celah dikoreksi iteratif).
      for (let k = 0; k < 4 && masonry.blockH > c.H - 2 * c.pad - c.footer; k++) {
        c.uw *= (c.H - 2 * c.pad - c.footer) / masonry.blockH;
        c.uh = c.uw / r;
        masonry = masonryLayout(u, c.uw, c.uh, gap);
      }
    }
  }
  const blockW = cols * c.uw + (cols - 1) * gap;
  const blockH = masonry ? masonry.blockH : rows * c.uh + (rows - 1) * gap;
  const ox = (c.W - blockW) / 2;
  const contentH = c.H - 2 * c.pad - c.footer;
  const oy = c.pad + Math.max(0, (contentH - blockH) / 2);

  if (Math.max(c.W, c.H) > STUDIO_LIMITS.MAX_OUTPUT_PX) {
    return {
      ok: false,
      violation: {
        code: "MAX_OUTPUT_PX",
        limit: STUDIO_LIMITS.MAX_OUTPUT_PX,
        actual: Math.max(c.W, c.H),
        message: `Hasilnya jadi ${Math.max(c.W, c.H)} px, lewat batas ${STUDIO_LIMITS.MAX_OUTPUT_PX} px.`,
        alternatives: alternativesFor(input),
      },
    };
  }

  const radius = Math.max(0, Math.min(STUDIO_LIMITS.MAX_RADIUS_PX, input.cornerRadius));
  const slots: LayoutSlot[] = [];
  const at = (i: number) => ({ col: i % cols, row: Math.floor(i / cols) });
  list.forEach((unit, i) => {
    let x: number, y: number, w: number, h: number;
    let rotation = 0;
    const magazine = (input.arrangement === "MAGAZINE" || (input.arrangement === "FEATURE" && input.strategy !== "PER_SHOT_GROUP")) && u > 1;
    if (masonry) {
      const m = masonry.items[i]!;
      x = ox + m.col * (c.uw + gap);
      y = oy + m.y;
      w = c.uw;
      h = m.h;
      rotation = (((i * 37) % 5) - 2) * 0.7;
    } else if (magazine) {
      const step = c.uw + gap;
      const full = 3 * c.uw + 2 * gap;
      if (i === 0) {
        x = ox;
        y = oy;
        w = 2 * c.uw + gap;
        h = 2 * c.uh + gap;
      } else if (u === 2) {
        x = ox + 2 * step;
        y = oy;
        w = c.uw;
        h = 2 * c.uh + gap;
      } else if (i <= 2) {
        x = ox + 2 * step;
        y = oy + (i - 1) * (c.uh + gap);
        w = c.uw;
        h = c.uh;
      } else {
        const k = i - 3;
        const row = Math.floor(k / 3);
        const inRow = Math.min(3, u - 3 - row * 3);
        w = (full - (inRow - 1) * gap) / inRow;
        h = c.uh;
        x = ox + (k % 3) * (w + gap);
        y = oy + (2 + row) * (c.uh + gap);
      }
    } else if (input.arrangement === "MOSAIC" && u > 1) {
      if (i === 0) {
        x = ox;
        y = oy;
        w = blockW;
        h = 2 * c.uh + gap;
      } else {
        const p = at(i - 1);
        x = ox + p.col * (c.uw + gap);
        y = oy + (p.row + 2) * (c.uh + gap);
        w = c.uw;
        h = c.uh;
      }
    } else {
      const p = at(i);
      x = ox + p.col * (c.uw + gap);
      y = oy + p.row * (c.uh + gap);
      w = c.uw;
      h = c.uh;
      if (input.arrangement === "STRIP_ZIGZAG") {
        // Berselang-seling kiri/kanan + miring tipis; ukuran 90% supaya geser tidak keluar dari kolom.
        const odd = p.row % 2 === 1;
        const nw = w * 0.9;
        const nh = h * 0.95;
        x += (w - nw) / 2 + (odd ? 1 : -1) * w * 0.045;
        y += (h - nh) / 2;
        w = nw;
        h = nh;
        rotation = odd ? 1.2 : -1.2;
      }
      if (input.arrangement === "SCATTER") {
        // Kolase: 82% sel, geser & miring deterministik (bukan acak) supaya semua klien identik.
        const jx = (((i * 53) % 11) - 5) / 100;
        const jy = (((i * 29) % 9) - 4) / 100;
        rotation = ((i * 37) % 17) - 8;
        const nw = w * 0.82;
        const nh = h * 0.82;
        x += (w - nw) / 2 + jx * w;
        y += (h - nh) / 2 + jy * h;
        w = nw;
        h = nh;
      }
    }
    slots.push({
      id: unit.id,
      x: round2(x),
      y: round2(y),
      w: round2(w),
      h: round2(h),
      rotation,
      radius,
      z: i,
      fit: "cover",
      focal: { x: 0.5, y: 0.35 },
      binding: unit.binding,
    });
  });

  const layout: LayoutSpec = {
    canvas: { preset: input.output.preset, widthPx: Math.round(c.W), heightPx: Math.round(c.H) },
    shotCount: input.shotCount,
    arrangement: input.arrangement,
    slotRatio: input.slotRatio,
    output: input.output,
    slots,
  };
  return { ok: true, layout, warnings: qualityWarnings(input, layout) };
}

/** Sisi pendek cell terkecil saat export (px). */
export function minCellExportPx(layout: LayoutSpec, participantCount: number): number {
  const scale = exportScaleFor(layout.canvas);
  let min = Infinity;
  for (const s of layout.slots) {
    if (s.binding.kind === "SHOT_GROUP") {
      for (const t of groupTiles(s.w, s.h, s.binding.arrangement, participantCount)) min = Math.min(min, Math.min(t.w, t.h));
    } else min = Math.min(min, Math.min(s.w, s.h));
  }
  return Math.round((Number.isFinite(min) ? min : 0) * scale);
}

function qualityWarnings(input: PlanInput, layout: LayoutSpec): QualityWarning[] {
  const n = input.participantSlots.length;
  const cells = input.shotCount * n;
  const cellPx = minCellExportPx(layout, n);
  const out: QualityWarning[] = [];
  if (cellPx < STUDIO_LIMITS.MIN_CELL_PX_WARN) {
    out.push({
      code: "SMALL_CELL",
      cellPx,
      message:
        cells > 16
          ? `${input.shotCount} shot × ${n} orang jadi ${cells} foto. Pakai strip per orang atau grid biar tetap kebaca?`
          : `Tiap foto cuma ${cellPx} px di hasil akhir, bakal kecil.`,
      alternatives: alternativesFor(input),
    });
  } else if (cells > 16 && input.strategy !== "PER_SHOT_GROUP") {
    out.push({
      code: "MANY_CELLS",
      cellPx,
      message: `${input.shotCount} shot × ${n} orang jadi ${cells} foto.`,
      alternatives: alternativesFor(input),
    });
  }
  return out;
}

/**
 * Plan dari lubang frame custom (adaptasi FIXED): kanvas mengikuti rasio artwork, slot = lubang
 * (urutan baca). Unit lebih banyak dari lubang → violation FRAME_SLOTS (tidak memotong diam-diam).
 */
export function planFromHoles(input: Omit<PlanInput, "arrangement" | "output"> & { holes: HoleRect[]; art: { w: number; h: number } }): PlanResult {
  const base: PlanInput = { ...input, arrangement: STUDIO_MODE_DEFAULTS[input.mode].arrangement as Exclude<Arrangement, "CUSTOM">, output: { preset: "AUTO" } };
  const v = checkSafeguards(base);
  if (v) return { ok: false, violation: v };
  const list = units(base);
  const holes = [...input.holes].sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) / 2 ? a.y - b.y : a.x - b.x));
  if (list.length > holes.length) {
    const alts: PlanAlternative[] = [];
    if (input.strategy === "PER_PARTICIPANT_SHOT" && input.shotCount <= holes.length)
      alts.push({ label: STRATEGY_LABEL.PER_SHOT_GROUP, patch: { bindingStrategy: "PER_SHOT_GROUP" } });
    if (input.strategy !== "PER_PARTICIPANT_SHOT" && holes.length >= 1) alts.push({ label: `Pakai ${Math.min(holes.length, STUDIO_LIMITS.MAX_SHOTS)} shot`, patch: { shotCount: Math.min(holes.length, STUDIO_LIMITS.MAX_SHOTS) } });
    return {
      ok: false,
      violation: {
        code: "FRAME_SLOTS",
        limit: holes.length,
        actual: list.length,
        message: `Frame ini cuma punya ${holes.length} lubang, butuh ${list.length}. Pakai "Pas otomatis" atau ubah jumlah shot.`,
        alternatives: alts,
      },
    };
  }
  const long = 1800;
  const s = long / Math.max(input.art.w, input.art.h);
  const W = Math.round(input.art.w * s);
  const H = Math.round(input.art.h * s);
  const slots: LayoutSlot[] = list.map((unit, i) => {
    const hole = holes[i]!;
    return {
      id: unit.id,
      x: round2(hole.x * s),
      y: round2(hole.y * s),
      w: round2(hole.w * s),
      h: round2(hole.h * s),
      rotation: 0,
      radius: 0,
      z: i,
      fit: "cover",
      focal: { x: 0.5, y: 0.35 },
      binding: unit.binding,
    };
  });
  const layout: LayoutSpec = {
    canvas: { preset: "CUSTOM", widthPx: W, heightPx: H },
    shotCount: input.shotCount,
    arrangement: "CUSTOM",
    slotRatio: input.slotRatio,
    output: { preset: "CUSTOM", widthPx: W, heightPx: H },
    slots,
  };
  return { ok: true, layout, warnings: qualityWarnings(base, layout) };
}
