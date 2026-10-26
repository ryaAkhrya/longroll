import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./Chip.module.css";

export type ChipTone = "default" | "outline" | "ok" | "warn" | "err" | "neutral";

interface ChipBase {
  tone?: ChipTone;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Chip status/info (non-interaktif). Status selalu ikon + teks (warna bukan satu-satunya pembawa makna). */
export function Chip({ tone = "default", icon, className, children }: ChipBase) {
  return (
    <span className={cx(styles.chip, styles[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

interface ChipButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  selected?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

/** Chip filter/kategori: tombol toggle dengan aria-pressed. */
export function ChipButton({ selected = false, icon, className, children, type = "button", ...rest }: ChipButtonProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cx(styles.chip, styles.button, selected ? styles.active : styles.default, className)}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
