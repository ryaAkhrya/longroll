"use client";

import { Copy, LogOut, MoreHorizontal, QrCode } from "lucide-react";
import { useState } from "react";
import type { ParticipantView } from "@longroll/shared";
import { AvatarStack } from "@/components/ui/AvatarStack";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { iconProps } from "@/components/ui/icon-props";
import { useToast } from "@/components/ui/Toast";
import { copyLink } from "@/components/room/InvitePanel";
import { QrDialog } from "@/components/room/QrDialog";
import { CopyCodeButton } from "./CopyCodeButton";
import styles from "./RoomHeader.module.css";

interface MobileRoomHeaderProps {
  code: string;
  participants: ParticipantView[];
  inviteUrl?: string;
  onLeave?: () => void;
}

/** Header room mobile 52 px (04 §0.2). Menu ⋯: salin link, QR, keluar (aksi destruktif tidak di dock, 06 §4). */
export function MobileRoomHeader({ code, participants, inviteUrl, onLeave }: MobileRoomHeaderProps) {
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [qr, setQr] = useState(false);
  const enabled = !!inviteUrl && !!onLeave;

  return (
    <header className={styles.mobile}>
      <CopyCodeButton code={code} className={styles.mobileCode} />
      <div className={styles.right}>
        <AvatarStack participants={participants} size={24} />
        <Button variant="secondary" size="sm" iconOnly disabled={!enabled} aria-label="Menu room" aria-haspopup="dialog" onClick={() => setMenu(true)}>
          <MoreHorizontal size={17} {...iconProps} />
        </Button>
      </div>
      {enabled && (
        <>
          <BottomSheet open={menu} onClose={() => setMenu(false)} title={`Room ${code}`}>
            <div className={styles.menu}>
              <Button
                variant="soft"
                size="lg"
                fullWidth
                icon={<Copy size={17} {...iconProps} />}
                onClick={() => {
                  setMenu(false);
                  void copyLink(inviteUrl!, toast);
                }}
              >
                Salin link undangan
              </Button>
              <Button
                variant="soft"
                size="lg"
                fullWidth
                icon={<QrCode size={17} {...iconProps} />}
                onClick={() => {
                  setMenu(false);
                  setQr(true);
                }}
              >
                Tampilkan QR
              </Button>
              <hr className={styles.sep} />
              <Button
                variant="danger"
                size="lg"
                fullWidth
                icon={<LogOut size={17} {...iconProps} />}
                onClick={() => {
                  setMenu(false);
                  onLeave!();
                }}
              >
                Keluar dari room
              </Button>
            </div>
          </BottomSheet>
          <QrDialog open={qr} onClose={() => setQr(false)} code={code} url={inviteUrl!} />
        </>
      )}
    </header>
  );
}
