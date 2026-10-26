import { mkdir, readdir, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { ObjectStorage } from "./types";

/**
 * Storage di folder lokal (dev). Semua key dibatasi di dalam `root`; key yang keluar dari root
 * (path traversal) ditolak. Tidak pernah menyentuh data di luar folder ini.
 */
export class FsObjectStorage implements ObjectStorage {
  readonly kind = "fs";
  private readonly root: string;

  constructor(root: string) {
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
}
