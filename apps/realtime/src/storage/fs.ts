import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { LocalUrlSigner } from "./signer";
import type { ObjectStorage } from "./types";

const TYPES: Record<string, string> = { png: "image/png", webp: "image/webp" };

/**
 * Storage di folder lokal (dev). Semua key dibatasi di dalam `root`; key yang keluar dari root
 * (path traversal) ditolak. Tidak pernah menyentuh data di luar folder ini. BUKAN untuk produksi:
 * tidak tahan multi-instance & disk ephemeral (lihat S3ObjectStorage).
 */
export class FsObjectStorage implements ObjectStorage {
  readonly kind = "fs";
  private readonly root: string;

  constructor(
    root: string,
    readonly signer: LocalUrlSigner = new LocalUrlSigner("http://localhost:4000"),
  ) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + sep)) throw new Error("Key di luar root storage");
    return full;
  }

  async list(prefix: string): Promise<string[]> {
    await mkdir(this.root, { recursive: true });
    const dir = this.pathFor(prefix.endsWith("/") ? prefix : prefix.slice(0, prefix.lastIndexOf("/") + 1));
    let entries: string[] = [];
    try {
      entries = (await readdir(dir, { recursive: true, withFileTypes: true }))
        .filter((d) => d.isFile())
        .map((d) => relative(this.root, join(d.parentPath, d.name)).split(sep).join("/"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    return entries.filter((k) => k.startsWith(prefix));
  }

  async deleteMany(keys: string[]) {
    for (const key of keys) await rm(this.pathFor(key), { force: true });
  }

  async put(key: string, bytes: Uint8Array) {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(key: string, maxBytes: number) {
    const size = await this.size(key);
    if (size === null || size > maxBytes) return null;
    return new Uint8Array(await readFile(this.pathFor(key)));
  }

  async size(key: string) {
    try {
      return (await stat(this.pathFor(key))).size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async presignPut(key: string, opts: { contentType: string; bytes: number; expiresSec: number }) {
    const url = this.signer.sign({ k: key, m: "PUT", e: Math.floor(Date.now() / 1000) + opts.expiresSec, ct: opts.contentType, max: opts.bytes });
    return { url, headers: { "Content-Type": opts.contentType } };
  }

  async presignGet(key: string, expiresSec: number) {
    return this.signer.sign({ k: key, m: "GET", e: Math.floor(Date.now() / 1000) + expiresSec });
  }

  contentTypeOf(key: string) {
    return TYPES[key.split(".").pop() ?? ""] ?? "application/octet-stream";
  }
}
