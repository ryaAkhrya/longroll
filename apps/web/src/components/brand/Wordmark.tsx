import { cx } from "@/lib/cx";
import { LogoMark } from "./LogoMark";
import styles from "./Wordmark.module.css";

interface WordmarkProps {
  /** Ukuran font wordmark (px). Minimum 16 UI / 24 marketing (05 §1.1). */
  size?: number;
  tone?: "light" | "dark";
  /** Tampilkan mark di kiri teks. */
  withMark?: boolean;
  className?: string;
}

/** Lockup horizontal: mark = 1.12 x font, jarak = 0.32 x font. Teks selalu huruf kecil. */
export function Wordmark({ size = 24, tone, withMark = true, className }: WordmarkProps) {
  return (
    <span
      className={cx(styles.root, tone === "dark" && styles.dark, className)}
      style={{ fontSize: size }}
    >
      {withMark && <LogoMark height={size * 1.12} tone={tone} decorative />}
      <span className={cx("dc", styles.text)}>longroll</span>
    </span>
  );
}
