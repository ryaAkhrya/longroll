import { describe, expect, it } from "vitest";
import { MemoryObjectStorage } from "../storage/memory";
import { MemoryRoomStore } from "../store/memory";
import { RoomActor } from "./RoomActor";
import { RoomCleanup } from "./cleanup";

const CFG = {
  graceSeconds: 1,
  holdSeconds: 1,
  maxLifetimeHours: null,
  connectDeadlineMs: 1000,
  credentialTtlSeconds: 3600,
  credentialRotationGraceMs: 1000,
};

async function seed() {
  const store = new MemoryRoomStore();
  const storage = new MemoryObjectStorage();
  await store.reserveCode("GENG27", "room-a");
  const actor = new RoomActor(RoomActor.createState("room-a", "GENG27", CFG), { store, config: CFG, onExpiring: () => undefined });
  await actor.join("Nadia");
  actor.dispose();
  storage.put("rooms/room-a/attempts/1/preview.jpg");
  storage.put("rooms/room-a/frames/f.png");
  storage.put("rooms/room-b/keep.jpg");
  return { store, storage };
}

describe("RoomCleanup (15 §8.2, TC-SEC-030 dengan objek dummy)", () => {
  it("menghapus objek & data room, menulis tombstone, dan memverifikasi", async () => {
    const { store, storage } = await seed();
    expect(await store.countRoomData("room-a")).toBeGreaterThan(0);
    const cleanup = new RoomCleanup({ store, storage, retrySeconds: [1] });
    expect(await cleanup.attempt("room-a", "GENG27")).toBe(true);
    expect(await storage.list("rooms/room-a/")).toEqual([]);
    expect(await storage.list("rooms/room-b/")).toEqual(["rooms/room-b/keep.jpg"]);
    expect(await store.countRoomData("room-a")).toBe(0);
    expect(await store.resolveCode("GENG27")).toBe("EXPIRED");
    expect(await store.listRecoverableRooms()).toEqual([]);
  });

  it("objek storage tertinggal → false dan data room TIDAK dihapus (sweeper mencoba lagi)", async () => {
    const { store, storage } = await seed();
    storage.sticky.add("rooms/room-a/frames/f.png");
    const cleanup = new RoomCleanup({ store, storage, retrySeconds: [1] });
    expect(await cleanup.attempt("room-a", "GENG27")).toBe(false);
    expect((await store.listRecoverableRooms()).map((e) => e.roomId)).toContain("room-a");
    storage.sticky.clear();
    expect(await cleanup.attempt("room-a", "GENG27")).toBe(true);
  });

  it("kegagalan delete storage atau database tidak melempar dan aman diulang", async () => {
    const { store, storage } = await seed();
    storage.failNextDeletes = 1;
    const cleanup = new RoomCleanup({ store, storage, retrySeconds: [1] });
    expect(await cleanup.attempt("room-a", "GENG27")).toBe(false);
    store.failing = true;
    expect(await cleanup.attempt("room-a", "GENG27")).toBe(false);
    store.failing = false;
    expect(await cleanup.attempt("room-a", "GENG27")).toBe(true);
    expect(await cleanup.attempt("room-a", "GENG27")).toBe(true);
  });

  it("tombstone memblokir pemakaian ulang kode sampai purge setelah kedaluwarsa", async () => {
    const store = new MemoryRoomStore();
    await store.finalizeExpiredRoom("room-x", "KODE22", 0.05);
    expect(await store.reserveCode("KODE22", "room-y")).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect(await store.resolveCode("KODE22")).toBeNull();
    expect((await store.purgeExpired()).tombstones).toBe(1);
    expect(await store.reserveCode("KODE22", "room-y")).toBe(true);
  });
});
