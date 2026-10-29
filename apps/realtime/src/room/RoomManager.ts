import type { ParticipantView } from "@longroll/shared";
import { errText, log, metrics } from "../log";
import { generateRoomCode, uuidv7 } from "../security";
import { TOMBSTONE } from "../store/types";
import type { RoomStore } from "../store/types";
import { roomPrefix } from "../storage/types";
import type { ObjectStorage } from "../storage/types";
import { RoomCleanup } from "./cleanup";
import { RoomActor } from "./RoomActor";
import type { ActorConfig } from "./RoomActor";
import { RoomError } from "./types";

export type Lookup = { kind: "open"; actor: RoomActor } | { kind: "expired" } | { kind: "missing" };

const CODE_ATTEMPTS = 5;

/**
 * Registry actor di satu instance (DEC-088). Memuat actor dari snapshot PostgreSQL bila belum ada di
 * memori (setelah restart), menjalankan cleanup saat room EXPIRING, dan sweeper berkala.
 */
export class RoomManager {
  private readonly byCode = new Map<string, RoomActor>();
  private readonly loading = new Map<string, Promise<Lookup>>();
  private readonly cleanup: RoomCleanup;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private readonly sweepHooks: ((actor: RoomActor) => Promise<void>)[] = [];

  constructor(
    private readonly store: RoomStore,
    storage: ObjectStorage,
    private readonly config: ActorConfig & { cleanupRetrySeconds: number[]; maxActiveRooms?: number },
  ) {
    this.storageRef = storage;
    this.cleanup = new RoomCleanup({ store, storage, retrySeconds: config.cleanupRetrySeconds });
  }

  private readonly storageRef: ObjectStorage;

  private makeActor(state: ConstructorParameters<typeof RoomActor>[0], events: ConstructorParameters<typeof RoomActor>[2] = []) {
    return new RoomActor(
      state,
      {
        store: this.store,
        config: this.config,
        onExpiring: (actor) => this.runCleanup(actor),
        storage: this.storageRef,
      },
      events,
    );
  }

  /** Bikin room (07 §2): kode CSPRNG + registry NX (maks. 5 percobaan), pembuat = peserta pertama. */
  async create(displayName: unknown): Promise<{ actor: RoomActor; participant: ParticipantView; token: string }> {
    // Batas memori satu instance: room aktif yang sudah termuat tidak boleh bertambah tanpa batas.
    if (this.byCode.size >= (this.config.maxActiveRooms ?? Infinity)) {
      metrics.inc("room_create_rejected_capacity_total");
      throw new RoomError("SERVICE_UNAVAILABLE", "CAPACITY");
    }
    const roomId = uuidv7();
    let code: string | null = null;
    for (let i = 0; i < CODE_ATTEMPTS && !code; i++) {
      const candidate = generateRoomCode();
      if (await this.store.reserveCode(candidate, roomId)) code = candidate;
    }
    if (!code) throw new RoomError("SERVICE_UNAVAILABLE");
    const actor = this.makeActor(RoomActor.createState(roomId, code, this.config));
    try {
      const { participant, token } = await actor.join(displayName);
      this.byCode.set(code, actor);
      log.info("room.created", { roomId });
      return { actor, participant, token };
    } catch (err) {
      actor.dispose();
      await this.store.releaseCode(code, roomId).catch(() => undefined);
      throw err;
    }
  }

  /** Cari room berdasarkan kode; muat dari snapshot bila perlu. Muat paralel untuk kode sama digabung. */
  lookup(code: string): Promise<Lookup> {
    const actor = this.byCode.get(code);
    if (actor) return Promise.resolve(actor.isOpen ? { kind: "open", actor } : { kind: "expired" });
    const pending = this.loading.get(code);
    if (pending) return pending;
    const p = this.load(code).finally(() => this.loading.delete(code));
    this.loading.set(code, p);
    return p;
  }

  private async load(code: string): Promise<Lookup> {
    const ref = await this.store.resolveCode(code);
    if (ref === TOMBSTONE) return { kind: "expired" };
    if (!ref) return { kind: "missing" };
    const loaded = await this.store.loadRoom(ref);
    // Reservasi kode tanpa room (crash saat create): bukan room yang pernah dipakai → "tidak ditemukan".
    // Reservasi yatim dihapus purgeExpired() setelah 1 jam.
    if (!loaded) return { kind: "missing" };
    const actor = this.makeActor(loaded.state, loaded.events);
    this.byCode.set(code, actor);
    await actor.recover();
    return actor.isOpen ? { kind: "open", actor } : { kind: "expired" };
  }

  private runCleanup(actor: RoomActor) {
    this.cleanup.schedule(actor.roomId, actor.code, () => {
      actor.markExpired();
      // Lepas dari memori: lookup berikutnya membaca tombstone → ROOM_EXPIRED.
      if (this.byCode.get(actor.code) === actor) this.byCode.delete(actor.code);
    });
  }

  /** Pulihkan room ACTIVE/GRACE/EXPIRING setelah restart (07 §12.1: grace dari emptySinceMs). */
  async recover(): Promise<number> {
    const entries = await this.store.listRecoverableRooms();
    for (const { code } of entries) {
      try {
        await this.lookup(code);
      } catch (err) {
        log.warn("room.recover_failed", { message: errText(err) });
      }
    }
    return entries.length;
  }

