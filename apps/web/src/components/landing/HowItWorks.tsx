import { Container } from "@/components/layout/Container";
import styles from "./HowItWorks.module.css";

const STEPS = [
  { n: "01", title: "Bikin atau gabung", full: "Isi nama panggilan, dapet kode room. Kirim ke temen.", short: "Nama panggilan + kode room." },
  { n: "02", title: "Vote mode", full: "Strip, group shot, grid, atau collage. Mayoritas menang, dikunci per sesi.", short: "Mayoritas menang, dikunci per sesi." },
  { n: "03", title: "Cekrek & pilih", full: "Hitung mundur bareng. Tiap orang pilih fotonya sendiri: pakai atau ulang.", short: "Tiap orang pilih: pakai atau ulang." },
  { n: "04", title: "Hias & simpan", full: "Stiker, teks, coretan, rame-rame. Unduh atau simpan ke Drive.", short: "Stiker, teks, coretan, rame-rame." },
] as const;

export function HowItWorks() {
  return (
    <section id="cara-kerja" className={styles.section} aria-labelledby="how-title">
      <Container>
        <p className="cap">Cara kerja</p>
        <h2 id="how-title" className={`dc ${styles.title}`}>
          Gak ada host. <span className="s">Semua setara.</span>
        </h2>
        <ol className={styles.list}>
          {STEPS.map((s) => (
            <li key={s.n} className={styles.card}>
              <span className={`s ${styles.num}`} aria-hidden="true">
                {s.n}
              </span>
              <div className={styles.body}>
                <h3 className={`d ${styles.name}`}>{s.title}</h3>
                <p className={styles.text}>
                  <span className={styles.full}>{s.full}</span>
                  <span className={styles.short}>{s.short}</span>
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
