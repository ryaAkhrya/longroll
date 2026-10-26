"use client";

import { Copy, QrCode, Share2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { iconProps } from "@/components/ui/icon-props";
import { useToast } from "@/components/ui/Toast";
import { QrDialog } from "./QrDialog";
import styles from "./InvitePanel.module.css";

interface InvitePanelProps {
  code: string;
  /** Tautan lengkap (origin + /r/code). */
  inviteUrl: string;
}

export async function shareOrCopy(code: string, inviteUrl: string, toast: ReturnType<typeof useToast>) {
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "LONGROLL", text: `Gabung room ${code} di LONGROLL`, url: inviteUrl });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }
  await copyLink(inviteUrl, toast);
}

export async function copyLink(inviteUrl: string, toast: ReturnType<typeof useToast>) {
  try {
    await navigator.clipboard.writeText(inviteUrl);
    toast.show({ message: "Link room tersalin" });
  } catch {
    toast.show({ message: "Gagal menyalin. Salin link secara manual.", tone: "warn" });
  }
}

/** Kartu "Ajak temen" (SCR-05): desktop = kode besar + tautan + Salin; mobile = kode ringkas + QR + Ajak (Web Share). */
export function InvitePanel({ code, inviteUrl }: InvitePanelProps) {
  const toast = useToast();
  const [qrOpen, setQrOpen] = useState(false);
  const display = inviteUrl.replace(/^https?:\/\//, "");

  const qr = (
    <Button variant="soft" size="md" iconOnly aria-label="Tampilkan QR code undangan" onClick={() => setQrOpen(true)}>
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
          <Button variant="soft" size="md" icon={<Share2 size={16} {...iconProps} />} onClick={() => shareOrCopy(code, inviteUrl, toast)}>
            Ajak
          </Button>
        </div>
        <div className={styles.deskQr}>{qr}</div>
      </div>
      <div className={styles.link}>
        <span className={styles.url}>{display}</span>
        <Button variant="primary" size="sm" icon={<Copy size={14} {...iconProps} />} onClick={() => copyLink(inviteUrl, toast)}>
          Salin
        </Button>
      </div>
      <QrDialog open={qrOpen} onClose={() => setQrOpen(false)} code={code} url={inviteUrl} />
    </Card>
  );
}
