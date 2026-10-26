import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";
import { Container } from "@/components/layout/Container";
import { FocusJoinButton } from "./FocusJoinButton";
import styles from "./LandingNav.module.css";

export function LandingNav() {
  return (
    <header className={styles.header}>
      <Container className={styles.inner}>
        <Link href="/" aria-label="LONGROLL, beranda" className={styles.logo}>
          <Wordmark size={26} />
        </Link>
        <nav aria-label="Utama" className={styles.nav}>
          <a href="#cara-kerja">Cara kerja</a>
          <a href="#frame">Frame</a>
        </nav>
        <FocusJoinButton variant="secondary" size="md" className={styles.join}>
          <span className={styles.long}>Gabung pakai kode</span>
          <span className={styles.short}>Gabung</span>
        </FocusJoinButton>
      </Container>
    </header>
  );
}
