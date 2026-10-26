import type { S2C } from "@longroll/shared";
import { ROOM_DEFAULTS } from "@longroll/shared";
import type { RoomState } from "../room/types";
import { StaleRevisionError, StoreUnavailableError, TOMBSTONE, windowStartMs } from "./types";
import type { LoadedRoom, RoomStore, SaveRoomInput } from "./types";

interface CodeRow {
  roomId: string | null;
  state: "ACTIVE" | "TOMBSTONE";
  tombstoneUntil: number | null;
  createdAt: number;
}

/**
 * Store di memori proses dengan semantik yang sama seperti adapter PostgreSQL (revisi, event,
 * tombstone eksplisit). Untuk tes & pengembangan tanpa database SAJA: hilang saat proses restart.
 */
export class MemoryRoomStore implements RoomStore {
  readonly kind = "memory" as const;
  private codes = new Map<string, CodeRow>();
  private rooms = new Map<string, RoomState>();
  private events = new Map<string, S2C[]>();
  private limits = new Map<string, { hits: number; expiresAt: number }>();
  /** Tes: simulasi database tidak tersedia. */
  failing = false;

  constructor(private readonly eventBufferSize: number = ROOM_DEFAULTS.eventBufferSize) {}

  private guard() {
    if (this.failing) throw new StoreUnavailableError("simulated");
  }

  async ping() {
    return !this.failing;
  }

  async reserveCode(code: string, roomId: string) {
    this.guard();
    const row = this.codes.get(code);
    if (row && !(row.state === "TOMBSTONE" && (row.tombstoneUntil ?? 0) <= Date.now())) return false;
    this.codes.set(code, { roomId, state: "ACTIVE", tombstoneUntil: null, createdAt: Date.now() });
    return true;
  }

  async releaseCode(code: string, roomId: string) {
    this.guard();
    const row = this.codes.get(code);
    if (row?.state === "ACTIVE" && row.roomId === roomId) this.codes.delete(code);
  }

  async resolveCode(code: string) {
    this.guard();
    const row = this.codes.get(code);
    if (!row) return null;
    if (row.state === "TOMBSTONE") return (row.tombstoneUntil ?? 0) > Date.now() ? TOMBSTONE : null;
    return row.roomId;
  }

  async saveRoom({ state, expectedRevision, events }: SaveRoomInput) {
    this.guard();
    const current = this.rooms.get(state.roomId);
    if (expectedRevision === 0 ? current !== undefined : current?.revision !== expectedRevision) {
      throw new StaleRevisionError(state.roomId);
    }
    this.rooms.set(state.roomId, structuredClone(state));
    if (events.length) {
      const list = [...(this.events.get(state.roomId) ?? []), ...structuredClone(events)];
      this.events.set(state.roomId, list.filter((e) => (e.seq ?? 0) > state.lastSeq - this.eventBufferSize));
    }
  }

  async loadRoom(roomId: string): Promise<LoadedRoom | null> {
    this.guard();
    const state = this.rooms.get(roomId);
    if (!state) return null;
    return { state: structuredClone(state), events: structuredClone(this.events.get(roomId) ?? []) };
  }

  async listRecoverableRooms() {
    this.guard();
    return Array.from(this.rooms.values())
      .filter((r) => r.status === "ACTIVE" || r.status === "GRACE" || r.status === "EXPIRING")
      .map((r) => ({ roomId: r.roomId, code: r.code }));
  }

  async finalizeExpiredRoom(roomId: string, code: string, tombstoneSeconds: number) {
    this.guard();
    this.rooms.delete(roomId);
    this.events.delete(roomId);
    const row = this.codes.get(code);
    if (!row || row.roomId === roomId || row.state === "TOMBSTONE") {
      this.codes.set(code, { roomId: null, state: "TOMBSTONE", tombstoneUntil: Date.now() + tombstoneSeconds * 1000, createdAt: Date.now() });
    }
  }

  async countRoomData(roomId: string) {
    this.guard();
    return (this.rooms.has(roomId) ? 1 : 0) + (this.events.get(roomId)?.length ?? 0);
  }

  async hit(key: string, windowSeconds: number) {
    this.guard();
    const start = windowStartMs(windowSeconds);
    const k = `${key}@${start}`;
    const row = this.limits.get(k) ?? { hits: 0, expiresAt: start + windowSeconds * 1000 };
    row.hits += 1;
    this.limits.set(k, row);
    return row.hits;
  }

  async peek(key: string, windowSeconds: number) {
    this.guard();
    return this.limits.get(`${key}@${windowStartMs(windowSeconds)}`)?.hits ?? 0;
  }

  async purgeExpired() {
    this.guard();
    const now = Date.now();
    let tombstones = 0;
    let rateLimits = 0;
    let staleReservations = 0;
    for (const [code, row] of this.codes) {
      if (row.state === "TOMBSTONE" && (row.tombstoneUntil ?? 0) <= now) {
        this.codes.delete(code);
        tombstones++;
      } else if (row.state === "ACTIVE" && row.roomId && !this.rooms.has(row.roomId) && now - row.createdAt > 3_600_000) {
        this.codes.delete(code);
        staleReservations++;
      }
    }
    for (const [k, row] of this.limits) {
      if (row.expiresAt <= now) {
        this.limits.delete(k);
        rateLimits++;
      }
    }
    return { tombstones, rateLimits, staleReservations };
  }

  async close() {}
}
