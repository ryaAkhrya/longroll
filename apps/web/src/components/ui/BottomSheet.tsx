"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { cx } from "@/lib/cx";
import { iconProps } from "./icon-props";
import styles from "./BottomSheet.module.css";

export type SheetSnap = "half" | "full";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Snap saat ini (terkontrol). */
  snap?: SheetSnap;
  onSnapChange?: (snap: SheetSnap) => void;
  /** true = ada scrim + fokus terperangkap (sheet konfirmasi). false = konten di belakang tetap interaktif. */
  modal?: boolean;
  children: ReactNode;
}

const DRAG_THRESHOLD = 56;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet dasar (06 §6): role="dialog" berlabel, fokus pindah ke judul saat buka dan kembali
 * ke pemicu saat tutup, handle bisa di-drag, tombol Tutup sebagai alternatif gestur.
 */
export function BottomSheet({ open, onClose, title, snap = "half", onSnapChange, modal = true, children }: BottomSheetProps) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dragStart = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    return () => trigger?.focus?.();
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (modal && e.key === "Tab" && sheetRef.current) {
      const nodes = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragStart.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null) return;
    const dy = e.clientY - dragStart.current;
    dragStart.current = null;
    if (dy < -DRAG_THRESHOLD) onSnapChange?.("full");
    else if (dy > DRAG_THRESHOLD) {
      if (snap === "full") onSnapChange?.("half");
      else onClose();
    }
  };

  return (
    <>
      {modal && <div className={styles.scrim} onClick={onClose} aria-hidden="true" />}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal={modal || undefined}
        aria-labelledby={titleId}
        className={cx(styles.sheet, snap === "full" ? styles.full : styles.half)}
        onKeyDown={onKeyDown}
      >
        <div
          className={styles.handleArea}
          aria-hidden="true"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (dragStart.current = null)}
        >
          <span className={styles.handle} />
        </div>
        <header className={styles.header}>
          <h2 id={titleId} ref={titleRef} tabIndex={-1} className={`d ${styles.title}`}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Tutup">
            <X size={18} {...iconProps} />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </>
  );
}
