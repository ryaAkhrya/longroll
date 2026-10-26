import type { ParticipantView } from "@longroll/shared";
import { log } from "../log";
import { generateRoomCode, uuidv7 } from "../security";
import { TOMBSTONE } from "../store/types";
import type { RoomStore } from "../store/types";
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

  constructor(
    private readonly store: RoomStore,
    storage: ObjectStorage,
    private readonly config: ActorConfig & { cleanupRetrySeconds: number[] },
  ) {
    this.cleanup = new RoomCleanup({ store, storage, retrySeconds: config.cleanupRetrySeconds });
  }

  private makeActor(state: ConstructorParameters<typeof RoomActor>[0], events: ConstructorParameters<typeof RoomActor>[2] = []) {
    return new RoomActor(
      state,
      {
        store: this.store,
        config: this.config,
        onExpiring: (actor) => this.runCleanup(actor),
      },
      events,
    );
  }

  /** Bikin room (07 §2): kode CSPRNG + registry NX (maks. 5 percobaan), pembuat = peserta pertama. */
  async create(displayName: unknown): Promise<{ actor: RoomActor; participant: ParticipantView; token: string }> {
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
        log.warn("room.recover_failed", { message: err instanceof Error ? err.message : "error" });
      }
    }
    return entries.length;
  }

  /**
   * Sweeper (15 §8.3, versi dasar). PostgreSQL tidak punya TTL: tombstone, counter rate limit, dan
   * reservasi yatim dihapus eksplisit di sini; room yang belum termuat dipulihkan; timer diperiksa ulang.
   */
  startSweeper(intervalMs: number) {
    this.sweepTimer = setInterval(() => void this.sweep(), intervalMs);
    this.sweepTimer.unref?.();
  }

  async sweep() {
    await this.recover().catch(() => undefined);
    for (const actor of this.byCode.values()) await actor.checkTimers().catch(() => undefined);
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
    for (const actor of this.byCode.values()) actor.dispose();
    this.cleanup.dispose();
  }
}
