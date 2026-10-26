import { cx } from "@/lib/cx";
import styles from "./Spinner.module.css";

interface SpinnerProps {
  size?: number;
  /** Label untuk screen reader; kosong = dekoratif (mis. di dalam tombol yang sudah berlabel). */
  label?: string;
  className?: string;
}

export function Spinner({ size = 16, label, className }: SpinnerProps) {
  return (
    <span
      className={cx(styles.root, className)}
      style={{ width: size, height: size }}
      {...(label ? { role: "status", "aria-label": label } : { "aria-hidden": true })}
    >
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}
