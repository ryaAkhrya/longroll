import { DEFAULT_CAMERA_PRESENTATION, ROOM_DEFAULTS } from "@longroll/shared";
import type { RoomView } from "@longroll/shared";

/**
 * Data contoh STATIS untuk pratinjau visual dev (`?preview=lobby|expired`) tanpa realtime service.
 * Bukan data room sungguhan. Kode memakai alfabet DEC-022 (tanpa O/0/I/1).
 */
const t = Date.UTC(2026, 9, 25, 12, 0, 0);

export const SAMPLE_ROOM: RoomView = {
  roomId: "00000000-0000-7000-8000-000000000000",
  code: "BUBA27",
  status: "ACTIVE",
  createdAtMs: t,
  emptySinceMs: null,
  expiresAtMs: null,
  roomVersion: 3,
  lastSeq: 3,
  config: { graceSeconds: ROOM_DEFAULTS.graceSeconds, holdSeconds: ROOM_DEFAULTS.holdSeconds, maxParticipants: 4 },
  activeSession: null,
  sessionCount: 0,
  customFrames: [],
  participants: [
    { participantId: "p1", displayName: "Nadia", color: "P1", joinedAtMs: t, connection: "CONNECTED", disconnectedAtMs: null, camera: "none", ready: false, mirrored: false, cameraPresentation: DEFAULT_CAMERA_PRESENTATION },
    { participantId: "p2", displayName: "Raka", color: "P2", joinedAtMs: t + 1, connection: "CONNECTED", disconnectedAtMs: null, camera: "none", ready: true, mirrored: false, cameraPresentation: DEFAULT_CAMERA_PRESENTATION },
    { participantId: "p3", displayName: "Sasa", color: "P3", joinedAtMs: t + 2, connection: "RECONNECTING", disconnectedAtMs: t, camera: "none", ready: false, mirrored: false, cameraPresentation: DEFAULT_CAMERA_PRESENTATION },
  ],
};

export const SAMPLE_ME = "p1";

export type RoomPreview = "lobby" | "expired";

export function parsePreview(value: string | string[] | undefined): RoomPreview | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "lobby" || v === "expired" ? v : null;
}
