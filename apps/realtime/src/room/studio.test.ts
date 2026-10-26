import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateLayout } from "@longroll/shared";
import type { S2C, SessionView, StudioChange, StudioState } from "@longroll/shared";
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

class Conn implements RoomConnection {
  static n = 0;
  readonly id = `s${Conn.n++}`;
  messages: S2C[] = [];
  send(m: S2C) {
    this.messages.push(m);
  }
  close() {}
}

async function studioRoom(n: number, mode = "PHOTO_STRIP") {
  const store = new MemoryRoomStore();
  const actor = new RoomActor(RoomActor.createState("room-s", "STUD22", CONFIG), { store, config: CONFIG, onExpiring: vi.fn() });
  const people: { id: string; conn: Conn }[] = [];
  for (let i = 0; i < n; i++) {
    const r = await actor.join(`P${i + 1}`);
    const conn = new Conn();
    await actor.attach(conn, r.participant.participantId, null);
    people.push({ id: r.participant.participantId, conn });
  }
  await actor.intent(people[0]!.id, "session.create", {});
  const sid = actor.view().activeSession!.sessionId;
  for (const p of people) await actor.intent(p.id, "vote.cast", { sessionId: sid, round: 1, mode });
  return { store, actor, people, sid };
}

const studio = (a: RoomActor) => (a.view().activeSession as SessionView).studio as StudioState;
const update = (a: RoomActor, pid: string, sid: string, patch: unknown, baseVersion?: number) => a.intent(pid, "studio.update", { sessionId: sid, patch, baseVersion });
const lastUpdated = (c: Conn) =>
  [...c.messages].reverse().find((m) => m.type === "studio.updated")?.payload as { studio: StudioState; change: StudioChange | null } | undefined;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("P05 studio bersama di actor", () => {
  it("mode terkunci → StudioState awal valid (default sementara DEC-061) tanpa nilai undo ke klien", async () => {
    const { actor } = await studioRoom(4);
    const s = studio(actor);
    expect(s).toMatchObject({ version: 1, bindingStrategy: "PER_SHOT_GROUP", structureLocked: false, participantSlots: ["P1", "P2", "P3", "P4"] });
    expect(s.layout.slots).toHaveLength(4);
    expect(validateLayout(s.layout, s.bindingStrategy, s.participantSlots)).toBeNull();
    expect(s.undo).toBeNull();
  });

  it("AC-P05-1: Pasang buat semua → studio.updated identik di semua klien + identitas pengubah", async () => {
    const { actor, people, sid } = await studioRoom(4);
    const frame = { frameId: "builtin/film-400@1", source: "BUILTIN", adapt: "CONTAIN", overlayOpacity: 1 };
    expect(await update(actor, people[2]!.id, sid, { frame }, 1)).toEqual({ ok: true });
    const views = people.map((p) => JSON.stringify(lastUpdated(p.conn)));
    expect(new Set(views).size).toBe(1);
    expect(lastUpdated(people[0]!.conn)!.change).toMatchObject({ by: people[2]!.id, kind: "frame", fields: ["frame"] });
    expect(studio(actor).frame!.frameId).toBe("builtin/film-400@1");
    expect(JSON.stringify(lastUpdated(people[0]!.conn))).not.toContain('"prev"');
  });

  it("validasi server: patch rusak/asing → INVALID_PATCH; ubah mode → MODE_LOCKED; safeguard → alasan + alternatif", async () => {
    const { actor, people, sid } = await studioRoom(2);
    expect(await update(actor, people[0]!.id, sid, { shotCount: Number.NaN })).toMatchObject({ ok: false, error: "INVALID_PATCH" });
    expect(await update(actor, people[0]!.id, sid, { mode: "PHOTO_GRID" })).toEqual({ ok: false, error: "MODE_LOCKED" });
    const r = await update(actor, people[0]!.id, sid, { shotCount: 9 });
    expect(r).toMatchObject({ ok: false, error: "INVALID_PATCH", reason: "SAFEGUARD", detail: { violation: { code: "MAX_SHOTS", limit: 8 } } });
    expect(studio(actor).layout.shotCount).toBe(4);
    expect(await update(actor, people[0]!.id, sid, { frame: { frameId: "room/x/nope", source: "CUSTOM", adapt: "CONTAIN", overlayOpacity: 1 } })).toMatchObject({
      ok: false,
      error: "FRAME_NOT_FOUND",
    });
  });

  it("NOT_IN_STUDIO saat voting / sessionId salah", async () => {
    const store = new MemoryRoomStore();
    const actor = new RoomActor(RoomActor.createState("room-x", "STUD33", CONFIG), { store, config: CONFIG, onExpiring: vi.fn() });
    const a = await actor.join("A");
    await actor.attach(new Conn(), a.participant.participantId, null);
    await actor.intent(a.participant.participantId, "session.create", {});
    const sid = actor.view().activeSession!.sessionId;
    expect(await update(actor, a.participant.participantId, sid, { shotCount: 2 })).toMatchObject({ error: "NOT_IN_STUDIO" });
  });

  it("perubahan bersamaan: field berbeda digabung, field sama LWW tercatat; Balikin satu langkah", async () => {
    const { actor, people, sid } = await studioRoom(3);
    await Promise.all([
      update(actor, people[0]!.id, sid, { style: { filterPreset: "MONO" } }, 1),
      update(actor, people[1]!.id, sid, { shotCount: 3 }, 1),
      update(actor, people[2]!.id, sid, { style: { filterPreset: "HANGAT" } }, 1),
    ]);
    const s = studio(actor);
    expect(s.layout.shotCount).toBe(3);
    expect(s.style.filterPreset).toBe("HANGAT");
    expect(s.lastChange).toMatchObject({ by: people[2]!.id, overwrote: ["style.filterPreset"] });
    expect(await actor.intent(people[1]!.id, "studio.revert", { sessionId: sid, changeId: "lama" })).toMatchObject({ ok: false, reason: "STALE_UNDO" });
    expect(await actor.intent(people[0]!.id, "studio.revert", { sessionId: sid, changeId: s.lastChange!.changeId })).toEqual({ ok: true });
    expect(studio(actor).style.filterPreset).toBe("MONO");
    expect(studio(actor).lastChange).toMatchObject({ kind: "revert", by: people[0]!.id });
  });

  it("peserta join / keluar saat STUDIO sebelum shot 1 → BindingPlan dibangkitkan ulang & tersiar", async () => {
    const { actor, people, sid } = await studioRoom(3, "PHOTO_GRID");
    expect(studio(actor).layout.slots).toHaveLength(3);
    const d = await actor.join("D");
    await actor.attach(new Conn(), d.participant.participantId, null);
    expect(studio(actor).participantSlots).toEqual(["P1", "P2", "P3", "P4"]);
    expect(studio(actor).layout.slots).toHaveLength(4);
    expect(lastUpdated(people[0]!.conn)!.studio.layout.slots).toHaveLength(4);
    await actor.leave(people[1]!.id);
    expect(studio(actor).participantSlots).toEqual(["P1", "P3", "P4"]);
    expect(validateLayout(studio(actor).layout, studio(actor).bindingStrategy, ["P1", "P3", "P4"])).toBeNull();
    void sid;
  });

  it("AC-P05-3 / TC-FRAME-007: struktur (shot, strategi) bisa diubah sebelum shot 1, ditolak STRUCTURE_LOCKED sesudahnya", async () => {
    const { actor, people, sid } = await studioRoom(2);
    expect(await update(actor, people[1]!.id, sid, { bindingStrategy: "PER_PARTICIPANT_SHOT", shotCount: 2 })).toEqual({ ok: true });
    expect(studio(actor).layout.slots).toHaveLength(4);
    await actor.lockStudioStructure(sid);
    expect(studio(actor).structureLocked).toBe(true);
    expect(await update(actor, people[0]!.id, sid, { shotCount: 3 })).toEqual({ ok: false, error: "STRUCTURE_LOCKED" });
    expect(await update(actor, people[0]!.id, sid, { bindingStrategy: "PER_SHOT_GROUP" })).toEqual({ ok: false, error: "STRUCTURE_LOCKED" });
    expect(await update(actor, people[0]!.id, sid, { style: { filterPreset: "FILM" } })).toEqual({ ok: true });
  });

  it("AC-P05-8 / TC-SEC-012: tidak bisa menulis cameraPresentation orang lain", async () => {
    const { actor, people } = await studioRoom(2);
    expect(await actor.intent(people[0]!.id, "presence.set", { participantId: people[1]!.id, cameraPresentation: { zoom: 2, offset: { x: 0, y: 0 }, brightness: 0, warmth: 0 } })).toEqual({
      ok: false,
      error: "FORBIDDEN_NOT_OWNER",
    });
  });

  it("restart: studio (termasuk Balikin) dipulihkan dari store", async () => {
    const { actor, people, sid, store } = await studioRoom(2);
    await update(actor, people[0]!.id, sid, { style: { filterPreset: "SEJUK" } });
    const changeId = studio(actor).lastChange!.changeId;
    actor.dispose();
    const saved = (await store.loadRoom("room-s"))!;
    const actor2 = new RoomActor(saved.state, { store, config: CONFIG, onExpiring: vi.fn() }, saved.events);
    await actor2.recover();
    for (const p of people) await actor2.attach(new Conn(), p.id, null);
    expect(studio(actor2).style.filterPreset).toBe("SEJUK");
    expect(await actor2.intent(people[1]!.id, "studio.revert", { sessionId: sid, changeId })).toEqual({ ok: true });
    expect(studio(actor2).style.filterPreset).toBe("ASLI");
  });
});
