import { LocalUrlSigner } from "./signer";
import type { ObjectStorage } from "./types";

/** Storage di memori (tes/dev). URL bertanda tangan disajikan service realtime (`/api/storage`). */
export class MemoryObjectStorage implements ObjectStorage {
  readonly kind = "memory";
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  /** Tes: jumlah panggilan deleteMany berikutnya yang gagal. */
  failNextDeletes = 0;
  /** Tes: key yang "tidak ikut terhapus" (simulasi verifikasi gagal). */
  sticky = new Set<string>();

  constructor(readonly signer: LocalUrlSigner = new LocalUrlSigner("http://localhost:4000")) {}

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

  async put(key: string, bytes: Uint8Array = new Uint8Array([1]), contentType = "application/octet-stream") {
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType });
  }

  async get(key: string, maxBytes: number) {
    const o = this.objects.get(key);
    if (!o || o.bytes.byteLength > maxBytes) return null;
    return o.bytes;
  }

  async size(key: string) {
    return this.objects.get(key)?.bytes.byteLength ?? null;
  }

  async presignPut(key: string, opts: { contentType: string; bytes: number; expiresSec: number }) {
    const url = this.signer.sign({ k: key, m: "PUT", e: Math.floor(Date.now() / 1000) + opts.expiresSec, ct: opts.contentType, max: opts.bytes });
    return { url, headers: { "Content-Type": opts.contentType } };
  }

  async presignGet(key: string, expiresSec: number) {
    return this.signer.sign({ k: key, m: "GET", e: Math.floor(Date.now() / 1000) + expiresSec });
  }

  contentTypeOf(key: string) {
    return this.objects.get(key)?.contentType ?? null;
  }
}
