import type { AckPayload, CameraState, ConnectionState, ErrorCode, PlayerColor, RoomStatus, S2C } from "@longroll/shared";

/** Participant di server (14 §3). Field token SERVER ONLY, tidak pernah masuk view. */
export interface ServerParticipant {
  participantId: string;
  displayName: string;
  color: PlayerColor;
  joinedAtMs: number;
  connection: ConnectionState;
  disconnectedAtMs: number | null;
  camera: CameraState;
  ready: boolean;
  tokenHash: string | null;
  tokenIssuedAtMs: number | null;
  /** Token sebelum rotasi terakhir, masih diterima sampai prevTokenValidUntilMs. */
  prevTokenHash: string | null;
  prevTokenValidUntilMs: number | null;
}

/** Room (14 §2) — bentuk snapshot yang disimpan di PostgreSQL. */
export interface RoomState {
  roomId: string;
  code: string;
  status: RoomStatus;
  createdAtMs: number;
  emptySinceMs: number | null;
  expiresAtMs: number | null;
  participants: Record<string, ServerParticipant>;
  activeSessionId: string | null;
  sessionOrder: string[];
  roomVersion: number;
  lastSeq: number;
  /** SERVER ONLY: bertambah tiap simpan; optimistic concurrency di store (bukan roomVersion klien). */
  revision: number;
}

export class RoomError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly reason?: "HOLD" | "NAME_EMPTY" | "NAME_TOO_LONG" | "NAME_CHARS",
  ) {
    super(code);
    this.name = "RoomError";
  }
}

/** Koneksi WebSocket yang dipegang actor (diabstraksikan agar bisa diuji tanpa socket nyata). */
export interface RoomConnection {
  readonly id: string;
  send(message: S2C): void;
  close(code: number, reason: string): void;
}

export type IntentResult = AckPayload;
