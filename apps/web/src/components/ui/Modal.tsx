"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { iconProps } from "./icon-props";
import styles from "./Modal.module.css";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** false untuk konfirmasi destruktif: Esc dan klik scrim tidak menutup (05 §8). */
  dismissible?: boolean;
}

/**
 * Modal memakai <dialog> native: fokus terperangkap, background inert, Esc menutup.
 * Fokus kembali ke pemicu saat tertutup (perilaku bawaan showModal/close).
 */
export function Modal({ open, onClose, title, children, footer, dismissible = true }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (dismissible && e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className={styles.panel}>
          <header className={styles.header}>
            <h2 id={titleId} className={`d ${styles.title}`}>
              {title}
            </h2>
            {dismissible && (
              <button type="button" className={styles.close} onClick={onClose} aria-label="Tutup">
                <X size={18} {...iconProps} />
              </button>
            )}
          </header>
          <div className={styles.body}>{children}</div>
          {footer && <footer className={styles.footer}>{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
