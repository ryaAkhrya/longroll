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
  /** Format nilai di kanan (tabular). */
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
}

/** Slider: track 4 px, isi plum, thumb 20 px; label kiri, nilai kanan (05 §7). Native range = aksesibel. */
export function Slider({ label, value, min, max, step = 0.01, onChange, format, disabled, className }: SliderProps) {
  const id = useId();
  const pct = ((value - min) / (max - min)) * 100;
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
        style={{ "--pct": `${pct}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
