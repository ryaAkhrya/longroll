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

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.region} role="region" aria-label="Notifikasi" aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
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
