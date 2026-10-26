import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./AppShell.module.css";

interface AppShellProps {
  /** `light` (paper) atau `stage` (workspace photobooth gelap, REQ-UI-03). */
  theme?: "light" | "stage";
  header?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Kerangka halaman: tema, tinggi 100dvh, safe area. Konten utama selalu di `<main id="main">`. */
export function AppShell({ theme = "light", header, children, className }: AppShellProps) {
  return (
    <div className={cx(styles.shell, className)} data-theme={theme === "stage" ? "stage" : undefined}>
      <a href="#main" className={styles.skip}>
        Lompat ke konten
      </a>
      {header}
      <main id="main" className={styles.main}>
        {children}
      </main>
    </div>
  );
}
