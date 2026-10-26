"use client";

import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./Input.module.css";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label: string;
  hideLabel?: boolean;
  hint?: ReactNode;
  /** Pesan error; mengaktifkan state error + aria-invalid. */
  error?: string;
  /** Mis. "5/20"; ditampilkan di kanan dalam input. */
  counter?: string;
}

/** Input teks 52 px, font 16 px (cegah zoom iOS). Error diumumkan lewat aria-live. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hideLabel, hint, error, counter, id, className, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const hintId = `${inputId}-hint`;
  const errId = `${inputId}-err`;
  const describedBy = [hint && !error ? hintId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={inputId} className={hideLabel ? "sr-only" : styles.label}>
        {label}
      </label>
      <div className={cx(styles.wrap, error && styles.invalid)}>
        <input
          ref={ref}
          id={inputId}
          className={styles.input}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
        {counter && <span className={cx(styles.counter, "tnum")}>{counter}</span>}
      </div>
      {hint && !error && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
      <p id={errId} className={styles.error} aria-live="polite">
        {error}
      </p>
    </div>
  );
});
