"use client";

import { useEffect, useRef, useState } from "react";
import {
  ARRANGEMENT_LABEL,
  BUILTIN_FRAMES,
  PARTICIPANT_SLOTS,
  STICKER_CATALOG,
  STUDIO_MODE_DEFAULTS,
  builtinFrame,
  createSeededDoc,
  drawDocument,
  generatePlan,
  initStudio,
  setGlobalAdjust,
  setGlobalFilter,
} from "@longroll/shared";
import type { Adjust, Arrangement, Attempt, BindingStrategy, CaptureState, Ctx2D, FilterPresetId, ImageLike, Mode, ParticipantSlot, Shot, StudioState } from "@longroll/shared";
import { documentModel } from "@/render/model";
import { asCtx, makeResources } from "@/render/resources";

/**
 * Lab visual DEV (Phase 3): menggambar frame × susunan lewat jalur render yang SAMA dengan editor/export (`drawDocument`),
 * dengan foto sintetis (potret abstrak) supaya komposisi wajah, crop, dekor, dan tepi bisa diperiksa tanpa membuat room.
 * Hanya tersedia di development (/dev/frames); produksi 404.
 */

const NAMES = ["Nadia", "Raka", "Sasa", "Bimo"];
const HUES = [18, 48, 150, 262];

/** Potret abstrak 4:3: latar gradasi, kepala bulat di ⅓ atas, bahu — wajah di tengah atas seperti selfie. */
function syntheticPhoto(i: number, w = 1600, h = 1200): ImageLike {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const hue = HUES[i % 4]!;
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, `hsl(${hue} 70% 82%)`);
  bg.addColorStop(1, `hsl(${(hue + 40) % 360} 60% 62%)`);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = `hsl(${hue} 45% 30%)`;
  g.beginPath();
  g.ellipse(w / 2, h * 1.02, w * 0.3, h * 0.38, 0, Math.PI, 0);
  g.fill();
  g.fillStyle = `hsl(${(hue + 20) % 360} 55% 78%)`;
  g.beginPath();
  g.arc(w / 2, h * 0.4, h * 0.19, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(27,23,32,.7)";
  for (const dx of [-0.07, 0.07]) {
    g.beginPath();
    g.arc(w / 2 + dx * h, h * 0.38, h * 0.02, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "rgba(255,255,255,.55)";
  g.font = `600 ${h * 0.06}px sans-serif`;
  g.textAlign = "left";
  g.fillText(NAMES[i % 4]!, w * 0.04, h * 0.95);
  return Object.assign(c, { naturalWidth: w, naturalHeight: h });
}

function capture(shotCount: number, pids: string[]): { capture: CaptureState; accepted: Map<string, number> } {
  const attempts: Record<string, Attempt> = {};
  const idx = new Map<string, number>();
  const shots: Shot[] = Array.from({ length: shotCount }, (_, s) => {
    const per: Shot["perParticipant"] = {};
    pids.forEach((pid, i) => {
      const id = `att-${s}-${i}`;
      per[pid] = { status: "ACCEPTED", attempts: [id], currentAttemptId: id, acceptedAttemptId: id, retakeT0ServerMs: null, statusAtMs: 0 };
      attempts[id] = { attemptId: id, shotIndex: s, ownerId: pid, ownerNameAtCapture: NAMES[i]!, ownerColor: PARTICIPANT_SLOTS[i]!, attemptNo: 1, kind: "shot", status: "READY", createdAtMs: 0, capturedAtServerMs: 0, late: false, mirrored: false, preview: { bytes: 1, width: 640, height: 480, sha256: "a".repeat(64) }, full: { bytes: 1, width: 1600, height: 1200, sha256: "b".repeat(64) }, purged: false };
      idx.set(id, i + s);
    });
    return { index: s, state: "DONE", t0ServerMs: 1, armedBy: pids[0]!, armedAtMs: 0, countdownSec: 5, required: pids, slotOf: Object.fromEntries(pids.map((p, i) => [p, PARTICIPANT_SLOTS[i]!])), perParticipant: per, doneAtMs: 1, heldBy: null } satisfies Shot;
  });
  return { capture: { eligible: Object.fromEntries(pids.map((p, i) => [p, PARTICIPANT_SLOTS[i]!])), shotCount, shots, attempts, bytesUsed: 0 }, accepted: idx };
}

export interface LabCase {
  mode: Mode;
  frameId: string;
  arrangement?: Arrangement;
  strategy?: BindingStrategy;
  n: number;
  shots?: number;
  adjust?: Partial<Adjust> | null;
  filter?: FilterPresetId | null;
}

/** Studio untuk satu kasus; null bila generator menolak (safeguard). */
export function studioFor(c: LabCase): StudioState | null {
  const d = STUDIO_MODE_DEFAULTS[c.mode];
  const slots = PARTICIPANT_SLOTS.slice(0, c.n) as ParticipantSlot[];
  const base = initStudio(c.mode, slots);
  const strategy = c.strategy ?? d.bindingStrategy;
  const plan = generatePlan({
    mode: c.mode,
    strategy,
    shotCount: c.shots ?? d.shotCount,
    participantSlots: slots,
    arrangement: (c.arrangement ?? d.arrangement) as Exclude<Arrangement, "CUSTOM">,
    slotRatio: d.slotRatio,
    output: { preset: "AUTO" },
    gap: base.style.gap,
    cornerRadius: base.style.cornerRadius,
  });
  if (!plan.ok) return null;
  return { ...base, layout: plan.layout, bindingStrategy: strategy, frame: { frameId: c.frameId, source: "BUILTIN", adapt: "CONTAIN", overlayOpacity: 1 } };
}

function LabCanvas({ c, scale }: { c: LabCase; scale: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    void (async () => {
      await document.fonts?.ready;
      const studio = studioFor(c);
      if (!studio) return setErr("ditolak generator");
      const pids = PARTICIPANT_SLOTS.slice(0, c.n).map((_, i) => `p${i}`);
      const cap = capture(studio.layout.shotCount, pids);
      const doc = createSeededDoc({ studio, capture: cap.capture, names: Object.fromEntries(pids.map((p, i) => [p, NAMES[i]!])), srcDims: () => ({ w: 1600, h: 1200 }), frameTemplate: builtinFrame(c.frameId) ?? null });
      if (c.adjust) setGlobalAdjust(doc, { participantId: "lab", name: "lab", origin: { lab: 1 }, now: () => 1 }, { ...({ exposure: 0, brightness: 0, contrast: 0, saturation: 0, highlights: 0, shadows: 0, temperature: 0, tint: 0, grain: 0 } as Adjust), ...c.adjust });
      if (c.filter) setGlobalFilter(doc, { participantId: "lab", name: "lab", origin: { lab: 1 }, now: () => 1 }, c.filter);
      const m = documentModel(doc, { custom: [], nameOfColor: (col) => NAMES[PARTICIPANT_SLOTS.indexOf(col as ParticipantSlot)] ?? "", dateMs: Date.UTC(2026, 9, 30) });
      if (!m || !alive) return;
      const photos = new Map<string, ImageLike>();
      cap.accepted.forEach((i, id) => photos.set(id, syntheticPhoto(i)));
      const res = makeResources({ photo: (id) => photos.get(id) ?? null, overlay: null, scale });
      const W = m.meta.canvas.w;
      const H = m.meta.canvas.h;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(W * scale);
      canvas.height = Math.round(H * scale);
      drawDocument(asCtx(canvas.getContext("2d")!) as Ctx2D, m.model, res, scale);
      canvas.style.cssText = "display:block;max-width:100%;height:auto;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.25)";
      canvas.dataset.lab = "ready";
      ref.current?.replaceChildren(canvas);
    })().catch((e) => alive && setErr(String(e).slice(0, 80)));
    return () => {
      alive = false;
    };
  }, [c, scale]);
  return (
    <div ref={ref} style={{ minHeight: 40, color: "#a33", fontSize: 12 }}>
      {err}
    </div>
  );
}

export function FrameLab({ params }: { params: Record<string, string | undefined> }) {
  const mode = (params.mode as Mode) ?? "PHOTO_STRIP";
  const n = Math.min(4, Math.max(1, Number(params.n ?? 3)));
  const view = params.view ?? "frames";
  const scale = Number(params.scale ?? 0.22);
  const d = STUDIO_MODE_DEFAULTS[mode];
  const frames = BUILTIN_FRAMES.filter((f) => (params.all === "1" ? true : f.modes.includes(mode)) && (!params.cat || f.category === params.cat) && (!params.ids || params.ids.split(",").some((k) => f.id.includes(k))));
  const adjust = params.adj ? (Object.fromEntries(params.adj.split(",").map((p) => p.split(":")).map(([k, v]) => [k, Number(v)])) as Partial<Adjust>) : null;
  const strategy = (params.strategy as BindingStrategy | undefined) ?? d.bindingStrategy;
  return (
    <main style={{ padding: 16, background: "#e9e6e0", minHeight: "100dvh", fontFamily: "system-ui" }} data-testid="frame-lab">
      <h1 style={{ margin: "0 0 12px", fontSize: 16 }}>
        Lab {view === "layouts" ? "layout" : view === "stickers" ? "stiker" : "frame"} · {mode} · {n} peserta · {strategy}
      </h1>
      {view === "stickers" ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {STICKER_CATALOG.map((st) => (
            <figure key={st.id} style={{ margin: 0, width: 110, textAlign: "center", fontSize: 11 }}>
              <div style={{ width: 100, height: 100, background: "#fff", borderRadius: 8 }}>
                <svg viewBox="0 0 100 100" width="100" height="100" aria-hidden="true">
                  {st.parts.map((pt, i) => (
                    <path key={i} d={pt.d} fill={pt.fill ?? "none"} stroke={pt.stroke} strokeWidth={pt.strokeWidth} strokeLinecap="round" />
                  ))}
                </svg>
              </div>
              <figcaption>{st.name}</figcaption>
            </figure>
          ))}
        </div>
      ) : view === "layouts" ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
          {(d.arrangements as Arrangement[]).map((a) => (
            <figure key={a} style={{ margin: 0, width: Math.max(160, 600 * scale) }}>
              <LabCanvas c={{ mode, frameId: params.frame ?? d.frameId, arrangement: a, strategy, n, shots: params.shots ? Number(params.shots) : undefined, adjust, filter: (params.filter as FilterPresetId | undefined) ?? null }} scale={scale} />
              <figcaption style={{ fontSize: 12, marginTop: 4 }}>{ARRANGEMENT_LABEL[a]}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
          {frames.map((f) => (
            <figure key={f.id} style={{ margin: 0, width: Math.max(150, 600 * scale) }}>
              <LabCanvas c={{ mode, frameId: f.id, arrangement: params.arr as Arrangement | undefined, strategy, n, shots: params.shots ? Number(params.shots) : undefined, adjust, filter: (params.filter as FilterPresetId | undefined) ?? null }} scale={scale} />
              <figcaption style={{ fontSize: 12, marginTop: 4 }}>{f.name} · {f.category}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </main>
  );
}
