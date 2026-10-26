"use client";

import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import Link from "next/link";
import type { ParticipantView } from "@longroll/shared";
import { Wordmark } from "@/components/brand/Wordmark";
import { AvatarStack } from "@/components/ui/AvatarStack";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Tag";
import { iconProps } from "@/components/ui/icon-props";
import { CopyCodeButton } from "./CopyCodeButton";
import styles from "./RoomHeader.module.css";

interface RoomHeaderProps {
  code: string;
  participants: ParticipantView[];
  /** Tag status layar, mis. "Lobby". */
  statusTag?: string;
  /** Aksi kontekstual kanan (mis. Selesai edit di fase lain). */
  actions?: ReactNode;
  /** Buka konfirmasi keluar. Tanpa handler, tombol tidak ditampilkan aktif. */
  onLeave?: () => void;
}

/** Header room desktop 60 px (04 §0.2), tanpa stepper sesi (SessionStepper dibangun di P04). Tampil ≥ 1024 px. */
export function RoomHeader({ code, participants, statusTag, actions, onLeave }: RoomHeaderProps) {
  return (
    <header className={styles.desktop}>
      <div className={styles.left}>
        <Link href="/" aria-label="LONGROLL, ke beranda" className={styles.logo}>
          <Wordmark size={22} />
        </Link>
        <span className={styles.divider} aria-hidden="true" />
        <CopyCodeButton code={code} />
        {statusTag && <Tag>{statusTag}</Tag>}
      </div>
      <div className={styles.right}>
        {actions}
        <AvatarStack participants={participants} size={30} />
        <Button variant="secondary" size="md" iconOnly disabled={!onLeave} aria-label="Keluar dari room" onClick={onLeave}>
          <LogOut size={17} {...iconProps} />
        </Button>
      </div>
    </header>
  );
}
