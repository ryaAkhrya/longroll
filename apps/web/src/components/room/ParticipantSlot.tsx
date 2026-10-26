"use client";

import { CameraOff, Link2, Plus, WifiOff } from "lucide-react";
import type { CSSProperties } from "react";
import type { ParticipantView } from "@longroll/shared";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icon-props";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/lib/cx";
import { useNow } from "@/room/hooks";
import styles from "./ParticipantSlot.module.css";

interface ParticipantSlotProps {
  /** Kosong = slot belum terisi. */
  participant?: ParticipantView;
  isSelf?: boolean;
  slotNumber: number;
  inviteUrl: string;
  holdSeconds: number;
  /** Selisih jam server − klien untuk hitung mundur hold slot. */
  clockOffsetMs?: number;
}

function formatClock(totalSec: number) {
  const s = Math.max(0, Math.ceil(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Kartu slot lobby (SCR-05) tanpa feed: avatar + "Kamera belum aktif" (kamera = P03).
 * Status koneksi ditampilkan dengan ikon + teks, bukan warna saja.
 */
export function ParticipantSlot({ participant, isSelf, slotNumber, inviteUrl, holdSeconds, clockOffsetMs = 0 }: ParticipantSlotProps) {
  const toast = useToast();
  const reconnecting = participant?.connection === "RECONNECTING";
  const now = useNow(1_000, reconnecting);

  if (!participant) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(inviteUrl);
        toast.show({ message: "Link room tersalin" });
      } catch {
        toast.show({ message: "Gagal menyalin. Salin link dari kartu undangan.", tone: "warn" });
      }
    };
    return (
      <li className={cx(styles.slot, styles.empty)} aria-label={`Slot ke-${slotNumber}, kosong`}>
        <span className={styles.plus} aria-hidden="true">
          <Plus size={22} {...iconProps} />
        </span>
        <p className={styles.emptyTitle}>
          Slot ke-{slotNumber}
          <span className={styles.longOnly}> masih kosong</span>
        </p>
        <Button variant="secondary" size="sm" icon={<Link2 size={14} {...iconProps} />} onClick={copy} className={styles.longBtn}>
          Salin link undangan
        </Button>
      </li>
    );
  }

  const name = isSelf ? "Kamu" : participant.displayName;
  const remaining =
    reconnecting && participant.disconnectedAtMs !== null
      ? holdSeconds - (now + clockOffsetMs - participant.disconnectedAtMs) / 1000
      : 0;
  const statusText = reconnecting ? `nyambung lagi, slot dijaga ${formatClock(remaining)}` : "kamera belum aktif";

  return (
    <li
      className={cx(styles.slot, styles[participant.color], isSelf && styles.self, reconnecting && styles.reconnecting)}
      style={{ "--ring": `var(--${participant.color.toLowerCase()}-mid)` } as CSSProperties}
      aria-label={`Kamera ${participant.displayName}${isSelf ? " (kamu)" : ""}, ${statusText}`}
    >
      <span className={styles.center} aria-hidden="true">
        <Avatar name={participant.displayName} color={participant.color} size={64} className={styles.bigAvatar} />
        <span className={styles.state}>
          {reconnecting ? <WifiOff size={14} {...iconProps} /> : <CameraOff size={14} {...iconProps} />}
          {reconnecting ? (
            <>
              Nyambung lagi… <span className="tnum">{formatClock(remaining)}</span>
            </>
          ) : (
            "Kamera belum aktif"
          )}
        </span>
      </span>
      <span className={styles.name} aria-hidden="true">
        <Avatar name={participant.displayName} color={participant.color} size={18} />
        {name}
      </span>
      {participant.ready && (
        <span className={styles.ready} aria-hidden="true">
          ✓ Siap
        </span>
      )}
    </li>
  );
}
