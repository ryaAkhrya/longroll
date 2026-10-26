"use client";

import { useId, useState } from "react";
import { normalizeRoomCode, ROOM_CODE_LENGTH } from "@longroll/shared";
import { cx } from "@/lib/cx";
import styles from "./CodeInput.module.css";

interface CodeInputProps {
  value: string;
  onChange: (code: string) => void;
  label?: string;
  error?: string;
  disabled?: boolean;
  /** Terkunci bila kode datang dari link. */
  readOnly?: boolean;
  onComplete?: (code: string) => void;
  autoFocus?: boolean;
}

/**
 * Kode room: tampilan 6 kotak, secara teknis SATU <input> (paste 6 karakter langsung terisi).
 * Normalisasi: huruf besar + alfabet DEC-022 (validasi UI saja).
 */
export function CodeInput({ value, onChange, label = "Kode room", error, disabled, readOnly, onComplete, autoFocus }: CodeInputProps) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const cells = Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => value[i] ?? "");
  const active = focused && !readOnly ? Math.min(value.length, ROOM_CODE_LENGTH - 1) : -1;

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={cx(styles.boxes, error && styles.invalid, disabled && styles.disabled)}>
        <input
          id={id}
          className={styles.input}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          autoFocus={autoFocus}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const next = normalizeRoomCode(e.target.value);
            onChange(next);
            if (next.length === ROOM_CODE_LENGTH) onComplete?.(next);
          }}
        />
        {cells.map((ch, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cx(styles.cell, "dc", "tnum", i === active && styles.active)}
          >
            {ch}
          </span>
        ))}
      </div>
      <p id={`${id}-err`} className={styles.error} aria-live="polite">
        {error}
      </p>
    </div>
  );
}
