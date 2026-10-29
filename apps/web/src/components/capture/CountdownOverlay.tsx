"use client";

import { Hand } from "lucide-react";
import { useEffect, useState } from "react";
import type { Shot } from "@longroll/shared";
import { Button } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icon-props";
import { useNow } from "@/room/hooks";
import styles from "./CountdownOverlay.module.css";

const ACCENT = ["senyum dikit…", "tahan sebentar…", "siap-siap ya…", "pose terbaikmu…"];

interface CountdownOverlayProps {
  shot: Shot;
  initiatorName: string;
  shotCount: number;
  clockOffsetMs: number;
  onHold: () => void;
}

/**
 * SCR-13: angka countdown besar (Display) di lingkaran glass, teks aksen, "Dimulai sama {nama} · shot n dari m",
 * Tunggu!. Dirender dari t0ServerMs; pengumuman aria-live hanya untuk 3 detik terakhir. Saat T0: flash 120 ms
 * (fade bila reduced motion — diatur CSS).
 */
export function CountdownOverlay({ shot, initiatorName, shotCount, clockOffsetMs, onHold }: CountdownOverlayProps) {
  const now = useNow(100, true);
  const t0 = shot.t0ServerMs ?? 0;
  const leftMs = t0 - (now + clockOffsetMs);
  const n = Math.max(0, Math.ceil(leftMs / 1000));
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (leftMs > 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 160);
    return () => clearTimeout(t);
  }, [leftMs <= 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (leftMs <= 0) {
    return (
      <div className={styles.wrap} data-testid="capture-saving" role="status">
        {flash && <span className={styles.flash} aria-hidden="true" />}
        <p className={styles.saving}>Nyimpen foto…</p>
      </div>
    );
  }
  return (
    <div className={styles.wrap} data-testid="countdown" data-count={n}>
      <div className={styles.glass} aria-hidden="true">
        <span className={`dc ${styles.number}`}>{n}</span>
      </div>
      <p className={`${styles.accent} s`} aria-hidden="true">
        {ACCENT[n % ACCENT.length]}
      </p>
      <p className={styles.caption}>
        Dimulai sama {initiatorName} · shot {shot.index + 1} dari {shotCount}
      </p>
      <div className={styles.live} aria-live="assertive" aria-atomic="true" role="status">
        {n <= 3 ? String(n) : ""}
      </div>
      <Button variant="secondary" size="xl" className={styles.hold} onClick={onHold} icon={<Hand size={18} {...iconProps} />}>
        Tunggu!
      </Button>
    </div>
  );
}
