"use client";

import { AlertTriangle, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { iconProps } from "./icon-props";
import styles from "./Toast.module.css";

export interface ToastInput {
  message: string;
  tone?: "default" | "warn";
  /** Aksi opsional, mis. "Balikin". Toast dengan aksi bertahan 8 detik. */
  action?: { label: string; onAction: () => void };
}

interface ToastItem extends ToastInput {
  id: number;
}

interface ToastApi {
  show: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const MAX_VISIBLE = 3;
const DURATION_MS = 5000;
const DURATION_WITH_ACTION_MS = 8000;

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast harus dipakai di dalam <ToastProvider>");
  return ctx;
}

/** Provider + region notifikasi `aria-live="polite"` (SCR-22). Maksimal 3 toast bertumpuk. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((cur) => cur.filter((t) => t.id !== id)), []);
  const show = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setItems((cur) => [...cur, { ...toast, id }].slice(-MAX_VISIBLE));
  }, []);
  const api = useMemo(() => ({ show }), [show]);

  // Publikasikan tinggi tumpukan toast sebagai --toast-lane (di bawah 1024 px, toast ada di atas konten). <ToastLane/> memakainya
  // untuk menyisihkan ruang di layar yang bergulir (vote, lobby) supaya toast tidak menutupi kartu.
  const regionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = regionRef.current;
    // Peramban/lingkungan tanpa ResizeObserver atau matchMedia: tanpa penyela, toast tetap berfungsi sebagai overlay biasa.
    if (!el || typeof ResizeObserver === "undefined" || typeof window.matchMedia !== "function") return;
    const root = document.documentElement;
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => {
      const h = el.offsetHeight;
      root.style.setProperty("--toast-lane", h > 0 && !mq.matches ? `${h + 16}px` : "0px");
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    mq.addEventListener("change", sync);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", sync);
      root.style.removeProperty("--toast-lane");
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div ref={regionRef} className={styles.region} role="region" aria-label="Notifikasi" aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Penyela setinggi tumpukan toast aktif (0 saat kosong atau di desktop). Taruh di paling atas layar yang bergulir. */
export function ToastLane() {
  return <div aria-hidden="true" className={styles.lane} />;
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  const duration = toast.action ? DURATION_WITH_ACTION_MS : DURATION_MS;

  // Pause saat hover/fokus; timer dimulai ulang saat dilepas.
  const expire = useEffectEvent(onDismiss);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => expire(), duration);
    return () => clearTimeout(timer);
  }, [paused, duration]);

  // Notifikasi pasif (tanpa aksi, bukan peringatan) hilang saat pengguna mulai menggulir (roda/sentuh): tidak menutupi konten yang
  // sedang dibaca. Sengaja bukan event `scroll`, supaya reset gulir otomatis saat layar berganti tidak ikut menutup notifikasi.
  const passive = !toast.action && toast.tone !== "warn";
  useEffect(() => {
    if (!passive) return;
    const dismissOnGesture = () => expire();
    window.addEventListener("wheel", dismissOnGesture, { passive: true });
    window.addEventListener("touchmove", dismissOnGesture, { passive: true });
    return () => {
      window.removeEventListener("wheel", dismissOnGesture);
      window.removeEventListener("touchmove", dismissOnGesture);
    };
  }, [passive]);

  return (
    <div
      className={cx(styles.toast, toast.tone === "warn" && styles.warn)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {toast.tone === "warn" && <AlertTriangle size={16} {...iconProps} className={styles.warnIcon} />}
      <span className={styles.message}>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            toast.action?.onAction();
            onDismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button type="button" className={styles.close} aria-label="Tutup notifikasi" onClick={onDismiss}>
        <X size={14} {...iconProps} />
      </button>
    </div>
  );
}
