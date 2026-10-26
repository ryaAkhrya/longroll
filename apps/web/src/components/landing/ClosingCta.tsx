import { Lock, Plus, Timer, Users } from "lucide-react";
import { Wordmark } from "@/components/brand/Wordmark";
import { Container } from "@/components/layout/Container";
import { iconProps } from "@/components/ui/icon-props";
import { LinkButton } from "@/components/ui/Button";
import { FocusJoinButton } from "./FocusJoinButton";
import styles from "./ClosingCta.module.css";

const FACTS = [
  { icon: Users, text: "Maks 4 orang, semua setara" },
  { icon: Lock, text: "Cukup nama panggilan, tanpa akun" },
  { icon: Timer, text: "Room & foto dihapus setelah kedaluwarsa" },
] as const;

/** CTA penutup tema stage + 3 fakta + footer. */
export function ClosingCta() {
  return (
    <div className={styles.stage} data-theme="stage">
      <Container>
        <section className={styles.cta} aria-labelledby="cta-title">
          <h2 id="cta-title" className={`dc ${styles.title}`}>
            Temen udah nunggu? <span className="s">Bikin room-nya.</span>
          </h2>
          <div className={styles.buttons}>
            <LinkButton href="/r/new" variant="primary" size="xl" icon={<Plus size={18} {...iconProps} />} className={styles.create}>
              Bikin room
            </LinkButton>
            <FocusJoinButton variant="secondary" size="xl" className={styles.join}>
              Gabung pakai kode
            </FocusJoinButton>
          </div>
        </section>
        <ul className={styles.facts}>
          {FACTS.map(({ icon: Icon, text }) => (
            <li key={text}>
              <Icon size={16} {...iconProps} />
              {text}
            </li>
          ))}
        </ul>
        <footer className={styles.footer}>
          <Wordmark size={20} tone="dark" />
          <small>© 2026 LONGROLL</small>
        </footer>
      </Container>
    </div>
  );
}
