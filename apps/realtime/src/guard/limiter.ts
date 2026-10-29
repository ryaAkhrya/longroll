import { createHmac } from "node:crypto";

/**
 * Pembatas di memori proses (DEC-088: satu instance). Untuk lalu lintas bervolume tinggi yang tidak
 * perlu bertahan lintas restart dan TIDAK boleh membebani Neon (tiap `store.hit` = satu tulis DB).
 * Rate limit yang memang harus bertahan restart (create/join/kode salah) tetap di store (RateLimiter).
 *
 * Fixed window per kunci, jumlah kunci dibatasi (memori terbatas): bila penuh, kunci paling lama dibuang.
 */
export class MemoryLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly maxKeys = 20_000,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
    const t = this.now();
    const start = Math.floor(t / windowMs) * windowMs;
    let e = this.hits.get(key);
    if (!e || e.windowStart !== start) {
      e = { windowStart: start, count: 0 };
      this.hits.delete(key); // pindah ke ujung urutan penyisipan (LRU kasar)
      this.hits.set(key, e);
      if (this.hits.size > this.maxKeys) this.evict(start);
    }
    e.count++;
    return { ok: e.count <= max, retryAfterSec: Math.max(1, Math.ceil((start + windowMs - t) / 1000)) };
  }

  /** Buang entri window lama dulu; bila masih penuh, buang yang tertua. */
  private evict(currentStart: number) {
    for (const [k, v] of this.hits) {
      if (v.windowStart < currentStart) this.hits.delete(k);
      if (this.hits.size <= this.maxKeys * 0.9) return;
    }
    for (const k of this.hits.keys()) {
      this.hits.delete(k);
      if (this.hits.size <= this.maxKeys * 0.9) return;
    }
  }

  get size() {
    return this.hits.size;
  }
}

export const SALT_ROTATION_MS = 24 * 60 * 60 * 1000;

/** Salt hash IP berotasi per epoch (15 §9): IP lama tidak bisa dikorelasikan lintas epoch dari data tersimpan. */
export function saltForEpoch(baseSalt: string, nowMs = Date.now(), rotationMs = SALT_ROTATION_MS): string {
  const epoch = Math.floor(nowMs / rotationMs);
  return createHmac("sha256", baseSalt).update(`epoch:${epoch}`).digest("base64url");
}

/** Token bucket sederhana (byte/detik) untuk batas laju per koneksi. */
export class ByteBucket {
  private tokens: number;
  private at: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.at = now();
  }

  take(amount: number): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.at) / 1000) * this.ratePerSec);
    this.at = t;
    if (amount > this.tokens) return false;
    this.tokens -= amount;
    return true;
  }
}
