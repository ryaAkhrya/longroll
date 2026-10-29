import * as Y from "yjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addSticker, createEditorDoc, fromBase64, listElements, toBase64 } from "@longroll/shared";
import type { EditorCtx } from "@longroll/shared";
import { CaptureRoom } from "../../test/fixtures/capture";
import { metrics } from "../log";
import { MemoryObjectStorage } from "../storage/memory";
import { MemoryRoomStore } from "../store/memory";
import { RoomManager } from "./RoomManager";
import { RoomCleanup } from "./cleanup";

const CFG = {
  graceSeconds: 1,
  holdSeconds: 1,
  maxLifetimeHours: null,
  connectDeadlineMs: 1000,
  credentialTtlSeconds: 3600,
  credentialRotationGraceMs: 1000,
  cleanupRetrySeconds: [1],
};
const uuid = () => crypto.randomUUID();

describe("P09 sweeper objek yatim (15 §8.3, TC-SEC-031)", () => {
  async function setup(maxActiveRooms?: number) {
    const store = new MemoryRoomStore();
    const storage = new MemoryObjectStorage();
    const manager = new RoomManager(store, storage, { ...CFG, maxActiveRooms });
    return { store, storage, manager };
  }

  it("menghapus objek room yang sudah tidak ada; room hidup & room lain tidak tersentuh; aman diulang", async () => {
    const { storage, manager } = await setup();
    const live = await manager.create("Nadia");
    const orphanA = uuid();
    const orphanB = uuid();
    await storage.put(`rooms/${live.actor.roomId}/attempts/a/full.jpg`);
    await storage.put(`rooms/${orphanA}/attempts/a/full.jpg`);
    await storage.put(`rooms/${orphanA}/frames/f.png`);
    await storage.put(`rooms/${orphanB}/sessions/s/preview.webp`);
    await storage.put("rooms/not-a-uuid/x.bin");
    await storage.put("other/keep.txt");

    const r1 = await manager.sweepOrphans();
    expect(r1).toMatchObject({ scanned: 4, orphanRooms: 3, orphanObjects: 4 });
    expect((await storage.list("rooms/")).sort()).toEqual([`rooms/${live.actor.roomId}/attempts/a/full.jpg`]);
    expect(await storage.list("other/")).toEqual(["other/keep.txt"]);
    expect(metrics.get("storage_orphan_deleted_total")).toBeGreaterThanOrEqual(4);

    const r2 = await manager.sweepOrphans();
    expect(r2.orphanObjects).toBe(0);
    manager.dispose();
  });

  it("store tidak terjangkau → tidak ada yang dihapus (gagal-aman) dan kegagalan dihitung", async () => {
    const { store, storage, manager } = await setup();
    const orphan = uuid();
    await storage.put(`rooms/${orphan}/x.jpg`);
    const before = metrics.get("orphan_sweep_failures_total");
    store.failing = true;
    // existingRoomIds memakai guard store; jangan hapus apa pun bila store sedang bermasalah.
    const r = await manager.sweepOrphans();
    store.failing = false;
    expect(r.orphanObjects).toBe(0);
    expect(await storage.list(`rooms/${orphan}/`)).toHaveLength(1);
    expect(metrics.get("orphan_sweep_failures_total")).toBe(before + 1);
    manager.dispose();
  });

  it("rem pengaman: store mengaku tak punya room yang termuat di memori → sapuan dibatalkan", async () => {
    const { store, storage, manager } = await setup();
    const live = await manager.create("Nadia");
    await storage.put(`rooms/${live.actor.roomId}/a.jpg`);
    await storage.put(`rooms/${uuid()}/b.jpg`);
    // Simulasi store kosong/salah koneksi: room termuat tapi store tak mengenalinya.
    await store.finalizeExpiredRoom(live.actor.roomId, live.actor.code, 60);
    const r = await manager.sweepOrphans();
    expect(r.orphanObjects).toBe(0);
    expect(await storage.list("rooms/")).toHaveLength(2);
    manager.dispose();
  });

  it("batas room aktif per instance: di atas batas → SERVICE_UNAVAILABLE (memori terbatas)", async () => {
    const { manager } = await setup(2);
    await manager.create("A");
    await manager.create("B");
    await expect(manager.create("C")).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE", reason: "CAPACITY" });
    manager.dispose();
  });
});

describe("P09 cleanup macet terdeteksi (alarm)", () => {
  it("room yang cleanup-nya terus gagal muncul di stuck() dan hilang setelah berhasil", async () => {
    const store = new MemoryRoomStore();
    const storage = new MemoryObjectStorage();
    const id = uuid();
    await store.reserveCode("STUCK2", id);
    await storage.put(`rooms/${id}/frames/f.png`);
    storage.sticky.add(`rooms/${id}/frames/f.png`);
    const cleanup = new RoomCleanup({ store, storage, retrySeconds: [1] });
    cleanup.schedule(id, "STUCK2", () => undefined);
    await vi.waitFor(() => expect(cleanup.stuck(0).map((s) => s.roomId)).toContain(id));
    expect(cleanup.stuck(60 * 60_000)).toEqual([]);
    storage.sticky.clear();
    await vi.waitFor(() => expect(cleanup.unresolvedCount).toBe(0), { timeout: 4000 });
    cleanup.dispose();
  });
});

