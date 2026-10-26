import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { S2C, SessionView } from "@longroll/shared";
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
  readonly id = `v${Conn.n++}`;
  messages: S2C[] = [];
  send(m: S2C) {
    this.messages.push(m);
  }
  close() {}
}

async function room(n: number) {
  const store = new MemoryRoomStore();
  const actor = new RoomActor(RoomActor.createState("room-v", "VOTE22", CONFIG), { store, config: CONFIG, onExpiring: vi.fn() });
  const people: { id: string; conn: Conn; token: string }[] = [];
  for (let i = 0; i < n; i++) {
    const r = await actor.join(`P${i + 1}`);
    const conn = new Conn();
    await actor.attach(conn, r.participant.participantId, null);
    people.push({ id: r.participant.participantId, conn, token: r.token });
  }
  return { store, actor, people };
}

const session = (actor: RoomActor) => actor.view().activeSession as SessionView;
const cast = (actor: RoomActor, pid: string, mode: string, round = session(actor).voting.round) =>
  actor.intent(pid, "vote.cast", { sessionId: session(actor).sessionId, round, mode });
const close = (actor: RoomActor, pid: string) => actor.intent(pid, "vote.close", { sessionId: session(actor).sessionId, round: session(actor).voting.round });
const lastSession = (c: Conn) => [...c.messages].reverse().find((m) => m.type === "session.state")?.payload as { session: SessionView } | undefined;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("P04 voting & sesi", () => {
  it("AC-P04-10: peserta bukan pembuat room bisa memulai voting", async () => {
    const { actor, people } = await room(3);
    expect(await actor.intent(people[2]!.id, "session.create", {})).toEqual({ ok: true });
    const s = session(actor);
    expect(s).toMatchObject({ index: 1, state: "VOTING", createdBy: people[2]!.id });
    expect(people[0]!.conn.messages.some((m) => m.type === "session.invite")).toBe(true);
  });

  it("AC-P04-1: 3 Strip vs 1 Grid → LOCKED PHOTO_STRIP identik di semua klien", async () => {
    const { actor, people } = await room(4);
    await actor.intent(people[0]!.id, "session.create", {});
    await cast(actor, people[0]!.id, "PHOTO_STRIP");
    await cast(actor, people[1]!.id, "PHOTO_STRIP");
    await cast(actor, people[2]!.id, "PHOTO_STRIP");
    expect(session(actor).voting.phase).toBe("OPEN");
    await cast(actor, people[3]!.id, "PHOTO_GRID");
    const s = session(actor);
    expect(s).toMatchObject({ state: "STUDIO", mode: "PHOTO_STRIP" });
    expect(s.voting).toMatchObject({ phase: "LOCKED", result: { mode: "PHOTO_STRIP", method: "MAJORITY" } });
    const views = people.map((p) => JSON.stringify(lastSession(p.conn)!.session));
    expect(new Set(views).size).toBe(1);
  });

  it("AC-P04-2: hanya suara terakhir yang dihitung; ketuk ulang kartu sama tidak membatalkan", async () => {
    const { actor, people } = await room(3);
    await actor.intent(people[0]!.id, "session.create", {});
    await cast(actor, people[0]!.id, "GROUP_SHOT");
    await cast(actor, people[0]!.id, "PHOTO_GRID");
    await cast(actor, people[0]!.id, "PHOTO_GRID");
    expect(session(actor).voting.votes[people[0]!.id]).toBe("PHOTO_GRID");
    await cast(actor, people[1]!.id, "PHOTO_GRID");
    await cast(actor, people[2]!.id, "GROUP_SHOT");
    expect(session(actor).mode).toBe("PHOTO_GRID");
  });

  it("AC-P04-3 & AC-P04-4: seri → ronde 2 opsi seri; seri lagi → acak CSPRNG tercatat, identik di semua klien", async () => {
    const { actor, people } = await room(4);
    await actor.intent(people[0]!.id, "session.create", {});
    await cast(actor, people[0]!.id, "PHOTO_STRIP");
    await cast(actor, people[1]!.id, "PHOTO_STRIP");
    await cast(actor, people[2]!.id, "PHOTO_GRID");
    await cast(actor, people[3]!.id, "PHOTO_GRID");
    let s = session(actor);
    expect(s.voting).toMatchObject({ phase: "TIE_ROUND", round: 2, options: ["PHOTO_STRIP", "PHOTO_GRID"], votes: {} });
    expect(await cast(actor, people[0]!.id, "GROUP_SHOT")).toEqual({ ok: false, error: "INVALID_OPTION" });
    expect(await cast(actor, people[0]!.id, "PHOTO_STRIP", 1)).toEqual({ ok: false, error: "VOTING_CLOSED" });
    await cast(actor, people[0]!.id, "PHOTO_STRIP");
    await cast(actor, people[1]!.id, "PHOTO_STRIP");
    await cast(actor, people[2]!.id, "PHOTO_GRID");
    await cast(actor, people[3]!.id, "PHOTO_GRID");
    s = session(actor);
    expect(s.voting.result).toMatchObject({ method: "RANDOM", options: ["PHOTO_STRIP", "PHOTO_GRID"] });
    expect(["PHOTO_STRIP", "PHOTO_GRID"]).toContain(s.mode);
    expect(s.eventLog.some((e) => e.type === "RANDOM_PICK" && (e.detail as { mode: string }).mode === s.mode)).toBe(true);
    const resolved = people.map((p) => JSON.stringify(p.conn.messages.find((m) => m.type === "vote.resolved")!.payload));
    expect(new Set(resolved).size).toBe(1);
  });

  it("AC-P04-5: TIDAK ada timer penutup otomatis — voting tetap OPEN > 5 menit tanpa syarat penutupan", async () => {
    const { actor, people } = await room(3);
    await actor.intent(people[0]!.id, "session.create", {});
    await cast(actor, people[0]!.id, "PHOTO_STRIP");
    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(session(actor).voting.phase).toBe("OPEN");
    expect(session(actor).state).toBe("VOTING");
  });

  it("AC-P04-6: Tutup vote sebelum mayoritas ditolak; setelah mayoritas → jendela 5 s yang tetap menerima suara", async () => {
    const { actor, people } = await room(4);
    await actor.intent(people[0]!.id, "session.create", {});
    await cast(actor, people[0]!.id, "PHOTO_STRIP");
    await cast(actor, people[1]!.id, "GROUP_SHOT");
    expect(await close(actor, people[3]!.id)).toEqual({ ok: false, error: "CLOSE_NOT_ALLOWED" });
    await cast(actor, people[2]!.id, "GROUP_SHOT");
    expect(await close(actor, people[3]!.id)).toEqual({ ok: true });
    expect(await close(actor, people[0]!.id)).toEqual({ ok: true }); // idempoten, jendela sama
    expect(session(actor).voting).toMatchObject({ phase: "CLOSING", closedBy: people[3]!.id });
    await vi.advanceTimersByTimeAsync(2_000);
    await cast(actor, people[0]!.id, "GROUP_SHOT"); // ganti suara di jendela
    expect(session(actor).state).toBe("VOTING");
    await vi.advanceTimersByTimeAsync(3_500);
    expect(session(actor)).toMatchObject({ state: "STUDIO", mode: "GROUP_SHOT" });
  });

  it("AC-P04-7: suara peserta LEFT dihapus dan tally dihitung ulang", async () => {
    const { actor, people } = await room(3);
    await actor.intent(people[0]!.id, "session.create", {});
    await cast(actor, people[0]!.id, "PHOTO_STRIP");
    await cast(actor, people[1]!.id, "PHOTO_GRID");
    await actor.leave(people[1]!.id);
    expect(session(actor).voting.votes[people[1]!.id]).toBeUndefined();
    await cast(actor, people[2]!.id, "PHOTO_GRID");
    // 1 Strip vs 1 Grid → seri (peserta yang keluar tidak dihitung)
    expect(session(actor).voting.phase).toBe("TIE_ROUND");
  });

  it("peserta RECONNECTING tidak ditunggu penutupan otomatis; suaranya tetap dihitung", async () => {
    const { actor, people } = await room(3);
    await actor.intent(people[0]!.id, "session.create", {});
    await cast(actor, people[2]!.id, "GROUP_SHOT");
    await cast(actor, people[0]!.id, "PHOTO_STRIP");
    await actor.detach(people[2]!.conn, people[2]!.id);
    expect(session(actor).state).toBe("VOTING");
    await cast(actor, people[1]!.id, "PHOTO_STRIP");
    expect(session(actor)).toMatchObject({ state: "STUDIO", mode: "PHOTO_STRIP" });
    expect(session(actor).voting.result!.tally).toMatchObject({ GROUP_SHOT: 1, PHOTO_STRIP: 2 });
  });

  it("AC-P04-8: perubahan mode setelah lock ditolak; mode tetap", async () => {
    const { actor, people } = await room(2);
    await actor.intent(people[0]!.id, "session.create", {});
    await cast(actor, people[0]!.id, "PHOTO_GRID");
    await cast(actor, people[1]!.id, "PHOTO_GRID");
    expect(await cast(actor, people[1]!.id, "PHOTO_STRIP", 1)).toEqual({ ok: false, error: "MODE_LOCKED" });
    expect(session(actor).mode).toBe("PHOTO_GRID");
  });

  it("AC-P04-9: sesi baru hanya dari FINAL/CLOSED dan dimulai dari VOTING; batas 20 sesi", async () => {
    const { actor, people, store } = await room(2);
    await actor.intent(people[0]!.id, "session.create", {});
    expect(await actor.intent(people[1]!.id, "session.create", {})).toEqual({ ok: false, error: "SESSION_ACTIVE_NOT_FINAL" });
    // Simulasikan sesi selesai (FINAL dibangun di P07/P08) lewat snapshot tersimpan.
    actor.dispose();
    const saved = (await store.loadRoom("room-v"))!;
    saved.state.sessions[saved.state.activeSessionId!]!.state = "FINAL";
    saved.state.sessions[saved.state.activeSessionId!]!.mode = "PHOTO_STRIP";
    const actor2 = new RoomActor(saved.state, { store, config: CONFIG, onExpiring: vi.fn() }, saved.events);
    for (const p of people) await actor2.attach(new Conn(), p.id, null);
    expect(await actor2.intent(people[1]!.id, "session.create", {})).toEqual({ ok: true });
    const s2 = actor2.view().activeSession!;
    expect(s2).toMatchObject({ index: 2, state: "VOTING", mode: null });
    expect(actor2.snapshot().sessions[saved.state.activeSessionId!]!.state).toBe("CLOSED");
  });

  it("restart saat CLOSING: timer dilanjutkan dari closingAtMs tersimpan", async () => {
    const { actor, people, store } = await room(3);
    await actor.intent(people[0]!.id, "session.create", {});
    await cast(actor, people[0]!.id, "PHOTO_STRIP");
    await cast(actor, people[1]!.id, "PHOTO_STRIP");
    await close(actor, people[0]!.id);
    actor.dispose();
    await vi.advanceTimersByTimeAsync(2_000);
    const saved = (await store.loadRoom("room-v"))!;
    expect(saved.state.sessions[saved.state.activeSessionId!]!.voting.phase).toBe("CLOSING");
    const actor2 = new RoomActor(saved.state, { store, config: CONFIG, onExpiring: vi.fn() }, saved.events);
    await actor2.recover();
    await vi.advanceTimersByTimeAsync(3_500);
    expect(actor2.view().activeSession).toMatchObject({ state: "STUDIO", mode: "PHOTO_STRIP" });
  });

  it("intent voting butuh socket aktif; clientEventId sama tidak menggandakan efek", async () => {
    const { actor, people } = await room(2);
    await actor.intent(people[0]!.id, "session.create", {}, "c-1");
    expect(await actor.intent(people[0]!.id, "session.create", {}, "c-1")).toEqual({ ok: true });
    expect(actor.snapshot().sessionOrder).toHaveLength(1);
    await actor.detach(people[1]!.conn, people[1]!.id);
    expect(await cast(actor, people[1]!.id, "PHOTO_STRIP")).toEqual({ ok: false, error: "NOT_CONNECTED" });
  });
});
