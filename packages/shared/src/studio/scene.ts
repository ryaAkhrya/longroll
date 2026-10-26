import { filterCss } from "./config";
import { computeFrameTransform } from "./adapt";
import type { DrawOp, FrameTransform } from "./adapt";
import { groupTiles } from "./generate";
import type { DecorSpec, Fill, FrameTemplate, ParticipantSlot, SlotBinding, StudioState } from "./types";

/**
 * Definisi scene tunggal (10 §1, §13): dipakai pratinjau studio (Konva + video DOM) sekarang, dan
 * kanvas editor / export resolusi penuh nanti (P07/P08) — tidak ada jalur render kedua yang berbeda.
 * Semua koordinat dalam base px; export cukup mengalikan dengan skala seragam.
 */

export const FONT_STACK = {
  display: '"Bricolage Grotesque", "Arial Narrow", system-ui, sans-serif',
  serif: '"Instrument Serif", "Times New Roman", Georgia, serif',
  mono: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  ui: '"Figtree", system-ui, sans-serif',
} as const;

export interface SceneTile {
  /** Relatif ke kotak foto slot (setelah inset polaroid). */
  x: number;
  y: number;
  w: number;
  h: number;
  shotIndex: number;
  participantSlot: ParticipantSlot | null;
  /** BLEND (DEC-062): tepi dilembutkan masker. */
  blend: { left: boolean; right: boolean } | null;
}

export interface SceneSlot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  radius: number;
  z: number;
  binding: SlotBinding;
  /** Kotak foto di dalam slot (polaroid punya bingkai putih). */
  photo: { x: number; y: number; w: number; h: number; radius: number };
  frameFill: string | null;
  stroke: { color: string; width: number } | null;
  shadow: boolean;
  tiles: SceneTile[];
  label: string;
}

export type SceneDecor =
  | { kind: "text"; x: number; y: number; text: string; font: keyof typeof FONT_STACK; size: number; color: string; align: "left" | "right" | "center"; italic: boolean; rotation: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill: string; radius: number; rotation: number; opacity: number }
  | { kind: "mark"; x: number; y: number; size: number; color: string };

export interface Scene {
  width: number;
  height: number;
  background: Fill;
  slots: SceneSlot[];
  overlay: { frameId: string; ops: DrawOp[]; opacity: number; transform: FrameTransform } | null;
  decor: SceneDecor[];
  /** Filter grup (05 §12) — string yang sama untuk CSS & `ctx.filter`. */
  filter: string;
}

