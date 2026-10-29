"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import type { PlayerColor } from "@longroll/shared";
import { Avatar } from "@/components/ui/Avatar";
import { useMediaQuery } from "@/room/hooks";
import type { PeerInviteStatus } from "./inviteStatus";
import styles from "./InviteDialog.module.css";

export interface InvitePeer {
  participantId: string;
  name: string;
  color: PlayerColor;
  status: PeerInviteStatus;
}

const STATUS_LABEL: Record<PeerInviteStatus, string> = {
  join: "Ikut",
  later: "Bentar",
  download: "Lagi unduh…",
  pending: "Belum jawab",
};

interface Props {
  open: boolean;
  /** Nama yang memulai sesi baru. */
  from: string;
  index: number;
  /** Status peserta lain (SCR-19). Kosong = daftar tidak ditampilkan. */
  peers?: InvitePeer[];
  onJoin: () => void;
  onLater: () => void;
}

/** SCR-19 Undangan sesi baru: modal di desktop, bottom sheet di mobile. "Bentar" tidak memutus apa pun; bisa Gabung nanti. */
export function InviteDialog({ open, from, index, peers = [], onJoin, onLater }: Props) {
  const mobile = useMediaQuery("(max-width: 1023px)");
  const title = `${from} mulai sesi ${index}`;
  const body = (
    <>
      <p className={styles.body}>Ayo vote mode barunya bareng-bareng. Hasil sesi sebelumnya tetap aman di galeri.</p>
      {peers.length > 0 && (
        <ul className={styles.peers} aria-label="Status peserta" data-testid="invite-peers">
          {peers.map((p) => (
            <li key={p.participantId} className={styles.peer} data-status={p.status}>
              <Avatar name={p.name} color={p.color} size={24} />
              <span className={styles.peerName}>{p.name}</span>
              <span className={styles.peerStatus}>{STATUS_LABEL[p.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
  const actions = (
    <div className={styles.actions}>
      <Button variant="secondary" size="lg" onClick={onLater} data-testid="invite-later">
        Bentar
      </Button>
      <Button variant="primary" size="lg" onClick={onJoin} data-testid="invite-join">
        Ikut, ayo vote
      </Button>
    </div>
  );
  if (mobile) {
    return (
      <BottomSheet open={open} onClose={onLater} title={title}>
        {body}
        {actions}
      </BottomSheet>
    );
  }
  return (
    <Modal open={open} onClose={onLater} title={title} footer={actions}>
      {body}
    </Modal>
  );
}
