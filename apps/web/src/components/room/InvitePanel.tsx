"use client";

import { Copy, QrCode, Share2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { iconProps } from "@/components/ui/icon-props";
import { useToast } from "@/components/ui/Toast";
import styles from "./InvitePanel.module.css";

interface InvitePanelProps {
  code: string;
  /** Tautan lengkap (origin + /r/code). */
  inviteUrl: string;
}

/** Kartu "Ajak temen" (SCR-05): desktop = kode besar + tautan + Salin; mobile = kode ringkas + QR + Ajak. */
export function InvitePanel({ code, inviteUrl }: InvitePanelProps) {
  const toast = useToast();
  const display = inviteUrl.replace(/^https?:\/\//, "");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      toast.show({ message: "Link room tersalin" });
    } catch {
      toast.show({ message: "Gagal menyalin. Salin link secara manual.", tone: "warn" });
    }
  };

  const share = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "LONGROLL", text: `Gabung room ${code}`, url: inviteUrl });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    await copy();
  };

  // QR dibangun di P02: tombol dinonaktifkan agar tidak tampak berfungsi.
  const qr = (
    <Button variant="soft" size="md" iconOnly disabled aria-label="Tampilkan QR (belum aktif)" title="Aktif di P02">
      <QrCode size={18} {...iconProps} />
    </Button>
  );

  return (
    <Card as="section" aria-label="Ajak temen" className={styles.panel}>
      <p className={`cap ${styles.cap}`}>Ajak temen</p>
      <div className={styles.row}>
        <div>
          <p className={`cap ${styles.mobCap}`}>Kode room</p>
          <p className={`dc tnum ${styles.code}`} aria-label={`Kode room ${code.split("").join(" ")}`}>
            {code}
          </p>
        </div>
        <div className={styles.mobActions}>
          {qr}
          <Button variant="soft" size="md" icon={<Share2 size={16} {...iconProps} />} onClick={share}>
            Ajak
          </Button>
        </div>
        <div className={styles.deskQr}>{qr}</div>
      </div>
      <div className={styles.link}>
        <span className={styles.url}>{display}</span>
        <Button variant="primary" size="sm" icon={<Copy size={14} {...iconProps} />} onClick={copy}>
          Salin
        </Button>
      </div>
    </Card>
  );
}