export interface SceneContext {
  /** Nama peserta urut slot P1..P4 (dekor "names"). */
  names: string[];
  /** Tanggal yang ditampilkan dekor (YYYY.MM.DD), dihitung pemanggil supaya deterministik. */
  dateText: string;
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

export function buildScene(studio: StudioState, template: FrameTemplate | null, ctx: SceneContext): Scene {
  const W = studio.layout.canvas.widthPx;
  const H = studio.layout.canvas.heightPx;
  const unit = W / 600; // ukuran dekor relatif lebar strip 600
  const ss = template?.slotStyle ?? {};
  const n = studio.participantSlots.length;

  const userBg = studio.fieldVersions["style.bgColor"] !== undefined;
  let background: Fill = { kind: "solid", color: studio.style.bgColor };
  if (template?.layers.background && !(userBg && template.layers.background.kind === "solid")) background = template.layers.background;
  else if (template?.category === "CUSTOM" && !userBg) background = { kind: "solid", color: template.palette.bg };

  const slots: SceneSlot[] = studio.layout.slots.map((s, i) => {
    const polaroid = !!ss.polaroid;
    const padX = polaroid ? s.w * 0.05 : 0;
    const padTop = polaroid ? s.w * 0.05 : 0;
    const padBottom = polaroid ? s.h * 0.16 : 0;
    const photo = {
      x: padX,
      y: padTop,
      w: s.w - 2 * padX,
      h: s.h - padTop - padBottom,
      radius: polaroid ? 0 : Math.max(s.radius, (ss.radius ?? 0) * unit),
    };
    const tilt = ss.tilt && s.rotation === 0 ? (((i * 7) % 5) - 2) * (ss.tilt / 2) : 0;
    const tiles: SceneTile[] = [];
    const b = s.binding;
    if (b.kind === "SHOT_GROUP") {
      const rects = groupTiles(photo.w, photo.h, b.arrangement, n);
      rects.forEach((r, j) =>
        tiles.push({
          ...r,
          shotIndex: b.shotIndex,
          participantSlot: studio.participantSlots[j] ?? null,
          blend: b.arrangement === "BLEND" && n > 1 ? { left: j > 0, right: j < n - 1 } : null,
        }),
      );
    } else {
      const cell = b.kind === "CELL" ? b : b.cell;
      tiles.push({ x: 0, y: 0, w: photo.w, h: photo.h, shotIndex: cell?.shotIndex ?? 0, participantSlot: cell?.participantSlot ?? null, blend: null });
    }
    const shot = b.kind === "FREE" ? b.cell?.shotIndex : b.shotIndex;
    return {
      id: s.id,
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      rotation: s.rotation + tilt,
      radius: photo.radius,
      z: s.z,
      binding: b,
      photo,
      frameFill: polaroid ? "#FFFFFF" : null,
      stroke: ss.stroke ? { color: ss.stroke, width: (ss.strokeWidth ?? 2) * unit } : null,
      shadow: !!ss.shadow,
      tiles,
      label: `Shot ${(shot ?? 0) + 1}${b.kind === "CELL" ? ` · ${b.participantSlot}` : ""}`,
    };
  });

  let overlay: Scene["overlay"] = null;
  const ref = studio.frame;
  if (template?.layers.overlay && ref) {
    const art = { w: template.layers.overlay.width, h: template.layers.overlay.height };
    const t = computeFrameTransform(art, { w: W, h: H }, ref.adapt, ref.nineSlice ?? template.nineSlice);
    overlay = { frameId: template.layers.overlay.frameId, ops: t.ops, opacity: ref.overlayOpacity, transform: t };
  }

  const decor = buildDecor(template?.layers.decor ?? [], slots, W, H, unit, ctx);
  return { width: W, height: H, background, slots, overlay, decor, filter: filterCss(studio.style.filterPreset) };
}

function buildDecor(specs: DecorSpec[], slots: SceneSlot[], W: number, H: number, unit: number, ctx: SceneContext): SceneDecor[] {
  const out: SceneDecor[] = [];
  const bottom = slots.reduce((m, s) => Math.max(m, s.y + s.h), 0);
  const left = slots.reduce((m, s) => Math.min(m, s.x), W);
  const right = slots.reduce((m, s) => Math.max(m, s.x + s.w), 0);
  const footerMid = Math.min(H - 8 * unit, (bottom + H) / 2);
  const ax = (anchor: string) => (anchor.endsWith("left") ? left : anchor.endsWith("right") ? right : W / 2);
  const al = (anchor: string): "left" | "right" | "center" => (anchor.endsWith("left") ? "left" : anchor.endsWith("right") ? "right" : "center");
  const short = Math.min(W, H);
  let textLine = 0;
  for (const d of specs) {
    switch (d.type) {
      case "date":
        out.push({ kind: "text", x: ax(d.anchor), y: footerMid, text: ctx.dateText, font: d.font, size: d.size * short, color: d.color, align: al(d.anchor), italic: false, rotation: 0 });
        break;
      case "mark":
        out.push({ kind: "mark", x: ax(d.anchor), y: footerMid, size: 22 * unit, color: d.color });
        break;
      case "text":
        out.push({ kind: "text", x: ax(d.anchor), y: footerMid + textLine * d.size * short * 0.2, text: d.text, font: d.font, size: d.size * short, color: d.color, align: al(d.anchor), italic: !!d.italic, rotation: 0 });
        textLine -= 3;
        break;
      case "names":
        out.push({
          kind: "text",
          x: ax(d.anchor),
          y: footerMid + d.size * short * 1.6,
          text: ctx.names.map((nm) => nm.toLocaleUpperCase("id")).join(" · "),
          font: "ui",
          size: d.size * short,
          color: d.color,
          align: al(d.anchor),
          italic: false,
          rotation: 0,
        });
        break;
      case "sprockets": {
        // Lubang sprocket di dua sisi (Film 400).
        const hw = 14 * unit;
        const hh = 9 * unit;
        const step = 26 * unit;
        const mx = Math.max(4 * unit, (left - hw) / 2);
        for (let y = 14 * unit; y + hh < H - 8 * unit; y += step) {
          out.push({ kind: "rect", x: mx, y, w: hw, h: hh, fill: d.color, radius: 2 * unit, rotation: 0, opacity: 1 });
          out.push({ kind: "rect", x: W - mx - hw, y, w: hw, h: hh, fill: d.color, radius: 2 * unit, rotation: 0, opacity: 1 });
        }
        break;
      }
      case "frameNumbers":
        slots.forEach((s, i) => {
          out.push({
            kind: "text",
            x: Math.min(W - 6 * unit, s.x + s.w + Math.max(6 * unit, (W - right) * 0.35)),
            y: s.y + s.h * 0.15,
            text: `${24 + i}A`,
            font: "mono",
            size: 11 * unit,
            color: d.color,
            align: "left",
            italic: false,
            rotation: 90,
          });
        });
        break;
      case "tape":
        slots.slice(0, 8).forEach((s, i) => {
          const tw = Math.min(90 * unit, s.w * 0.4);
          out.push({ kind: "rect", x: s.x + s.w / 2 - tw / 2, y: s.y - 10 * unit, w: tw, h: 22 * unit, fill: d.color, radius: 2 * unit, rotation: i % 2 ? 4 : -5, opacity: 0.85 });
        });
        break;
    }
  }
  return out;
}

/** Warna placeholder pastel per slot peserta (pratinjau thumbnail tanpa video). */
export const PLACEHOLDER_TINT: Record<ParticipantSlot, string> = { P1: "#EBCFC5", P2: "#E5DDB8", P3: "#C9DDD0", P4: "#D8D0EA" };
