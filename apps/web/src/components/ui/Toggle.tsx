"use client";

import { useId } from "react";
import { cx } from "@/lib/cx";
import styles from "./Toggle.module.css";

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Sembunyikan label secara visual (tetap untuk pembaca layar). */
  hideLabel?: boolean;
  className?: string;
}

/** Toggle 40×24, knob 18, aktif plum (stage: putih) — 05 §7. Semantik `role="switch"`. */
export function Toggle({ label, checked, onChange, disabled, hideLabel, className }: ToggleProps) {
  const id = useId();
  return (
    <span className={cx(styles.row, className)}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : styles.label}>
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={cx(styles.track, checked && styles.on)}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.knob} aria-hidden="true" />
      </button>
    </span>
  );
}
