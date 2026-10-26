import type { PlayerColor } from "@longroll/shared";
import { cx } from "@/lib/cx";
import { LogoMark } from "./LogoMark";
import { SampleShot } from "./SampleShot";
import styles from "./PhotoStrip.module.css";

const ORDER: PlayerColor[] = ["P1", "P2", "P3", "P4"];

interface PhotoStripProps {
  /** Strip kosong = slot belum terisi (ilustrasi "room bubar", form). */
  empty?: boolean;
  date?: string;
  /** Selotip lavender di atas strip. */
  tape?: boolean;
  className?: string;
}

/** Ilustrasi strip 4 frame (gaya Seoul Strip). Lebar mengikuti wadah. Dekoratif. */
export function PhotoStrip({ empty, date = "2026.10.25", tape, className }: PhotoStripProps) {
  return (
    <span aria-hidden="true" className={cx(styles.strip, className)}>
      {tape && <span className={styles.tape} />}
      {ORDER.map((c) => (
        <span key={c} className={cx(styles.cell, empty && styles.empty)}>
          {!empty && <SampleShot color={c} />}
        </span>
      ))}
      <span className={styles.foot}>
        <LogoMark height={12} decorative />
        <span className={styles.date}>{date}</span>
      </span>
    </span>
  );
}
