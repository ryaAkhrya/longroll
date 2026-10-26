import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS_CLOSE } from "@longroll/shared";
import type { S2C } from "@longroll/shared";
import { MemoryRoomStore } from "../store/memory";
import { RoomActor } from "./RoomActor";
import type { ActorConfig } from "./RoomActor";
import type { RoomConnection } from "./types";

const CONFIG: ActorConfig = {
  graceSeconds: 120,
  holdSeconds: 60,
  maxLifetimeHours: null,
  connectDeadlineMs: 15_000,
  credentialTtlSeconds: 12 * 3600,
  credentialRotationGraceMs: 60_000,
};

class FakeConn implements RoomConnection {
  static n = 0;
  readonly id = `c${FakeConn.n++}`;
  messages: S2C[] = [];
  closed: number | null = null;
  send(m: S2C) {
    this.messages.push(m);
  }
  close(code: number) {
    this.closed = code;
  }
  types() {
    return this.messages.map((m) => m.type);
  }
}

function setup(config: Partial<ActorConfig> = {}) {
  const store = new MemoryRoomStore();
  const onExpiring = vi.fn();
  const cfg = { ...CONFIG, ...config };
  const actor = new RoomActor(RoomActor.createState("room-1", "GENG27", cfg), { store, config: cfg, onExpiring });
  return { store, actor, onExpiring, cfg };
}

