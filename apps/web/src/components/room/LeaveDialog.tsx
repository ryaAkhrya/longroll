"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/Banner";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useMediaQuery } from "@/room/hooks";
import styles from "./LeaveDialog.module.css";

interface LeaveDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  /** Peserta terakhir di room (DEC-057). */
  isLast: boolean;
  graceMinutes: number;
}

/** Konfirmasi keluar (F-18, SCR-22): modal di desktop, bottom sheet di mobile. */
export function LeaveDialog({ open, onClose, onConfirm, isLast, graceMinutes }: LeaveDialogProps) {
  const mobile = useMediaQuery("(max-width: 1023px)");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch {
      setError("Gagal keluar. Cek koneksi, lalu coba lagi.");
      setBusy(false);
    }
  };

  const body = (
    <div className={styles.body}>
      {isLast ? (
        <Banner tone="warn" title="Kamu orang terakhir.">
          Kalau keluar, room dan datanya dihapus setelah masa tunggu {graceMinutes} menit berakhir.
        </Banner>
      ) : (
        <p>Slot dan warnamu dilepas. Kamu masih bisa gabung lagi pakai kode selama room belum penuh atau bubar.</p>
      )}
      {error && <Banner tone="error">{error}</Banner>}
    </div>
  );
  const actions = (
    <div className={styles.actions}>
      <Button variant="secondary" size="lg" onClick={onClose} disabled={busy}>
        Batal
      </Button>
      <Button variant="danger" size="lg" onClick={confirm} loading={busy}>
        Keluar
      </Button>
    </div>
  );

  if (mobile) {
    return (
      <BottomSheet open={open} onClose={onClose} title="Keluar dari room?">
        {body}
        {actions}
      </BottomSheet>
    );
  }
  return (
    <Modal open={open} onClose={onClose} title="Keluar dari room?" footer={actions}>
      {body}
    </Modal>
  );
}
