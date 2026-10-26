"use client";

import { Camera, Link2, Plus } from "lucide-react";
import type { CSSProperties } from "react";
import type { ParticipantView } from "@longroll/shared";
import { SampleShot } from "@/components/brand/SampleShot";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icon-props";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/lib/cx";
import styles from "./ParticipantSlot.module.css";

interface ParticipantSlotProps {
  /** Kosong = slot belum terisi. */
  participant?: ParticipantView;
  slotNumber: number;
  inviteUrl: string;
}

/**
 * Kartu slot untuk kerangka lobby (SCR-05): hanya layout + avatar/blok warna.
 * BUKAN CameraTile: state kamera, WebRTC, dan feed dibangun di P03.
 */
export function ParticipantSlot({ participant, slotNumber, inviteUrl }: ParticipantSlotProps) {
  const toast = useToast();

  if (!participant) {
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(inviteUrl);
        toast.show({ message: "Link room tersalin" });
      } catch {
        toast.show({ message: "Gagal menyalin. Salin link dari kolom undangan.", tone: "warn" });
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

  const pending = participant.status === "pending";
  const name = participant.isSelf ? "Kamu" : participant.displayName;
  return (
    <li
      className={cx(styles.slot, participant.isSelf && styles.self)}
      style={{ "--ring": `var(--${participant.color.toLowerCase()}-mid)` } as CSSProperties}
      aria-label={`${participant.displayName}, ${participant.statusText}`}
    >
      <SampleShot color={participant.color} guide={!pending} className={styles.fill} />
      {pending && (
        <span className={styles.pending}>
          <span className={styles.pendingIcon} aria-hidden="true">
            <Camera size={18} {...iconProps} />
          </span>
          <span className={styles.pendingText}>
            <span className={styles.longOnly}>{participant.displayName} lagi nyalain kamera…</span>
            <span className={styles.shortOnly}>Nyalain kamera…</span>
          </span>
        </span>
      )}
      <span className={styles.name}>
        <Avatar name={participant.displayName} color={participant.color} size={18} />
        {name}
      </span>
    </li>
  );
}