describe("P09 ketahanan snapshot editor", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  async function editing() {
    const r = await CaptureRoom.create(2, { shots: 1 });
    await r.fullShot();
    expect(r.session.state).toBe("EDITING");
    await vi.advanceTimersByTimeAsync(20);
    const p = r.people[0]!;
    const doc = createEditorDoc();
    const ack = await r.actor.intent(p.id, "editor.sync", { sessionId: r.sid, stateVector: toBase64(Y.encodeStateVector(doc)) });
    Y.applyUpdate(doc, fromBase64((ack.data as { update: string }).update), "remote");
    const ctx: EditorCtx = { participantId: p.id, name: p.name, origin: { p: p.id }, now: () => Date.now() };
    const sv = Y.encodeStateVector(doc);
    const last = { upd: "" };
    const edit = async () => {
      addSticker(doc, ctx, "heart", { x: 30, y: 30 });
      last.upd = toBase64(Y.encodeStateAsUpdate(doc, sv));
      return r.actor.intent(p.id, "editor.update", { sessionId: r.sid, update: last.upd });
    };
    return { r, edit, last, p };
  }

  const savedStickers = async (r: CaptureRoom) => {
    const d = createEditorDoc();
    Y.applyUpdate(d, (await r.store.loadEditorDoc(r.sid))!);
    return listElements(d).filter((e) => e.type === "sticker").length;
  };

  it("store mati saat snapshot → dicoba lagi otomatis sampai tersimpan (tanpa menunggu update berikutnya)", async () => {
    const { r, edit } = await editing();
    await vi.advanceTimersByTimeAsync(6000);
    r.store.failing = true;
    expect((await edit()).ok).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000); // beberapa percobaan gagal
    expect(await savedStickers(r).catch(() => -1)).not.toBe(1);
    expect(r.actor.editorDirtyCount).toBe(1);
    r.store.failing = false;
    await vi.advanceTimersByTimeAsync(6000);
    expect(r.actor.editorDirtyCount).toBe(0);
    expect(await savedStickers(r)).toBe(1);
  });

  it("replay update yang sama, update sampah, base64 rusak, dan update raksasa: state tidak berubah & server tetap sehat (TH-11)", async () => {
    const { r, edit, last, p } = await editing();
    expect((await edit()).ok).toBe(true);
    for (let i = 0; i < 3; i++) expect((await r.actor.intent(p.id, "editor.update", { sessionId: r.sid, update: last.upd })).ok).toBe(true); // idempoten (CRDT)
    const garbage = await r.actor.intent(p.id, "editor.update", { sessionId: r.sid, update: toBase64(new Uint8Array([1, 2, 3, 4, 5])) });
    expect(garbage).toMatchObject({ ok: false });
    expect(await r.actor.intent(p.id, "editor.update", { sessionId: r.sid, update: "!!!bukan-base64!!!" })).toMatchObject({ ok: false });
    expect(await r.actor.intent(p.id, "editor.update", { sessionId: r.sid, update: "A".repeat(400_000) })).toMatchObject({ ok: false, error: "DOC_TOO_LARGE" });
    expect(await r.actor.intent(p.id, "editor.update", { sessionId: r.sid, update: 12345 })).toMatchObject({ ok: false });
    await r.actor.flushEditors();
    expect(await savedStickers(r)).toBe(1); // satu stiker, tidak terduplikasi atau rusak
  });

  it("flushEditors (shutdown rapi) menulis perubahan yang belum sempat di-snapshot SEKARANG", async () => {
    const { r, edit } = await editing();
    await vi.advanceTimersByTimeAsync(6000);
    await edit();
    expect(r.actor.editorDirtyCount).toBe(1);
    const writes = r.store.editorWrites;
    await r.actor.flushEditors();
    expect(r.store.editorWrites).toBe(writes + 1);
    expect(r.actor.editorDirtyCount).toBe(0);
    expect(await savedStickers(r)).toBe(1);
  });
});

describe("TC-ROOM-026 / AC-12: room dengan peserta terhubung tidak berakhir karena umur (DEC-052 default)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("13+ jam berlalu dengan peserta tetap terhubung → room tetap ACTIVE, kredensial diperbarui tiap jam, tidak ada expiry", async () => {
    const { RoomActor } = await import("./RoomActor");
    const { TestConn } = await import("../../test/fixtures/capture");
    const store = new MemoryRoomStore();
    const cfg = { ...CFG, graceSeconds: 120, holdSeconds: 60, credentialTtlSeconds: 3600 };
    const onExpiring = vi.fn();
    const actor = new RoomActor(RoomActor.createState("room-long", "LONG22", cfg), { store, config: cfg, onExpiring });
    const joined = await actor.join("Nadia");
    await actor.attach(new TestConn(), joined.participant.participantId, null);
    expect(actor.snapshot().expiresAtMs).toBeNull();
    let token = joined.token;
    for (let h = 0; h < 14; h++) {
      await vi.advanceTimersByTimeAsync(3_400_000); // siklus 3500 dtk < TTL kredensial 1 jam (klien memperbarui lebih awal)
      await actor.checkTimers();
      const refreshed = await actor.refreshSession(token); // klien memanggil /session saat reload/reconnect
      token = refreshed.token;
      await vi.advanceTimersByTimeAsync(100_000);
    }
    expect(actor.snapshot().status).toBe("ACTIVE");
    expect(actor.view().participants[0]!.connection).toBe("CONNECTED");
    expect(onExpiring).not.toHaveBeenCalled();
    actor.dispose();
  });
});
