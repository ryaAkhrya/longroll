import { cx } from "@/lib/cx";
import styles from "./PreviewBadge.module.css";

/** Penanda mode dev: layout memakai data contoh, bukan fitur yang berfungsi (P01 §23). */
export function PreviewBadge({ derived, className }: { derived?: boolean; className?: string }) {
  return (
    <p className={cx(styles.badge, className)} role="note">
      <strong>Pratinjau dev</strong> · data contoh, belum berfungsi
      {derived && " · DERIVED — belum disetujui visual"}
    </p>
  );
}
