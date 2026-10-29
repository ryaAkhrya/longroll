import { Wordmark } from "@/components/brand/Wordmark";
import { Container } from "@/components/layout/Container";
import styles from "./LandingFooter.module.css";

export function LandingFooter() {
  return (
    <footer className={styles.footer}>
      <Container className={styles.inner}>
        <Wordmark size={20} />
        <small>© 2026 LONGROLL</small>
      </Container>
    </footer>
  );
}