  /**
   * Sweeper (15 §8.3, versi dasar). PostgreSQL tidak punya TTL: tombstone, counter rate limit, dan
   * reservasi yatim dihapus eksplisit di sini; room yang belum termuat dipulihkan; timer diperiksa ulang.
   */
  startSweeper(intervalMs: number, orphanIntervalMs = 0) {
    this.sweepTimer = setInterval(() => void this.sweep(), intervalMs);
    this.sweepTimer.unref?.();
    if (orphanIntervalMs > 0) {
      this.orphanTimer = setInterval(() => void this.sweepOrphans(), orphanIntervalMs);
      this.orphanTimer.unref?.();
    }
  }

  private orphanTimer: ReturnType<typeof setInterval> | null = null;
  private orphanStreak = 0;

  /**
   * Sweeper objek yatim (15 §8.3): objek di `rooms/{id}/` yang room-nya tidak ada lagi (mis. PUT bertanda tangan
   * yang mendarat setelah cleanup, atau crash di tengah cleanup) dihapus & dihitung. Aman diulang. Tidak pernah
   * menyentuh room yang termuat di memori; menolak berjalan bila store tak dapat dijangkau (hindari salah hapus).
   */
  async sweepOrphans(): Promise<{ scanned: number; orphanRooms: number; orphanObjects: number }> {
    const none = { scanned: 0, orphanRooms: 0, orphanObjects: 0 };
    let ids: string[];
    let existing: Set<string>;
    try {
      ids = await this.storageRef.listRoomIds();
      if (!ids.length) {
        metrics.gauge("storage_orphan_objects", 0);
        this.orphanStreak = 0;
        return none;
      }
      existing = await this.store.existingRoomIds(ids);
    } catch (err) {
      metrics.inc("orphan_sweep_failures_total");
      log.warn("orphan.sweep_failed", { message: errText(err) });
      return none;
    }
    const live = new Set(Array.from(this.byCode.values()).map((a) => a.roomId.toLowerCase()));
    // Rem pengaman: store mengaku tidak ada satu pun room padahal ada room termuat di memori → data store tidak bisa dipercaya.
    if (existing.size === 0 && live.size > 0 && ids.some((id) => live.has(id.toLowerCase()))) {
      metrics.inc("orphan_sweep_failures_total");
      log.error("orphan.sweep_aborted", { reason: "store inconsistent with memory" });
      return { ...none, scanned: ids.length };
    }
    const orphans = ids.filter((id) => !existing.has(id.toLowerCase()) && !live.has(id.toLowerCase()));
    let objects = 0;
    for (const id of orphans) {
      try {
        const keys = await this.storageRef.list(roomPrefix(id));
        for (let i = 0; i < keys.length; i += 1000) await this.storageRef.deleteMany(keys.slice(i, i + 1000));
        objects += keys.length;
      } catch (err) {
        metrics.inc("orphan_sweep_failures_total");
        log.warn("orphan.delete_failed", { roomId: id, message: errText(err) });
      }
    }
    metrics.inc("storage_orphan_deleted_total", objects);
    metrics.gauge("storage_orphan_objects", objects);
    this.orphanStreak = objects > 0 ? this.orphanStreak + 1 : 0;
    if (objects > 0) log.warn("orphan.deleted", { rooms: orphans.length, objects });
    // Alarm: objek yatim muncul terus (>= 2 sapuan berturut-turut) → ada jalur yang membocorkan data.
    if (this.orphanStreak >= 2) log.error("alarm.orphans_recurring", { sweeps: this.orphanStreak, objects });
    return { scanned: ids.length, orphanRooms: orphans.length, orphanObjects: objects };
  }

  /** Tulis semua snapshot editor yang belum tersimpan (shutdown). Best-effort, tidak melempar. */
  async flushAll(): Promise<void> {
    await Promise.all(Array.from(this.byCode.values()).map((a) => a.flushEditors().catch((err) => log.warn("shutdown.flush_failed", { roomId: a.roomId, message: errText(err) }))));
  }

  /** Pekerjaan berkala tambahan per actor (mis. upload frame PENDING kedaluwarsa). */
  onSweep(hook: (actor: RoomActor) => Promise<void>) {
    this.sweepHooks.push(hook);
  }

  async sweep() {
    await this.recover().catch(() => undefined);
    let dirty = 0;
    for (const actor of this.byCode.values()) {
      await actor.checkTimers().catch(() => undefined);
      for (const hook of this.sweepHooks) await hook(actor).catch(() => undefined);
      dirty += actor.editorDirtyCount;
    }
    metrics.gauge("rooms_active", this.byCode.size);
    metrics.gauge("cleanup_unresolved", this.cleanup.unresolvedCount);
    metrics.gauge("editor_docs_dirty", dirty);
    // Alarm: cleanup tak tuntas > 30 menit (15 §8.3). Data pribadi masih tersimpan melewati janji retensi.
    for (const s of this.cleanup.stuck(30 * 60_000)) log.error("alarm.cleanup_stuck", { roomId: s.roomId, failures: s.failures, minutes: Math.round((Date.now() - s.sinceMs) / 60_000) });
    try {
      const purged = await this.store.purgeExpired();
      if (purged.tombstones || purged.rateLimits || purged.staleReservations) log.info("store.purged", purged);
    } catch {
      log.warn("store.purge_failed");
    }
  }

  get activeCount() {
    return this.byCode.size;
  }

  dispose() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.orphanTimer) clearInterval(this.orphanTimer);
    for (const actor of this.byCode.values()) actor.dispose();
    this.cleanup.dispose();
  }
}
