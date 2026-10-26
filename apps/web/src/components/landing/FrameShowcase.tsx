import type { CSSProperties } from "react";
import { Container } from "@/components/layout/Container";
import { FrameArt } from "./FrameArt";
import type { FrameStyle } from "./FrameArt";
import styles from "./FrameShowcase.module.css";

const FRAMES: { id: FrameStyle; name: string; category: string; width: number }[] = [
  { id: "seoul", name: "Seoul Strip", category: "Korean", width: 98 },
  { id: "editorial", name: "Editorial", category: "Minimal", width: 184 },
  { id: "film", name: "Film 400", category: "Retro", width: 112 },
  { id: "scrapbook", name: "Scrapbook", category: "Scrapbook", width: 204 },
  { id: "lilac", name: "Lilac Dream", category: "Pastel", width: 122 },
  { id: "mosaic", name: "Mosaic", category: "Grid custom", width: 170 },
];

export function FrameShowcase() {
  return (
    <section id="frame" className={styles.section} aria-labelledby="frame-title">
      <Container>
        <div className={styles.head}>
          <div>
            <p className="cap">Frame</p>
            <h2 id="frame-title" className={`dc ${styles.title}`}>
              Satu sesi, <span className="s">banyak gaya.</span>
            </h2>
          </div>
          <p className={styles.blurb}>
            Dari strip ala booth Seoul sampai scrapbook. Ganti frame kapan aja, semua orang langsung lihat. Bisa juga upload frame sendiri.
          </p>
        </div>
      </Container>
      <div className={styles.scroller} role="region" aria-label="Contoh gaya frame" tabIndex={0}>
        <ul className={styles.row}>
          {FRAMES.map((f) => (
            <li key={f.id} className={styles.item} data-frame={f.id} style={{ "--w": `${f.width}px` } as CSSProperties}>
              <div className={styles.art}>
                <FrameArt style={f.id} />
              </div>
              <p className={styles.name}>{f.name}</p>
              <p className={styles.cat}>{f.category}</p>
            </li>
          ))}
        </ul>
      </div>
      <Container>
        <p className={styles.hint}>Geser buat lihat Editorial, Mosaic, dan frame buatanmu sendiri →</p>
      </Container>
    </section>
  );
}