async function joinAndAttach(actor: RoomActor, name: string) {
  const r = await actor.join(name);
  const conn = new FakeConn();
  await actor.attach(conn, r.participant.participantId, null);
  return { ...r, conn };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("kapasitas & warna", () => {
  it("menolak peserta ke-5 (ROOM_FULL)", async () => {
    const { actor } = setup();
    for (const n of ["A", "B", "C", "D"]) await actor.join(n);
    await expect(actor.join("E")).rejects.toMatchObject({ code: "ROOM_FULL" });
  });

  it("join bersamaan untuk slot terakhir: tepat 4 menang (EC-02)", async () => {
    const { actor } = setup();
    const results = await Promise.allSettled(["A", "B", "C", "D", "E", "F"].map((n) => actor.join(n)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);
    expect(Object.keys(actor.snapshot().participants)).toHaveLength(4);
  });

  it("warna unik P1..P4 dan dipakai ulang setelah LEFT (DEC-044)", async () => {
    const { actor } = setup();
    const a = await actor.join("A");
    const b = await actor.join("B");
    expect([a.participant.color, b.participant.color]).toEqual(["P1", "P2"]);
    await actor.leave(a.participant.participantId);
    const c = await actor.join("C");
    expect(c.participant.color).toBe("P1");
  });

  it("nama duplikat diberi sufiks (DEC-043) dan nama tidak valid ditolak", async () => {
    const { actor } = setup();
    await actor.join("Raka");
    expect((await actor.join("raka")).participant.displayName).toBe("raka 2");
    await expect(actor.join("   ")).rejects.toMatchObject({ code: "NAME_INVALID" });
    await expect(actor.join("<script>")).rejects.toMatchObject({ code: "NAME_INVALID" });
  });

  it("ROOM_FULL karena slot ditahan memberi alasan HOLD", async () => {
    const { actor } = setup();
    const people = [];
    for (const n of ["A", "B", "C", "D"]) people.push(await joinAndAttach(actor, n));
    await actor.detach(people[0]!.conn, people[0]!.participant.participantId);
    await expect(actor.join("E")).rejects.toMatchObject({ code: "ROOM_FULL", reason: "HOLD" });
  });
});

describe("presence, hold slot, grace", () => {
  it("putus → RECONNECTING; reconnect dalam hold memulihkan slot & warna", async () => {
    const { actor } = setup();
    const a = await joinAndAttach(actor, "A");
    const b = await joinAndAttach(actor, "B");
    await actor.detach(b.conn, b.participant.participantId);
    expect(actor.snapshot().participants[b.participant.participantId]!.connection).toBe("RECONNECTING");
    expect(a.conn.messages.some((m) => m.type === "presence.update" && (m.payload as { connection?: string }).connection === "RECONNECTING")).toBe(true);

    await vi.advanceTimersByTimeAsync(30_000);
    const pid = actor.authenticate(b.token);
    expect(pid).toBe(b.participant.participantId);
    await actor.attach(new FakeConn(), pid!, null);
    const p = actor.snapshot().participants[pid!]!;
    expect(p.connection).toBe("CONNECTED");
    expect(p.color).toBe("P2");
  });

  it("hold habis → LEFT, token dicabut, room tetap GRACE dan join baru tetap boleh", async () => {
    const { actor } = setup();
    const a = await joinAndAttach(actor, "A");
    await actor.detach(a.conn, a.participant.participantId);
    expect(actor.status).toBe("GRACE");

    await vi.advanceTimersByTimeAsync(61_000);
    expect(actor.snapshot().participants[a.participant.participantId]!.connection).toBe("LEFT");
    expect(actor.authenticate(a.token)).toBeNull();
    expect(actor.status).toBe("GRACE");

    // Setelah hold tapi sebelum grace habis: kembali sebagai peserta baru (tidak memulihkan kredensial lama).
    const again = await actor.join("A");
    expect(again.participant.participantId).not.toBe(a.participant.participantId);
    expect(actor.status).toBe("ACTIVE");
  });

  it("grace habis → EXPIRING, onExpiring dipanggil, join ditolak ROOM_EXPIRED", async () => {
    const { actor, onExpiring } = setup();
    const a = await joinAndAttach(actor, "A");
    await actor.detach(a.conn, a.participant.participantId);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(actor.status).toBe("GRACE");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(actor.status).toBe("EXPIRING");
    expect(onExpiring).toHaveBeenCalledTimes(1);
    await expect(actor.join("B")).rejects.toMatchObject({ code: "ROOM_EXPIRED" });
  });

  it("join saat GRACE mengaktifkan room lagi (07 §3.1)", async () => {
    const { actor } = setup();
    const a = await joinAndAttach(actor, "A");
    await actor.detach(a.conn, a.participant.participantId);
    expect(actor.status).toBe("GRACE");
    await actor.join("B");
    expect(actor.status).toBe("ACTIVE");
    expect(actor.snapshot().emptySinceMs).toBeNull();
  });

  it("room dengan peserta terhubung tidak pernah expired karena umur (DEC-052 default)", async () => {
    const { actor } = setup();
    await joinAndAttach(actor, "A");
    expect(actor.snapshot().expiresAtMs).toBeNull();
    await vi.advanceTimersByTimeAsync(72 * 3600 * 1000);
    expect(actor.status).toBe("ACTIVE");
  });

  it("peserta yang join tapi tidak pernah membuka WS menjadi RECONNECTING setelah tenggat", async () => {
    const { actor } = setup();
    const a = await actor.join("A");
    await vi.advanceTimersByTimeAsync(16_000);
    expect(actor.snapshot().participants[a.participant.participantId]!.connection).toBe("RECONNECTING");
  });

  it("keluar mencabut token dan menutup socket", async () => {
    const { actor } = setup();
    const a = await joinAndAttach(actor, "A");
    await actor.leave(a.participant.participantId);
    expect(actor.authenticate(a.token)).toBeNull();
    expect(a.conn.closed).toBe(WS_CLOSE.LEFT);
  });
});

describe("multi-tab, resume, idempotensi", () => {
  it("tab baru mengambil alih; tab lama dapat session.replaced (DEC-083)", async () => {
    const { actor } = setup();
    const a = await joinAndAttach(actor, "A");
    const tab2 = new FakeConn();
    await actor.attach(tab2, a.participant.participantId, null);
    expect(a.conn.types()).toContain("session.replaced");
    expect(a.conn.closed).toBe(WS_CLOSE.REPLACED);
    await actor.detach(a.conn, a.participant.participantId);
    expect(actor.snapshot().participants[a.participant.participantId]!.connection).toBe("CONNECTED");
  });

  it("resume me-replay event sejak lastSeq; lastSeq di luar buffer → snapshot", async () => {
    const { actor } = setup();
    const a = await joinAndAttach(actor, "A");
    const seq = actor.snapshot().lastSeq;
    await actor.join("B");
    await actor.join("C");
    const replay = new FakeConn();
    actor.resume(replay, seq);
    expect(replay.types()).toEqual(["participant.joined", "participant.joined"]);
    const snap = new FakeConn();
    actor.resume(snap, seq + 999);
    expect(snap.types()).toEqual(["room.snapshot"]);
    expect(a.conn.messages.every((m) => !("tokenHash" in JSON.parse(JSON.stringify(m.payload))))).toBe(true);
  });

  it("clientEventId sama tidak menimbulkan efek ganda", async () => {
    const { actor } = setup();
    const a = await joinAndAttach(actor, "A");
    const before = actor.snapshot().lastSeq;
    const r1 = await actor.intent(a.participant.participantId, "presence.set", { ready: true }, "evt-1");
    const r2 = await actor.intent(a.participant.participantId, "presence.set", { ready: true }, "evt-1");
    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    expect(actor.snapshot().lastSeq).toBe(before + 1);
  });
});

describe("persistensi & kredensial", () => {
  it("store gagal → SERVICE_UNAVAILABLE dan state tidak berubah", async () => {
    const { actor, store } = setup();
    await actor.join("A");
    store.failing = true;
    await expect(actor.join("B")).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    store.failing = false;
    expect(Object.keys(actor.snapshot().participants)).toHaveLength(1);
  });

  it("recovery dari snapshot: CONNECTED → RECONNECTING, grace dari emptySinceMs tersimpan", async () => {
    const { actor, store, cfg } = setup();
    await joinAndAttach(actor, "A");
    actor.dispose();
    const saved = await store.loadRoom("room-1");
    const onExpiring = vi.fn();
    const recovered = new RoomActor(saved!.state, { store, config: cfg, onExpiring }, saved!.events);
    await recovered.recover();
    expect(Object.values(recovered.snapshot().participants)[0]!.connection).toBe("RECONNECTING");
    expect(recovered.status).toBe("GRACE");
    await vi.advanceTimersByTimeAsync(121_000);
    expect(onExpiring).toHaveBeenCalled();
  });

  it("setelah restart, resume tetap me-replay event tersimpan (tanpa snapshot)", async () => {
    const { actor, store, cfg } = setup();
    await joinAndAttach(actor, "A");
    const seq = actor.snapshot().lastSeq;
    await actor.join("B");
    actor.dispose();
    const saved = await store.loadRoom("room-1");
    const recovered = new RoomActor(saved!.state, { store, config: cfg, onExpiring: vi.fn() }, saved!.events);
    const conn = new FakeConn();
    recovered.resume(conn, seq);
    expect(conn.types()).toEqual(["participant.joined"]);
  });

  it("revisi basi (penulis lain) → SERVICE_UNAVAILABLE, actor memuat ulang dan klien dapat snapshot", async () => {
    const { actor, store, cfg } = setup();
    const a = await joinAndAttach(actor, "A");
    // Penulis kedua (mis. instance lain / commit ambigu) memajukan revisi di store.
    const other = await store.loadRoom("room-1");
    const intruder = new RoomActor(other!.state, { store, config: cfg, onExpiring: vi.fn() }, other!.events);
    await intruder.join("B");
    intruder.dispose();

    await expect(actor.join("C")).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(a.conn.types()).toContain("room.snapshot");
    expect(Object.keys(actor.snapshot().participants)).toHaveLength(2);
    // Setelah resync, tulisan berikutnya berhasil.
    await actor.join("C");
    expect(Object.keys(actor.snapshot().participants)).toHaveLength(3);
  });

  it("rotasi token: token lama diterima sebentar, lalu ditolak", async () => {
    const { actor } = setup();
    const a = await actor.join("A");
    const r = await actor.refreshSession(a.token);
    expect(actor.authenticate(r.token)).toBe(a.participant.participantId);
    expect(actor.authenticate(a.token)).toBe(a.participant.participantId);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(actor.authenticate(a.token)).toBeNull();
    expect(actor.authenticate(r.token)).toBe(a.participant.participantId);
  });

  it("kredensial yang tidak diperbarui melewati TTL ditolak", async () => {
    const { actor } = setup({ credentialTtlSeconds: 10 });
    const a = await joinAndAttach(actor, "A");
    await vi.advanceTimersByTimeAsync(11_000);
    expect(actor.authenticate(a.token)).toBeNull();
  });
});
