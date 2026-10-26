import type { PlayerColor } from "@longroll/shared";
import { PhotoStrip } from "@/components/brand/PhotoStrip";
import { SampleShot } from "@/components/brand/SampleShot";
import { Avatar } from "@/components/ui/Avatar";
import { cx } from "@/lib/cx";
import styles from "./BoothWindow.module.css";

const TILES: { name: string; color: PlayerColor; self?: boolean }[] = [
  { name: "Kamu", color: "P1", self: true },
  { name: "Raka", color: "P2" },
  { name: "Sasa", color: "P3" },
  { name: "Bimo", color: "P4" },
];

/**
 * "Booth window" statis: ilustrasi 4 kamera + countdown + strip miring.
 * Murni gambar (aset netral, bukan foto orang), jadi dibungkus role="img" dengan deskripsi teks.
 */
export function BoothWindow() {
  return (
    <div
      className={styles.wrap}
      role="img"
      aria-label="Ilustrasi booth LONGROLL: empat kamera dalam satu room dengan hitung mundur, dan strip foto hasilnya."
    >
      <div className={styles.window} aria-hidden="true">
        <div className={styles.bar}>
          <span className={styles.live}>
            <span className={styles.dot} />4 kamera live
          </span>
          <span className={styles.shot}>Shot 2 dari 4</span>
        </div>
        <div className={styles.grid}>
          {TILES.map((t) => (
            <div key={t.name} className={cx(styles.tile, t.self && styles.self)}>
              <SampleShot color={t.color} />
              <span className={styles.name}>
                <Avatar name={t.name} color={t.color} size={18} />
                {t.name}
              </span>
            </div>
          ))}
          <span className={cx(styles.count, "dc")}>2</span>
        </div>
      </div>
      <PhotoStrip tape className={styles.strip} />
    </div>
  );
}
