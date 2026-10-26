import { RATE_LIMITS } from "@longroll/shared";
import { hashIp } from "../security";
import type { RoomStore } from "../store/types";

export type LimitKind = "create" | "join" | "wrongCode" | "preview";

/** Rate limit DEC-067 per hash IP bersalt (15 §9). Gagal-tertutup bila store tidak tersedia. */
export class RateLimiter {
  constructor(
    private readonly store: RoomStore,
    private readonly salt: string,
  ) {}

  private key(kind: LimitKind, ip: string) {
    return `${kind}:${hashIp(ip, this.salt)}`;
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

  private retryAfter(windowSeconds: number) {
    const windowMs = windowSeconds * 1000;
    return Math.ceil((windowMs - (Date.now() % windowMs)) / 1000);
  }
}
