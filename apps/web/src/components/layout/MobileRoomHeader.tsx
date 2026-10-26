import { MoreHorizontal } from "lucide-react";
import type { ParticipantView } from "@longroll/shared";
import { AvatarStack } from "@/components/ui/AvatarStack";
import { Button } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icon-props";
import { CopyCodeButton } from "./CopyCodeButton";
import styles from "./RoomHeader.module.css";

interface MobileRoomHeaderProps {
  code: string;
  participants: ParticipantView[];
}

/** Header room mobile 52 px (04 §0.2). Tampil < 1024 px. Menu (salin link, QR, keluar) diisi di P02. */
export function MobileRoomHeader({ code, participants }: MobileRoomHeaderProps) {
  return (
    <header className={styles.mobile}>
      <CopyCodeButton code={code} className={styles.mobileCode} />
      <div className={styles.right}>
        <AvatarStack participants={participants} size={24} />
        <Button variant="secondary" size="sm" iconOnly disabled aria-label="Menu room (belum aktif)" title="Aktif di P02">
          <MoreHorizontal size={17} {...iconProps} />
        </Button>
      </div>
    </header>
  );
}
