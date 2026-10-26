import { STUDIO_LIMITS } from "./limits";
import { PARTICIPANT_SLOTS } from "./types";
import type { BindingStrategy, LayoutSlot, LayoutSpec, ParticipantSlot } from "./types";

export type LayoutIssue = { reason: "SAFEGUARD" | "BINDING" | "GEOMETRY"; detail: string; limit?: number };

const finite = (...ns: unknown[]) => ns.every((n) => typeof n === "number" && Number.isFinite(n));

/** Porsi luas slot (tanpa rotasi) yang berada di dalam kanvas. */
export function insideFraction(s: Pick<LayoutSlot, "x" | "y" | "w" | "h">, W: number, H: number): number {
  const ix = Math.max(0, Math.min(s.x + s.w, W) - Math.max(s.x, 0));
  const iy = Math.max(0, Math.min(s.y + s.h, H) - Math.max(s.y, 0));
  return s.w > 0 && s.h > 0 ? (ix * iy) / (s.w * s.h) : 0;
}

/**
 * Validator bersama (14 §6.1, 10 §7): safeguard DEC-042, konsistensi binding, slot ≥ 50% di dalam
 * kanvas, minimum 60×60 base px, NaN/Infinity ditolak. Dipakai server (otoritatif) & klien (UX).
 */
export function validateLayout(layout: LayoutSpec, strategy: BindingStrategy, participantSlots: ParticipantSlot[]): LayoutIssue | null {
  const L = STUDIO_LIMITS;
  const { canvas, shotCount, slots } = layout;
  if (!canvas || !finite(canvas.widthPx, canvas.heightPx)) return { reason: "GEOMETRY", detail: "canvas" };
  const long = Math.max(canvas.widthPx, canvas.heightPx);
  if (long > L.MAX_OUTPUT_PX) return { reason: "SAFEGUARD", detail: "output", limit: L.MAX_OUTPUT_PX };
  if (Math.min(canvas.widthPx, canvas.heightPx) < L.MIN_SLOT_PX) return { reason: "GEOMETRY", detail: "canvas-small" };
  if (!Number.isInteger(shotCount) || shotCount < 1 || shotCount > L.MAX_SHOTS) return { reason: "SAFEGUARD", detail: "shots", limit: L.MAX_SHOTS };
  const n = participantSlots.length;
  if (n < 1 || n > L.MAX_PARTICIPANTS || new Set(participantSlots).size !== n || participantSlots.some((p) => !PARTICIPANT_SLOTS.includes(p)))
    return { reason: "BINDING", detail: "participants" };
  if (shotCount * n > L.MAX_CELLS) return { reason: "SAFEGUARD", detail: "cells", limit: L.MAX_CELLS };
  if (!Array.isArray(slots) || slots.length === 0) return { reason: "BINDING", detail: "empty" };
  const maxSlots = strategy === "PER_SHOT_GROUP" ? L.MAX_SHOTS : L.MAX_CELLS;
  if (slots.length > maxSlots) return { reason: "SAFEGUARD", detail: "slots", limit: maxSlots };

  const ids = new Set<string>();
  const covered = new Set<string>();
  for (const s of slots) {
    if (typeof s.id !== "string" || !s.id || s.id.length > 32 || ids.has(s.id)) return { reason: "GEOMETRY", detail: "id" };
    ids.add(s.id);
    if (!finite(s.x, s.y, s.w, s.h, s.rotation, s.radius, s.z)) return { reason: "GEOMETRY", detail: "nan" };
    if (s.w < L.MIN_SLOT_PX || s.h < L.MIN_SLOT_PX) return { reason: "GEOMETRY", detail: "min-size", limit: L.MIN_SLOT_PX };
    if (insideFraction(s, canvas.widthPx, canvas.heightPx) < L.MIN_SLOT_INSIDE) return { reason: "GEOMETRY", detail: "outside" };
    if (s.radius < 0 || s.radius > L.MAX_RADIUS_PX || Math.abs(s.rotation) > 360) return { reason: "GEOMETRY", detail: "range" };
    if (s.focal && (!finite(s.focal.x, s.focal.y) || s.focal.x < 0 || s.focal.x > 1 || s.focal.y < 0 || s.focal.y > 1)) return { reason: "GEOMETRY", detail: "focal" };
    const b = s.binding;
    if (!b || typeof b !== "object") return { reason: "BINDING", detail: "missing" };
    if (b.kind === "CELL") {
      if (strategy !== "PER_PARTICIPANT_SHOT") return { reason: "BINDING", detail: "cell-in-group-strategy" };
      if (!Number.isInteger(b.shotIndex) || b.shotIndex < 0 || b.shotIndex >= shotCount) return { reason: "BINDING", detail: "shot-index" };
      if (!participantSlots.includes(b.participantSlot)) return { reason: "BINDING", detail: "participant-slot" };
      const key = `${b.shotIndex}:${b.participantSlot}`;
      if (covered.has(key)) return { reason: "BINDING", detail: "duplicate-cell" };
      covered.add(key);
    } else if (b.kind === "SHOT_GROUP") {
      if (strategy !== "PER_SHOT_GROUP") return { reason: "BINDING", detail: "group-in-cell-strategy" };
      if (!Number.isInteger(b.shotIndex) || b.shotIndex < 0 || b.shotIndex >= shotCount) return { reason: "BINDING", detail: "shot-index" };
      if (!["ROW", "COLUMN", "GRID", "BLEND"].includes(b.arrangement)) return { reason: "BINDING", detail: "arrangement" };
      const key = `${b.shotIndex}`;
      if (covered.has(key)) return { reason: "BINDING", detail: "duplicate-shot" };
      covered.add(key);
    } else if (b.kind === "FREE") {
      if (strategy !== "FREEFORM") return { reason: "BINDING", detail: "free-outside-freeform" };
      if (b.cell && (!Number.isInteger(b.cell.shotIndex) || b.cell.shotIndex < 0 || b.cell.shotIndex >= shotCount || !participantSlots.includes(b.cell.participantSlot)))
        return { reason: "BINDING", detail: "free-cell" };
    } else return { reason: "BINDING", detail: "kind" };
  }
  // Setiap shot (A) / setiap cell (B) wajib punya slot: tidak ada foto yang hilang diam-diam.
  if (strategy === "PER_SHOT_GROUP" && covered.size !== shotCount) return { reason: "BINDING", detail: "missing-shot" };
  if (strategy === "PER_PARTICIPANT_SHOT" && covered.size !== shotCount * n) return { reason: "BINDING", detail: "missing-cell" };
  return null;
}
