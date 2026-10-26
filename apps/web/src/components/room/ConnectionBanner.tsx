"use client";

import { WifiOff } from "lucide-react";
import { iconProps } from "@/components/ui/icon-props";
import type { ConnectionStatus } from "@/room/client";
import styles from "./ConnectionBanner.module.css";

/** SCR-20(b): koneksi sendiri bermasalah. Tetap terlihat selama reconnect (backoff maks. 8 s). */
export function ConnectionBanner({ status, attempt }: { status: ConnectionStatus; attempt: number }) {
  if (status !== "reconnecting") return null;
  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <WifiOff size={16} {...iconProps} />
      <span>
        <strong>Sinyal lemah, nyambung lagi…</strong>
        {attempt > 3 && <span className={styles.hint}> Slot kamu tetap dijaga sebentar.</span>}
      </span>
    </div>
  );
}
