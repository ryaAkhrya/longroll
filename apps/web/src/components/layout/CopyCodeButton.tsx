"use client";

import { Copy } from "lucide-react";
import { iconProps } from "@/components/ui/icon-props";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/lib/cx";
import styles from "./RoomHeader.module.css";

interface CopyCodeButtonProps {
  code: string;
  className?: string;
}

/** Pill kode room + salin. Salin hanya menyalin teks kode; tidak ada panggilan jaringan. */
export function CopyCodeButton({ code, className }: CopyCodeButtonProps) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.show({ message: "Kode room tersalin" });
    } catch {
      toast.show({ message: "Gagal menyalin. Salin kode secara manual.", tone: "warn" });
    }
  };
  return (
    <button type="button" className={cx(styles.codePill, className)} onClick={copy} aria-label={`Salin kode room ${code}`}>
      <span className={styles.codeLabel}>Room</span>
      <span className={cx("tnum", styles.codeValue)}>{code}</span>
      <Copy size={13} {...iconProps} />
    </button>
  );
}
