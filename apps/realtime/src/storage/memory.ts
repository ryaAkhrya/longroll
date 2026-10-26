import type { ObjectStorage } from "./types";

/** Storage di memori (tes/dev). */
export class MemoryObjectStorage implements ObjectStorage {
  readonly kind = "memory";
  readonly objects = new Map<string, Uint8Array>();
  /** Tes: jumlah panggilan deleteMany berikutnya yang gagal. */
  failNextDeletes = 0;
  /** Tes: key yang "tidak ikut terhapus" (simulasi verifikasi gagal). */
  sticky = new Set<string>();

  async list(prefix: string) {
    return Array.from(this.objects.keys()).filter((k) => k.startsWith(prefix));
  }

  async deleteMany(keys: string[]) {
    if (this.failNextDeletes > 0) {
      this.failNextDeletes--;
      throw new Error("simulated delete failure");
    }
    for (const k of keys) if (!this.sticky.has(k)) this.objects.delete(k);
  }

  put(key: string, bytes = new Uint8Array([1])) {
    this.objects.set(key, bytes);
  }
}
