"use client";

import { Lock, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ARRANGEMENT_LABEL,
  OUTPUT_PRESETS,
  OUTPUT_PRESET_LABEL,
  SLOT_RATIOS,
  STRATEGY_LABEL,
  STUDIO_LIMITS,
  STUDIO_MODE_DEFAULTS,
  generatePlan,
} from "@longroll/shared";
import type { Arrangement, Mode, OutputPreset, PlanAlternative, SafeguardViolation, SlotGeometry, StudioPatch, StudioState } from "@longroll/shared";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Slider } from "@/components/ui/Slider";
import { Tag } from "@/components/ui/Tag";
import { Toggle } from "@/components/ui/Toggle";
import { iconProps } from "@/components/ui/icon-props";
import { cx } from "@/lib/cx";
import styles from "./panels.module.css";

const SWATCHES = ["#FFFFFF", "#F6F3EE", "#1B1720", "#FBE4D8", "#DCD2F6", "#D5EADF"];
const LOCK_HINT = "Dikunci setelah shot pertama";

interface LayoutPanelProps {
  studio: StudioState;
  mode: Mode;
  send: (patch: StudioPatch) => Promise<unknown>;
  editSlots: boolean;
  onEditSlots: (on: boolean) => void;
  selectedSlotId: string | null;
  compact?: boolean;
}

/**
 * SCR-11 Layout & kanvas: susunan, strategi foto (DEC-061 OPEN: kontrol usulan), jumlah shot, rasio slot,
 * preset output, jarak, radius, latar, edit slot manual. Safeguard (DEC-042) dicek LOKAL dulu: bila
 * dilanggar, muncul alasan + alternatif dan TIDAK ada yang dikirim/dipotong diam-diam (TC-FRAME-006).
 */
