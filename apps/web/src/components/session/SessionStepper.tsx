import { Check } from "lucide-react";
import type { SessionState } from "@longroll/shared";
import { iconProps } from "@/components/ui/icon-props";
import { cx } from "@/lib/cx";
import styles from "./SessionStepper.module.css";

const STEPS = [
  { key: "vote", label: "Vote" },
  { key: "foto", label: "Foto" },
  { key: "edit", label: "Edit" },
  { key: "hasil", label: "Hasil" },
] as const;

function activeIndex(state: SessionState): number {
  if (state === "VOTING") return 0;
  if (state === "STUDIO" || state === "CAPTURING") return 1;
  if (state === "EDITING") return 2;
  return 3;
}

/** Stepper sesi (04 §0.2, 05 §9): aktif = surface, selesai = centang, mendatang = 45%. Informasi, bukan navigasi. */
export function SessionStepper({ state, className }: { state: SessionState; className?: string }) {
  const active = activeIndex(state);
  return (
    <ol className={cx(styles.stepper, className)} aria-label="Tahap sesi">
      {STEPS.map((s, i) => (
        <li key={s.key} className={cx(styles.step, i === active && styles.active, i < active && styles.done)} aria-current={i === active ? "step" : undefined}>
          {i < active && <Check size={13} {...iconProps} />}
          {s.label}
        </li>
      ))}
    </ol>
  );
}
