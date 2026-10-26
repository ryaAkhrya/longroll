import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Wordmark } from "@/components/brand/Wordmark";
import { Container } from "./Container";
import { iconProps } from "@/components/ui/icon-props";
import { buttonClass } from "@/components/ui/Button";
import styles from "./SiteHeader.module.css";

/** Header ringan sebelum masuk room (SCR-02/03/21): wordmark + aksi kembali ke beranda. */
export function SiteHeader() {
  return (
    <header className={styles.header}>
      <Container className={styles.inner}>
        <Link href="/" aria-label="LONGROLL, beranda" className={styles.logo}>
          <Wordmark size={24} />
        </Link>
        <Link href="/" className={buttonClass({ variant: "ghost", size: "md" })}>
          <ArrowLeft size={16} {...iconProps} />
          Balik
        </Link>
      </Container>
    </header>
  );
}