export function LayoutPanel({ studio, mode, send, editSlots, onEditSlots, selectedSlotId, compact }: LayoutPanelProps) {
  const d = STUDIO_MODE_DEFAULTS[mode];
  const locked = studio.structureLocked;
  const L = studio.layout;
  const [violation, setViolation] = useState<{ v: number; violation: SafeguardViolation } | null>(null);
  const shown = violation && violation.v === studio.version ? violation.violation : null;
  const arrangement = (L.arrangement === "CUSTOM" ? d.arrangement : L.arrangement) as Exclude<Arrangement, "CUSTOM">;

  const planFor = (patch: StudioPatch) =>
    generatePlan({
      mode,
      strategy: patch.bindingStrategy ?? studio.bindingStrategy,
      shotCount: patch.shotCount ?? L.shotCount,
      participantSlots: studio.participantSlots,
      arrangement: patch.arrangement ?? arrangement,
      slotRatio: patch.slotRatio ?? L.slotRatio,
      output: patch.output ?? (L.sourceFrameId ? { preset: "AUTO" } : L.output),
      gap: patch.style?.gap ?? studio.style.gap,
      cornerRadius: patch.style?.cornerRadius ?? studio.style.cornerRadius,
    });

  /** Perubahan struktur: cek safeguard lokal → kirim, atau tampilkan alasan + alternatif. */
  const propose = (patch: StudioPatch) => {
    const r = planFor(patch);
    if (!r.ok) {
      setViolation({ v: studio.version, violation: r.violation });
      return;
    }
    setViolation(null);
    void send(patch);
  };
  const applyAlt = (a: PlanAlternative) => propose(a.patch);

  const current = planFor({});
  const warnings = L.arrangement !== "CUSTOM" && current.ok ? current.warnings : [];

  // Jarak & radius: nilai lokal saat menggeser, dikirim setelah jeda singkat (bukan per piksel).
  const [style, setStyle] = useState<{ v: number; gap: number; radius: number } | null>(null);
  const gap = style && style.v === studio.version ? style.gap : studio.style.gap;
  const radius = style && style.v === studio.version ? style.radius : studio.style.cornerRadius;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const setStyleLater = (next: { gap: number; radius: number }) => {
    setStyle({ v: studio.version, ...next });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const patch: StudioPatch = { style: {} };
      if (next.gap !== studio.style.gap) patch.style!.gap = next.gap;
      if (next.radius !== studio.style.cornerRadius) patch.style!.cornerRadius = next.radius;
      if (Object.keys(patch.style!).length) propose(patch);
    }, 300);
  };

  const selected = L.slots.find((s) => s.id === selectedSlotId) ?? null;
  const nudge = (g: Partial<SlotGeometry>) => selected && void send({ slots: [{ id: selected.id, x: selected.x, y: selected.y, w: selected.w, h: selected.h, ...g }] });

  const lockAttrs = locked ? { disabled: true, title: LOCK_HINT } : {};
  const maxShots = Math.min(STUDIO_LIMITS.MAX_SHOTS, d.maxShots);

  return (
    <div className={cx(styles.panel, compact && styles.compact)}>
      <header className={styles.head}>
        <h2 className={styles.title}>Layout</h2>
        <Tag kind="bareng" />
        {locked && (
          <span className={styles.lockNote} title={LOCK_HINT}>
            <Lock size={13} {...iconProps} /> {LOCK_HINT}
          </span>
        )}
      </header>

      {shown && (
        <Banner
          tone="warn"
          action={
            <span className={styles.alts}>
              {shown.alternatives.map((a) => (
                <Button key={a.label} size="sm" variant="secondary" onClick={() => applyAlt(a)}>
                  {a.label}
                </Button>
              ))}
            </span>
          }
        >
          {shown.message}
        </Banner>
      )}
      {!shown &&
        warnings.map((w) => (
          <Banner
            key={w.code}
            tone="info"
            action={
              <span className={styles.alts}>
                {w.alternatives.map((a) => (
                  <Button key={a.label} size="sm" variant="secondary" onClick={() => applyAlt(a)} {...lockAttrs}>
                    {a.label}
                  </Button>
                ))}
              </span>
            }
          >
            {w.message}
          </Banner>
        ))}

      {d.arrangements.length > 1 && (
        <fieldset className={styles.field}>
          <legend>Susunan</legend>
          <div className={styles.segment} role="radiogroup" aria-label="Susunan">
            {(d.arrangements as Exclude<Arrangement, "CUSTOM">[]).map((a) => (
              <button key={a} type="button" role="radio" aria-checked={L.arrangement === a} className={cx(styles.segItem, L.arrangement === a && styles.segOn)} onClick={() => propose({ arrangement: a })} {...lockAttrs}>
                {ARRANGEMENT_LABEL[a]}
              </button>
            ))}
            {L.arrangement === "CUSTOM" && (
              <span role="radio" aria-checked className={cx(styles.segItem, styles.segOn)}>
                {ARRANGEMENT_LABEL.CUSTOM}
              </span>
            )}
          </div>
        </fieldset>
      )}

      {d.strategies.length > 1 && (
        <fieldset className={styles.field}>
          <legend>Isi tiap kotak</legend>
          <div className={styles.segment} role="radiogroup" aria-label="Strategi foto">
            {d.strategies.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={studio.bindingStrategy === s} className={cx(styles.segItem, studio.bindingStrategy === s && styles.segOn)} onClick={() => propose({ bindingStrategy: s })} {...lockAttrs}>
                {STRATEGY_LABEL[s]}
              </button>
            ))}
          </div>
          <p className={styles.note}>Bisa diganti sampai shot pertama.</p>
        </fieldset>
      )}

      <fieldset className={styles.field}>
        <legend>Jumlah shot</legend>
        <div className={styles.stepper}>
          <Button variant="secondary" size="sm" iconOnly aria-label="Kurangi shot" onClick={() => propose({ shotCount: L.shotCount - 1 })} disabled={locked || L.shotCount <= 1} title={locked ? LOCK_HINT : undefined}>
            <Minus size={16} {...iconProps} />
          </Button>
          <output className="dc tnum" aria-live="polite" aria-label={`${L.shotCount} shot`}>
            {L.shotCount}
          </output>
          <Button variant="secondary" size="sm" iconOnly aria-label="Tambah shot" onClick={() => propose({ shotCount: L.shotCount + 1 })} {...lockAttrs}>
            <Plus size={16} {...iconProps} />
          </Button>
          <span className={styles.note}>maks. {maxShots}</span>
        </div>
      </fieldset>

      <fieldset className={styles.field}>
        <legend>Rasio slot</legend>
        <div className={styles.segment} role="radiogroup" aria-label="Rasio slot">
          {SLOT_RATIOS.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={L.slotRatio === r} className={cx(styles.segItem, L.slotRatio === r && styles.segOn)} onClick={() => propose({ slotRatio: r })} {...lockAttrs}>
              {r}
            </button>
          ))}
        </div>
      </fieldset>

      <label className={styles.field}>
        <span className={styles.legend}>Ukuran hasil</span>
        <select
          className={styles.select}
          value={L.output.preset}
          onChange={(e) => propose({ output: { preset: e.target.value as Exclude<OutputPreset, "CUSTOM"> } })}
          {...lockAttrs}
        >
          {OUTPUT_PRESETS.filter((p) => p !== "CUSTOM" || L.output.preset === "CUSTOM").map((p) => (
            <option key={p} value={p} disabled={p === "CUSTOM"}>
              {OUTPUT_PRESET_LABEL[p]}
            </option>
          ))}
        </select>
        <span className={styles.note}>
          {L.canvas.widthPx}×{L.canvas.heightPx} px dasar
        </span>
      </label>

      <Slider label="Jarak antar foto" value={gap} min={0} max={STUDIO_LIMITS.MAX_GAP_PX} step={1} onChange={(v) => setStyleLater({ gap: Math.round(v), radius })} format={(v) => `${Math.round(v)} px`} />
      <Slider label="Radius sudut" value={radius} min={0} max={80} step={1} onChange={(v) => setStyleLater({ gap, radius: Math.round(v) })} format={(v) => `${Math.round(v)} px`} />

      <fieldset className={styles.field}>
        <legend>Warna latar</legend>
        <div className={styles.swatches} role="radiogroup" aria-label="Warna latar">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={studio.style.bgColor === c}
              aria-label={c}
              className={cx(styles.colorDot, studio.style.bgColor === c && styles.colorOn)}
              style={{ background: c }}
              onClick={() => void send({ style: { bgColor: c } })}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.field}>
        <Toggle label="Atur slot manual" checked={editSlots} onChange={onEditSlots} disabled={locked} />
        {editSlots && !selected && <p className={styles.note}>Ketuk slot di pratinjau buat geser / ubah ukuran. Tahan Shift = jaga rasio.</p>}
        {editSlots && selected && (
          <div className={styles.numeric} aria-label={`Slot ${selected.id}`}>
            {(["x", "y", "w", "h"] as const).map((k) => (
              <label key={k}>
                <span>{{ x: "X", y: "Y", w: "Lebar", h: "Tinggi" }[k]}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={Math.round(selected[k])}
                  min={k === "w" || k === "h" ? STUDIO_LIMITS.MIN_SLOT_PX : undefined}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) nudge({ [k]: v });
                  }}
                />
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}
