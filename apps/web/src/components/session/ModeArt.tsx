import type { Mode } from "@longroll/shared";
import { SampleShot } from "@/components/brand/SampleShot";
import { FrameArt } from "@/components/landing/FrameArt";
import styles from "./ModeArt.module.css";

/** Pratinjau statis per mode (P04 §12: gambar contoh; renderer frame asli di P05). Dekoratif. */
export function ModeArt({ mode }: { mode: Mode }) {
  if (mode === "PHOTO_STRIP")
    return (
      <span className={styles.strip} aria-hidden="true">
        <FrameArt style="seoul" />
      </span>
    );
  if (mode === "PHOTO_GRID")
    return (
      <span className={styles.grid} aria-hidden="true">
        <FrameArt style="mosaic" />
      </span>
    );
  if (mode === "FREEFORM_COLLAGE")
    return (
      <span className={styles.collage} aria-hidden="true">
        <FrameArt style="scrapbook" />
      </span>
    );
  return (
    <span className={styles.group} aria-hidden="true">
      <span className={styles.groupCard}>
        <span className={styles.groupRow}>
          {(["P1", "P2", "P3", "P4"] as const).map((c) => (
            <span key={c} className={styles.groupCell}>
              <SampleShot color={c} />
            </span>
          ))}
        </span>
        <span className={styles.groupFoot}>
          <span className="s">kita berempat</span>
          <span className={styles.mono}>2026.10.25</span>
        </span>
      </span>
    </span>
  );
}
