import type { ParticipantView, RoomView } from "@longroll/shared";
import { LIMITS } from "@longroll/shared";
import type { RoomState, ServerParticipant } from "./types";

export function participantView(p: ServerParticipant): ParticipantView {
  return {
    participantId: p.participantId,
    displayName: p.displayName,
    color: p.color,
    joinedAtMs: p.joinedAtMs,
    connection: p.connection,
    disconnectedAtMs: p.disconnectedAtMs,
    camera: p.camera,
    ready: p.ready,
  };
}

/** View untuk klien: tanpa tokenHash dan field server-only lainnya. */
export function roomView(state: RoomState, config: { graceSeconds: number; holdSeconds: number }): RoomView {
  return {
    roomId: state.roomId,
    code: state.code,
    status: state.status,
    createdAtMs: state.createdAtMs,
    emptySinceMs: state.emptySinceMs,
    expiresAtMs: state.expiresAtMs,
    participants: Object.values(state.participants)
      .sort((a, b) => a.joinedAtMs - b.joinedAtMs)
      .map(participantView),
    roomVersion: state.roomVersion,
    lastSeq: state.lastSeq,
    config: { graceSeconds: config.graceSeconds, holdSeconds: config.holdSeconds, maxParticipants: LIMITS.maxParticipants },
  };
}

/** Inisial saja untuk preview tanpa token (15 §4). */
export function initialOf(name: string): string {
  return (Array.from(name.trim())[0] ?? "?").toLocaleUpperCase("id");
}
