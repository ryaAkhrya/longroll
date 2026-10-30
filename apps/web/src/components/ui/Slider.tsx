"use client";

import { useId } from "react";
import type { CSSProperties } from "react";
import { cx } from "@/lib/cx";
import styles from "./Slider.module.css";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** Dipanggil SEKALI saat interaksi selesai (lepas jari/mouse, tombol panah dilepas, blur). Untuk menyimpan nilai akhir setelah pratinjau langsung. */
  onCommit?: (value: number) => void;
  /** Format nilai di kanan (tabular). */
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

/** Slider: track 4 px, isi plum, thumb 20 px; label kiri, nilai kanan (05 §7). Native range = aksesibel. */
export function Slider({ label, value, min, max, step = 0.01, onChange, onCommit, format, disabled, className }: SliderProps) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
  // Rentang yang melewati 0 (mis. -100..100): isian dimulai dari titik nol, bukan dari ujung kiri.
  const zero = min < 0 && max > 0 ? ((0 - min) / (max - min)) * 100 : 0;
  const lo = Math.min(zero, pct);
  const hi = Math.max(zero, pct);
  const commit = (el: HTMLInputElement) => onCommit?.(Number(el.value));
  return (
    <div className={cx(styles.field, className)}>
      <div className={styles.head}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        <span className={cx(styles.value, "tnum")} aria-hidden="true">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format ? format(value) : undefined}
        className={styles.range}
        style={{ "--pct": `${pct}%`, "--lo": `${lo}%`, "--hi": `${hi}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => commit(e.currentTarget)}
        onKeyUp={(e) => /^(Arrow|Page|Home|End)/.test(e.key) && commit(e.currentTarget)}
        onBlur={(e) => commit(e.currentTarget)}
      />
    </div>
  );
}
