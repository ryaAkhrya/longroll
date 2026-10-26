"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import styles from "./QrDialog.module.css";

interface QrDialogProps {
  open: boolean;
  onClose: () => void;
  code: string;
  url: string;
}

/** QR besar untuk link undangan (SCR-05). Dibuat lokal di browser; library dimuat saat dibuka saja. */
export function QrDialog({ open, onClose, code, url }: QrDialogProps) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !url) return;
    let alive = true;
    void import("qrcode").then((QR) =>
      QR.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: "M", color: { dark: "#1B1720", light: "#FFFFFF" } }).then((data) => {
        if (alive) setSrc(data);
      }),
    );
    return () => {
      alive = false;
    };
  }, [open, url]);

  return (
    <Modal open={open} onClose={onClose} title={`Scan buat gabung ${code}`}>
      <div className={styles.wrap}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL lokal, bukan aset yang dioptimasi
          <img src={src} width={280} height={280} alt={`QR code link undangan room ${code}`} className={styles.qr} />
        ) : (
          <Skeleton width={280} height={280} radius={16} />
        )}
        <p className={styles.note}>Siapa pun yang punya link ini bisa masuk selama room belum penuh.</p>
      </div>
    </Modal>
  );
}
