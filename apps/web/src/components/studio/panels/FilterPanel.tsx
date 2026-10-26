"use client";

import { FILTER_PRESETS } from "@longroll/shared";
import type { FilterPresetId } from "@longroll/shared";
import { Tag } from "@/components/ui/Tag";
import { cx } from "@/lib/cx";
import styles from "./panels.module.css";

/** Filter grup (05 §12): preset bersama untuk semua foto; nilai CSS sama dengan export (`ctx.filter`). */
export function FilterPanel({ value, onChange, compact }: { value: FilterPresetId; onChange: (id: FilterPresetId) => void; compact?: boolean }) {
  return (
    <div className={cx(styles.panel, compact && styles.compact)}>
      <header className={styles.head}>
        <h2 className={styles.title}>Filter</h2>
        <Tag kind="bareng" />
      </header>
      <p className={styles.note}>Filter berlaku buat semua foto. Kecerahan & kehangatan kamera sendiri ada di Kameraku.</p>
      <div className={styles.filters} role="radiogroup" aria-label="Filter grup">
        {FILTER_PRESETS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={value === f.id}
            className={cx(styles.filter, value === f.id && styles.filterOn)}
            onClick={() => value !== f.id && onChange(f.id)}
          >
            <span className={styles.swatch} style={{ filter: f.css === "none" ? undefined : f.css }} aria-hidden="true" />
            <span>{f.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
