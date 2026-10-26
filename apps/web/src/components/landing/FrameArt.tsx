import type { PlayerColor } from "@longroll/shared";
import { LogoMark } from "@/components/brand/LogoMark";
import { SampleShot } from "@/components/brand/SampleShot";
import { cx } from "@/lib/cx";
import styles from "./FrameArt.module.css";

export type FrameStyle = "seoul" | "editorial" | "film" | "scrapbook" | "lilac" | "mosaic";

const C: PlayerColor[] = ["P1", "P2", "P3", "P4"];

/** Ilustrasi 6 gaya frame V1 (05 §12) dengan CSS murni dan SampleShot netral. Dekoratif. */
export function FrameArt({ style }: { style: FrameStyle }) {
  switch (style) {
    case "seoul":
      return (
        <span aria-hidden="true" className={cx(styles.art, styles.seoul)}>
          {C.map((c) => (
            <span key={c} className={styles.seoulCell}>
              <SampleShot color={c} />
            </span>
          ))}
          <span className={styles.seoulFoot}>
            <LogoMark height={11} decorative />
            <span className={styles.mono}>2026.10.25</span>
          </span>
        </span>
      );
    case "editorial":
      return (
        <span aria-hidden="true" className={cx(styles.art, styles.editorial)}>
          <span className={styles.edBig}>
            <SampleShot color="P1" />
          </span>
          <span className={styles.edRow}>
            {(["P2", "P3", "P4"] as const).map((c) => (
              <span key={c}>
                <SampleShot color={c} guide={false} />
              </span>
            ))}
          </span>
          <span className={cx("s", styles.edCaption)}>Sabtu malam</span>
          <span className={styles.edNames}>NADIA · RAKA · SASA · BIMO</span>
        </span>
      );
    case "film":
      return (
        <span aria-hidden="true" className={cx(styles.art, styles.film)}>
          {C.map((c, i) => (
            <span key={c} className={styles.filmCell}>
              <SampleShot color={c} />
              <span className={styles.filmNo}>{`${i + 1}A`}</span>
            </span>
          ))}
        </span>
      );
    case "scrapbook":
      return (
        <span aria-hidden="true" className={cx(styles.art, styles.scrap)}>
          <span className={styles.tape} />
          {C.map((c, i) => (
            <span key={c} className={cx(styles.polaroid, styles[`pol${i}`])}>
              <SampleShot color={c} guide={false} />
            </span>
          ))}
          <span className={cx("s", styles.scrapCaption)}>jangan lupa kita ✶</span>
        </span>
      );
    case "lilac":
      return (
        <span aria-hidden="true" className={cx(styles.art, styles.lilac)}>
          {(["P1", "P2", "P3"] as const).map((c) => (
            <span key={c} className={styles.lilacCell}>
              <SampleShot color={c} />
            </span>
          ))}
          <span className={cx("s", styles.lilacText)}>♡ besties ♡</span>
        </span>
      );
    case "mosaic":
      return (
        <span aria-hidden="true" className={cx(styles.art, styles.mosaic)}>
          <span className={styles.mosBig}>
            <SampleShot color="P1" />
          </span>
          {(["P2", "P3", "P4", "P1", "P3"] as const).map((c, i) => (
            <span key={i} className={styles.mosSmall}>
              <SampleShot color={c} guide={false} />
            </span>
          ))}
          <span className={styles.mosFoot}>
            <b>sesi 3</b>
            <span className={styles.mono}>6/6</span>
          </span>
        </span>
      );
  }
}
