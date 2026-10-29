import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config";
import { S3ObjectStorage } from "../../src/storage/s3";

/**
 * Adapter S3 terhadap bucket NYATA (Neon Object Storage `longroll-dev`, privat). Hanya jalan bila
 * LONGROLL_TEST_S3=1 dan S3_* terisi (lihat HANDOFF_P09.md §Storage). Semua objek uji berada di bawah satu prefix
 * `rooms/{uuid-acak}/` dan hanya prefix itu yang dihapus. Tidak pernah menjalankan sweeper terhadap bucket bersama.
 */
const enabled = process.env.LONGROLL_TEST_S3 === "1";
const suite = enabled ? describe : describe.skip;

suite("S3ObjectStorage (bucket privat nyata)", () => {
  let storage: S3ObjectStorage;
  beforeAll(() => {
    const cfg = loadConfig(process.env).s3;
    if (!cfg) throw new Error("S3_* belum diset");
    storage = new S3ObjectStorage(cfg);
  });
  const roomId = crypto.randomUUID();
  const prefix = `rooms/${roomId}/`;
  const key = `${prefix}attempts/a/full.jpg`;
  afterAll(async () => {
    const keys = await storage?.list(prefix).catch(() => [] as string[]) ?? [];
    if (keys.length) await storage.deleteMany(keys).catch(() => undefined);
  });

  it("put/size/get/list/listRoomIds/deleteMany + verifikasi kosong (pola cleanup 15 §8.2)", async () => {
    expect(await storage.size(key)).toBeNull();
    await storage.put(key, new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), "image/jpeg");
    expect(await storage.size(key)).toBe(6);
    expect(Array.from((await storage.get(key, 100))!)).toEqual([0xff, 0xd8, 0xff, 1, 2, 3]);
    expect(await storage.get(key, 3)).toBeNull(); // melebihi maxBytes → ditolak
    expect(await storage.list(prefix)).toEqual([key]);
    expect(await storage.listRoomIds()).toContain(roomId);
    await storage.deleteMany([key]);
    expect(await storage.list(prefix)).toEqual([]);
    expect(await storage.size(key)).toBeNull();
  });

  it("presigned PUT terikat content-type & ukuran; presigned GET kedaluwarsa; bucket privat (tanpa tanda tangan ditolak)", async () => {
    const put = await storage.presignPut(key, { contentType: "image/jpeg", bytes: 4, expiresSec: 60 });
    const bad = await fetch(put.url, { method: "PUT", headers: { "Content-Type": "text/html" }, body: new Uint8Array([1, 2, 3, 4]) });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const good = await fetch(put.url, { method: "PUT", headers: put.headers, body: new Uint8Array([0xff, 0xd8, 0xff, 9]) });
    expect(good.ok).toBe(true);
    expect(await storage.size(key)).toBe(4);

    const get = await storage.presignGet(key, 60);
    const res = await fetch(get);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/jpeg");

    const unsigned = await fetch(get.split("?")[0]!);
    expect(unsigned.status).toBeGreaterThanOrEqual(400); // privat
    const short = await storage.presignGet(key, 1);
    await new Promise((r) => setTimeout(r, 2500));
    expect((await fetch(short)).status).toBeGreaterThanOrEqual(400); // TTL habis (TC-SEC-018)
  });
});
