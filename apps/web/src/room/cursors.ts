import { CURSOR } from "@longroll/shared";
import type { CursorSurface } from "@longroll/shared";

export interface RemoteCursor {
  participantId: string;
  surface: CursorSurface;
  x: number;
  y: number;
  label?: string;
  atMs: number;
}

/**
 * Store kursor remote terpisah dari store room: update 20 Hz tidak me-render ulang seluruh lobby.
 * Volatile (07 §8): tidak disimpan, tidak di-replay.
 */
export class CursorStore {
  private cursors = new Map<string, RemoteCursor>();
  private listeners = new Set<() => void>();
  private snapshot: RemoteCursor[] = [];

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snapshot;

  private emit() {
    this.snapshot = Array.from(this.cursors.values());
    for (const fn of this.listeners) fn();
  }

  upsert(c: RemoteCursor) {
    this.cursors.set(c.participantId, c);
    this.emit();
  }

  remove(participantId: string) {
    if (this.cursors.delete(participantId)) this.emit();
  }

  /** Sembunyikan kursor yang diam > 5 s. */
  prune(nowMs = Date.now()) {
    let changed = false;
    for (const [id, c] of this.cursors) {
      if (nowMs - c.atMs > CURSOR.hideAfterMs) {
        this.cursors.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  clear() {
    this.cursors.clear();
    this.emit();
  }
}

/** Throttle pengirim: maks. 20 Hz dan hanya bila bergeser ≥ 2 px, dengan kiriman penutup (trailing). */
export function createCursorSender(send: (x: number, y: number) => void) {
  let lastSentAt = 0;
  let lastPx: { x: number; y: number } | null = null;
  let pending: { nx: number; ny: number; px: number; py: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (!pending) return;
    const { nx, ny, px, py } = pending;
    pending = null;
    lastSentAt = Date.now();
    lastPx = { x: px, y: py };
    send(nx, ny);
  };

  return {
    move(nx: number, ny: number, px: number, py: number) {
      if (lastPx && Math.hypot(px - lastPx.x, py - lastPx.y) < CURSOR.minDeltaPx) return;
      pending = { nx, ny, px, py };
      const wait = CURSOR.sendIntervalMs - (Date.now() - lastSentAt);
      if (wait <= 0) flush();
      else if (!timer) timer = setTimeout(flush, wait);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
