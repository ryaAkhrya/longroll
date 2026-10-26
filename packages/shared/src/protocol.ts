import type { PlayerColor } from "./players";

/**
 * Kontrak room & presence P02 (14 §2–§5, §8, §13). Bentuk view yang dikirim ke klien
 * TIDAK memuat field server-only (tokenHash, dsb).
 */
export const PROTOCOL_VERSION = 1;

export type RoomStatus = "ACTIVE" | "GRACE" | "EXPIRING" | "EXPIRED";
export type ConnectionState = "CONNECTED" | "RECONNECTING" | "LEFT";
export type CameraState = "live" | "off" | "permission" | "none" | "in_use";
export type CursorSurface = "vote" | "studio" | "editor" | "lobby";

export interface ParticipantView {
  participantId: string;
  displayName: string;
  color: PlayerColor;
  joinedAtMs: number;
  connection: ConnectionState;
  disconnectedAtMs: number | null;
  camera: CameraState;
  ready: boolean;
}

export interface RoomConfigView {
  graceSeconds: number;
  holdSeconds: number;
  maxParticipants: number;
}

export interface RoomView {
  roomId: string;
  code: string;
  status: RoomStatus;
  createdAtMs: number;
  emptySinceMs: number | null;
  /** null = tanpa batas umur (DEC-052 default). */
  expiresAtMs: number | null;
  /** Termasuk LEFT (referensi foto di fase berikutnya); UI menyaring sendiri. */
  participants: ParticipantView[];
  roomVersion: number;
  lastSeq: number;
  config: RoomConfigView;
}

export type ErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_INVALID"
  | "ORIGIN_FORBIDDEN"
  | "ROOM_NOT_FOUND"
  | "ROOM_EXPIRED"
  | "ROOM_FULL"
  | "NAME_INVALID"
  | "RATE_LIMITED"
  | "BAD_REQUEST"
  | "UNKNOWN_EVENT"
  | "NOT_CONNECTED"
  | "SERVICE_UNAVAILABLE";

// ---------- HTTP ----------

export interface SessionResponse {
  roomId: string;
  roomCode: string;
  participantId: string;
  color: PlayerColor;
  wsUrl: string;
  /** Umur cookie kredensial; klien menyegarkan sebelum habis. */
  credentialTtlSec: number;
}

export interface PreviewResponse {
  exists: true;
  status: Extract<RoomStatus, "ACTIVE" | "GRACE">;
  participantCount: number;
  capacity: number;
  /** Hanya inisial (15 §4), bukan nama lengkap. */
  initials: string[];
  colors: PlayerColor[];
  /** Jumlah slot yang ditahan untuk peserta yang sedang nyambung lagi. */
  holding: number;
}

export interface ErrorResponse {
  error: ErrorCode;
  /** Info tambahan non-pribadi, mis. alasan ROOM_FULL atau grace (menit) untuk SCR-21. */
  reason?: "HOLD" | "NAME_EMPTY" | "NAME_TOO_LONG" | "NAME_CHARS";
  graceSeconds?: number;
  retryAfterSec?: number;
}

// ---------- WebSocket ----------

export interface C2S<T = unknown> {
  type: string;
  clientEventId?: string;
  payload: T;
}

export interface S2C<T = unknown> {
  type: string;
  seq?: number;
  roomVersion?: number;
  atMs: number;
  payload: T;
  replyTo?: string;
}

/** Event S→C non-volatile (punya seq, disimpan di ring buffer). */
export type RoomEvent =
  | { type: "participant.joined"; payload: { participant: ParticipantView } }
  | { type: "participant.left"; payload: { participantId: string } }
  | {
      type: "presence.update";
      payload: { participantId: string; connection?: ConnectionState; disconnectedAtMs?: number | null; ready?: boolean };
    }
  | { type: "room.status"; payload: { status: RoomStatus; emptySinceMs: number | null } }
  | { type: "room.expiring"; payload: { reason: "GRACE" | "MAX_LIFETIME"; atMs: number } };

export interface AuthOkPayload {
  participantId: string;
  serverTimeMs: number;
  /** Ada bila server mengirim snapshot penuh; tidak ada bila server me-replay event sejak lastSeq. */
  room?: RoomView;
  resumedFromSeq?: number;
}

export interface AckPayload {
  ok: boolean;
  error?: ErrorCode;
}

export interface CursorPayload {
  surface: CursorSurface;
  x: number;
  y: number;
  label?: string;
}

/** Kode close WebSocket aplikasi. */
export const WS_CLOSE = {
  LEFT: 4000,
  EXPIRED: 4001,
  AUTH_INVALID: 4401,
  REPLACED: 4409,
  RATE_LIMITED: 4429,
  UPGRADE_REQUIRED: 4426,
  HEARTBEAT_TIMEOUT: 4408,
} as const;

export function cookieNameFor(roomId: string): string {
  return `lr_p_${roomId}`;
}
