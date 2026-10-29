import { Plus } from "lucide-react";
import { Container } from "@/components/layout/Container";
import { LinkButton } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icon-props";
import { BoothWindow } from "./BoothWindow";
import { JoinCodeForm } from "./JoinCodeForm";
import styles from "./Hero.module.css";

export function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <Container className={styles.inner}>
        <div className={styles.copy}>
          <h1 id="hero-title" className={`dc ${styles.title}`}>
            Photobooth bareng, <span className="s">dari mana aja.</span>
          </h1>
          <p className={styles.lead}>Ambil foto bareng teman yang berjauhan. Kalian masuk ke satu room, foto serentak, lalu mengedit hasilnya bersama.</p>
          <div className={styles.actions}>
            <LinkButton href="/r/new" variant="primary" size="xl" icon={<Plus size={18} {...iconProps} />} className={styles.create}>
              Bikin room
            </LinkButton>
            <JoinCodeForm className={styles.join} />
          </div>
          <p className={styles.note}>Sampai 4 orang, tanpa akun. Room bersifat sementara: foto dan datanya dihapus setelah room kedaluwarsa.</p>
        </div>
        <div className={styles.visual}>
          <BoothWindow />
        </div>
      </Container>
    </section>
  );
}
