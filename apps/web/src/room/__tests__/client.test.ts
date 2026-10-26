import { describe, expect, it, vi } from "vitest";
import type { RoomView } from "@longroll/shared";
import { applyEvent, backoffDelay } from "../client";
import { createCursorSender, CursorStore } from "../cursors";

const room: RoomView = {
  roomId: "r",
  code: "GENG27",
  status: "ACTIVE",
  createdAtMs: 0,
  emptySinceMs: null,
  expiresAtMs: null,
  roomVersion: 1,
  lastSeq: 1,
  config: { graceSeconds: 120, holdSeconds: 60, maxParticipants: 4 },
  participants: [
    { participantId: "a", displayName: "A", color: "P1", joinedAtMs: 0, connection: "CONNECTED", disconnectedAtMs: null, camera: "none", ready: false },
  ],
};

describe("applyEvent", () => {
  it("participant.joined menambah peserta dan memperbarui seq", () => {
    const next = applyEvent(room, {
      type: "participant.joined",
      seq: 2,
      roomVersion: 2,
      payload: { participant: { ...room.participants[0]!, participantId: "b", displayName: "B", color: "P2" } },
    });
    expect(next.participants.map((p) => p.participantId)).toEqual(["a", "b"]);
    expect(next.lastSeq).toBe(2);
    expect(room.participants).toHaveLength(1);
  });

  it("presence.update & participant.left & room.status", () => {
    let next = applyEvent(room, { type: "presence.update", seq: 2, payload: { participantId: "a", connection: "RECONNECTING", disconnectedAtMs: 5 } });
    expect(next.participants[0]).toMatchObject({ connection: "RECONNECTING", disconnectedAtMs: 5 });
    next = applyEvent(next, { type: "room.status", seq: 3, payload: { status: "GRACE", emptySinceMs: 5 } });
    expect(next.status).toBe("GRACE");
    next = applyEvent(next, { type: "participant.left", seq: 4, payload: { participantId: "a" } });
    expect(next.participants[0]!.connection).toBe("LEFT");
  });
});

describe("backoffDelay", () => {
  it("0.5 s → 8 s maks, dengan jitter ±30%", () => {
    expect(backoffDelay(1, () => 0.5)).toBe(500);
    expect(backoffDelay(2, () => 0.5)).toBe(1000);
    expect(backoffDelay(10, () => 0.5)).toBe(8000);
    expect(backoffDelay(10, () => 1)).toBe(8000);
    expect(backoffDelay(1, () => 0)).toBe(350);
  });
});

describe("kursor", () => {
  it("sender throttle 20 Hz dan abaikan gerak < 2 px", () => {
    vi.useFakeTimers();
    const sent: number[][] = [];
    const s = createCursorSender((x, y) => sent.push([x, y]));
    s.move(0.1, 0.1, 10, 10);
    s.move(0.11, 0.1, 11, 10); // < 2 px
    s.move(0.2, 0.2, 20, 20); // tertunda (dalam 50 ms)
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(60);
    expect(sent).toEqual([
      [0.1, 0.1],
      [0.2, 0.2],
    ]);
    s.dispose();
    vi.useRealTimers();
  });

  it("store menyembunyikan kursor yang diam > 5 s", () => {
    const store = new CursorStore();
    store.upsert({ participantId: "a", surface: "lobby", x: 0, y: 0, atMs: 0 });
    store.prune(4_000);
    expect(store.getSnapshot()).toHaveLength(1);
    store.prune(6_000);
    expect(store.getSnapshot()).toHaveLength(0);
  });
});
