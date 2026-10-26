import { Plus } from "lucide-react";
import { Container } from "@/components/layout/Container";
import { LinkButton } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icon-props";
import { BoothWindow } from "./BoothWindow";
import { JoinCodeForm } from "./JoinCodeForm";
import styles from "./Hero.module.css";

const PLAYER_DOTS = ["var(--p1-mid)", "var(--p2-mid)", "var(--p3-mid)", "var(--p4-mid)"];

export function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <Container className={styles.inner}>
        <div className={styles.copy}>
          <p className={styles.info}>
            <span className={styles.dots} aria-hidden="true">
              {PLAYER_DOTS.map((c) => (
                <span key={c} style={{ background: c }} />
              ))}
            </span>
            <span>
              Sampai 4 orang · tanpa akun<span className={styles.hideMobile}> · tanpa host</span>
            </span>
          </p>
          <h1 id="hero-title" className={`dc ${styles.title}`}>
            Photobooth bareng, <span className="s">dari mana aja.</span>
          </h1>
          <p className={styles.lead}>
            Satu room, empat kamera. Cekrek bareng, pilih fotomu sendiri, terus hias hasilnya rame-rame.
          </p>
          <div className={styles.actions}>
            <LinkButton href="/r/new" variant="primary" size="xl" icon={<Plus size={18} {...iconProps} />} className={styles.create}>
              Bikin room
            </LinkButton>
            <JoinCodeForm className={styles.join} />
          </div>
          <p className={styles.note}>Room sementara: foto dan datanya dihapus setelah room kedaluwarsa.</p>
        </div>
        <div className={styles.visual}>
          <BoothWindow />
        </div>
      </Container>
    </section>
  );
}
