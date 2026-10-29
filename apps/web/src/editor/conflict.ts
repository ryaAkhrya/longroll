import { EDITOR_LIMITS } from "@longroll/shared";

/**
 * Deteksi "kalah" (11 §5): klien mencatat `lastLocalWrite[elementId][prop]` selama 10 detik. Bila update
 * remote mengubah properti yang sama dalam jendela itu → toast "{nama} mindahin … yang barusan kamu atur · Balikin".
 * Toast untuk elemen yang sama digabung (maks. 1 per 3 detik). Murni & mudah diuji.
 */

export interface ChangeSet {
  elementId: string;
  props: string[];
  /** true bila elemen dihapus oleh transaksi ini. */
  deleted: boolean;
  by: string;
}

export interface ConflictToast {
  kind: "overwritten" | "deleted";
  elementId: string;
  by: string;
  props: string[];
}

export class ConflictTracker {
  private readonly lastLocal = new Map<string, number>();
  private readonly lastToast = new Map<string, number>();

  /** Catat penulisan lokal (commit). */
  noteLocal(elementId: string, props: string[], now: number) {
    for (const p of props) this.lastLocal.set(`${elementId}\u0000${p}`, now);
    this.prune(now);
  }

  /** Periksa perubahan remote terhadap penulisan lokal terbaru. */
  onRemote(changes: ChangeSet[], now: number, me: string): ConflictToast[] {
    const out: ConflictToast[] = [];
    for (const c of changes) {
      if (c.by === me) continue;
      const mine = (c.deleted ? this.propsWrittenRecently(c.elementId, now) : c.props.filter((p) => this.fresh(`${c.elementId}\u0000${p}`, now))) as string[];
      if (!mine.length) continue;
      const last = this.lastToast.get(c.elementId) ?? -Infinity;
      if (now - last < EDITOR_LIMITS.conflictToastMs) continue;
      this.lastToast.set(c.elementId, now);
      out.push({ kind: c.deleted ? "deleted" : "overwritten", elementId: c.elementId, by: c.by, props: mine });
    }
    return out;
  }

  private fresh(key: string, now: number) {
    const t = this.lastLocal.get(key);
    return t !== undefined && now - t <= EDITOR_LIMITS.conflictWindowMs;
  }

  private propsWrittenRecently(elementId: string, now: number): string[] {
    const out: string[] = [];
    for (const [k, t] of this.lastLocal) if (k.startsWith(`${elementId}\u0000`) && now - t <= EDITOR_LIMITS.conflictWindowMs) out.push(k.split("\u0000")[1]!);
    return out;
  }

  private prune(now: number) {
    if (this.lastLocal.size < 400) return;
    for (const [k, t] of this.lastLocal) if (now - t > EDITOR_LIMITS.conflictWindowMs) this.lastLocal.delete(k);
  }
}
