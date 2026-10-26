import type { PlayerColor } from "@longroll/shared";
import { cx } from "@/lib/cx";
import styles from "./SampleShot.module.css";

interface SampleShotProps {
  color: PlayerColor;
  /** Lingkaran panduan samar di tengah (gaya V1). */
  guide?: boolean;
  className?: string;
}

/**
 * Pengganti foto netral untuk landing/ilustrasi: gradien warna pemain, tanpa orang sungguhan
 * (aset contoh harus berlisensi jelas, P01 §14). Dekoratif.
 */
export function SampleShot({ color, guide = true, className }: SampleShotProps) {
  return <span aria-hidden="true" className={cx(styles.shot, styles[color], guide && styles.guide, className)} />;
}
