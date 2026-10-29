import { Container } from "@/components/layout/Container";
import styles from "./HowItWorks.module.css";

const STEPS = [
  { title: "Bikin atau gabung", text: "Isi nama panggilan, lalu kirim kode atau link room ke teman." },
  { title: "Pilih mode", text: "Strip, group shot, grid, atau collage. Pilihan terbanyak dikunci untuk satu sesi." },
  { title: "Ambil foto", text: "Hitung mundur berjalan bersamaan. Tiap orang memilih foto sendiri: pakai atau ulang." },
  { title: "Hias dan simpan", text: "Tambah stiker, teks, dan coretan bersama-sama, lalu unduh atau simpan ke Google Drive." },
] as const;

export function HowItWorks() {
  return (
    <section id="cara-kerja" className={styles.section} aria-labelledby="how-title">
      <Container>
        <h2 id="how-title" className={`dc ${styles.title}`}>
          Cara kerja
        </h2>
        <ol className={styles.list}>
          {STEPS.map((s, i) => (
            <li key={s.title} className={styles.step}>
              <span className={`s ${styles.num}`} aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <h3 className={`d ${styles.name}`}>{s.title}</h3>
                <p className={styles.text}>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
