import { RATE_LIMITS } from "@longroll/shared";
import { hashIp } from "../security";
import { MemoryLimiter, saltForEpoch } from "../guard/limiter";
import type { RoomStore } from "../store/types";

export type LimitKind = "create" | "join" | "wrongCode" | "preview";

/** Batas lalu lintas HTTP umum per IP di memori (menjaga Neon dari tulis berlebih). Cukup longgar untuk 4 peserta satu NAT. */
export const GENERAL_LIMITS = {
  /** Semua request /api/* kecuali storage lokal. */
  api: { max: 900, windowMs: 60_000 },
  /** Fetch/PUT storage lokal (foto, frame, pratinjau). */
  storage: { max: 1_800, windowMs: 60_000 },
  /** Percobaan upgrade WebSocket (sukses maupun gagal) — sambung ulang agresif tetap lolos. */
  upgrade: { max: 240, windowMs: 60_000 },
} as const;

/** Pengaman global (bukan per IP): pembuatan room per menit seluruh instance (15 §9). */
export const GLOBAL_CREATE_PER_MINUTE = 120;

/**
 * Rate limit DEC-067 per hash IP bersalt (15 §9). Salt diputar per epoch 24 jam. Gagal-tertutup bila store
 * tidak tersedia (exception diteruskan ke pemanggil → SERVICE_UNAVAILABLE).
 */
export class RateLimiter {
  readonly memory = new MemoryLimiter();

  constructor(
    private readonly store: RoomStore,
    private readonly salt: string,
    private readonly now: () => number = Date.now,
  ) {}

  private key(kind: string, ip: string) {
    return `${kind}:${hashIp(ip, saltForEpoch(this.salt, this.now()))}`;
  }

  /** Tambah hitungan; false bila melewati batas. */
  async consume(kind: LimitKind, ip: string): Promise<{ ok: boolean; retryAfterSec: number }> {
    const { max, windowSeconds } = RATE_LIMITS[kind];
    const n = await this.store.hit(this.key(kind, ip), windowSeconds);
    return { ok: n <= max, retryAfterSec: this.retryAfter(windowSeconds) };
  }

  /** Cek tanpa menambah (dipakai untuk blokir kode salah sebelum lookup). */
  async blocked(kind: LimitKind, ip: string): Promise<{ blocked: boolean; retryAfterSec: number }> {
    const { max, windowSeconds } = RATE_LIMITS[kind];
    const n = await this.store.peek(this.key(kind, ip), windowSeconds);
    return { blocked: n >= max, retryAfterSec: this.retryAfter(windowSeconds) };
  }

  /** Batas lalu lintas umum per IP (memori). */
  general(kind: keyof typeof GENERAL_LIMITS, ip: string): { ok: boolean; retryAfterSec: number } {
    const { max, windowMs } = GENERAL_LIMITS[kind];
    return this.memory.take(this.key(`g-${kind}`, ip), max, windowMs);
  }

  /** Pengaman global pembuatan room. */
  globalCreate(): { ok: boolean; retryAfterSec: number } {
    return this.memory.take("global:create", GLOBAL_CREATE_PER_MINUTE, 60_000);
  }

  private retryAfter(windowSeconds: number) {
    const windowMs = windowSeconds * 1000;
    return Math.ceil((windowMs - (this.now() % windowMs)) / 1000);
  }
}
