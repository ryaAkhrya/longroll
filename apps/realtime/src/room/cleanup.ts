import { ROOM_DEFAULTS } from "@longroll/shared";
import { log, metrics } from "../log";
import type { ObjectStorage } from "../storage/types";
import { DELETE_BATCH, roomPrefix } from "../storage/types";
import type { RoomStore } from "../store/types";

export interface CleanupDeps {
  store: RoomStore;
  storage: ObjectStorage;
  /** Jadwal retry (detik) bila langkah gagal/verifikasi gagal: 1m, 5m, 15m, 1j (15 §8.2). */
  retrySeconds: number[];
}

/**
 * Cleanup room (15 §8.2 langkah 3–8). Idempoten & aman diulang:
 * hapus objek prefix → verifikasi storage → hapus data room + tombstone (satu transaksi) → VERIFIKASI.
 * Langkah 1–2 (EXPIRING, cabut token, tutup socket) dikerjakan RoomActor.
 */
export class RoomCleanup {
  private readonly running = new Map<string, Promise<boolean>>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly deps: CleanupDeps) {}

  /** Satu percobaan; true bila terverifikasi bersih. Percobaan paralel untuk room sama digabung. */
  attempt(roomId: string, code: string): Promise<boolean> {
    const existing = this.running.get(roomId);
    if (existing) return existing;
    const p = this.doAttempt(roomId, code).finally(() => this.running.delete(roomId));
    this.running.set(roomId, p);
    return p;
  }

  /** Jalankan dengan retry backoff; onDone dipanggil saat terverifikasi. */
  schedule(roomId: string, code: string, onDone: () => void, attemptNo = 0) {
    // Sudah dijadwalkan/berjalan: jangan tumpuk timer retry ganda (sweeper memanggil berulang).
    if (attemptNo === 0 && (this.retryTimers.has(roomId) || this.running.has(roomId))) return;
    void this.attempt(roomId, code).then((ok) => {
      if (ok) {
        onDone();
        return;
      }
      const delays = this.deps.retrySeconds;
      const delay = delays[Math.min(attemptNo, delays.length - 1)] ?? 3600;
      const t = setTimeout(() => {
        this.retryTimers.delete(roomId);
        this.schedule(roomId, code, onDone, attemptNo + 1);
      }, delay * 1000);
      t.unref?.();
      this.retryTimers.set(roomId, t);
    });
  }

  private async doAttempt(roomId: string, code: string): Promise<boolean> {
    const started = Date.now();
    const prefix = roomPrefix(roomId);
    try {
      const keys = await this.deps.storage.list(prefix);
      for (let i = 0; i < keys.length; i += DELETE_BATCH) await this.deps.storage.deleteMany(keys.slice(i, i + DELETE_BATCH));
      // Objek storage harus bersih DULU: selama baris room (EXPIRING) masih ada, sweeper tahu room ini
      // belum selesai dibersihkan dan akan mencoba lagi.
      const remainingObjects = (await this.deps.storage.list(prefix)).length;
      if (remainingObjects > 0) {
        metrics.inc("cleanup_failures_total");
        log.warn("cleanup.verify_failed", { roomId, remainingObjects, remainingRows: -1 });
        return false;
      }
      // Satu transaksi: hapus room (cascade peserta & event) + tombstone kode (24 jam).
      await this.deps.store.finalizeExpiredRoom(roomId, code, ROOM_DEFAULTS.tombstoneSeconds);

      // Langkah 6: verifikasi ulang.
      const remainingRows = await this.deps.store.countRoomData(roomId);
      if (remainingRows > 0) {
        metrics.inc("cleanup_failures_total");
        log.warn("cleanup.verify_failed", { roomId, remainingObjects, remainingRows });
        return false;
      }
      const durationMs = Date.now() - started;
      metrics.inc("cleanup_success_total");
      log.info("cleanup.done", { roomId, durationMs, objects: keys.length });
      return true;
    } catch (err) {
      metrics.inc("cleanup_failures_total");
      log.warn("cleanup.failed", { roomId, message: err instanceof Error ? err.message : "error" });
      return false;
    }
  }

  dispose() {
    for (const t of this.retryTimers.values()) clearTimeout(t);
    this.retryTimers.clear();
  }
}
