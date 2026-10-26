import type { PlayerColor } from "./players";
import type { SessionView } from "./session";
import type { CustomFrameView, StudioChange, StudioState } from "./studio/types";

/**
 * Kontrak room & presence P02 (14 §2–§5, §8, §13). Bentuk view yang dikirim ke klien
 * TIDAK memuat field server-only (tokenHash, dsb).
 */
export const PROTOCOL_VERSION = 1;

export type RoomStatus = "ACTIVE" | "GRACE" | "EXPIRING" | "EXPIRED";
export type ConnectionState = "CONNECTED" | "RECONNECTING" | "LEFT";
export type CameraState = "live" | "off" | "permission" | "none" | "in_use";
export type CursorSurface = "vote" | "studio" | "editor" | "lobby";

/** Framing pra-capture milik pemilik kamera (09 §4, DEC-049). Hanya pemilik yang boleh menulis. */
export interface CameraPresentation {
  /** 1..2 */
  zoom: number;
  /** -1..1 relatif terhadap ruang geser yang tersedia setelah zoom */
  offset: { x: number; y: number };
  /** -1..1 */
  brightness: number;
  /** -1..1 */
  warmth: number;
}

export const DEFAULT_CAMERA_PRESENTATION: CameraPresentation = { zoom: 1, offset: { x: 0, y: 0 }, brightness: 0, warmth: 0 };

/** Validasi + clamp; null bila bentuknya salah (NaN/Infinity ditolak, 14 §8.2). */
export function sanitizeCameraPresentation(input: unknown): CameraPresentation | null {
  if (!input || typeof input !== "object") return null;
  const p = input as Record<string, unknown>;
  const off = (p.offset ?? {}) as Record<string, unknown>;
  const nums = [p.zoom, off.x, off.y, p.brightness, p.warmth].map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const clamp = (n: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, n)) * 100) / 100;
  const [zoom, x, y, brightness, warmth] = nums as [number, number, number, number, number];
  return { zoom: clamp(zoom, 1, 2), offset: { x: clamp(x, -1, 1), y: clamp(y, -1, 1) }, brightness: clamp(brightness, -1, 1), warmth: clamp(warmth, -1, 1) };
}

export const CAMERA_STATES: readonly CameraState[] = ["live", "off", "permission", "none", "in_use"];

export interface ParticipantView {
  participantId: string;
  displayName: string;
  color: PlayerColor;
  joinedAtMs: number;
  connection: ConnectionState;
  disconnectedAtMs: number | null;
  camera: CameraState;
  ready: boolean;
  /** Orientasi tampilan feed (09 §3): peer menampilkan feed sesuai flag ini. */
  mirrored: boolean;
  cameraPresentation: CameraPresentation;
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
  /** Sesi aktif (P04) — null sebelum ada yang memulai voting. */
  activeSession: SessionView | null;
  sessionCount: number;
  /** Frame custom milik room (READY), P05. URL bertanda tangan diminta terpisah. */
  customFrames: CustomFrameView[];
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
  | "NOT_IN_STUDIO"
  | "FORBIDDEN_NOT_OWNER"
  | "VOTING_CLOSED"
  | "INVALID_OPTION"
  | "CLOSE_NOT_ALLOWED"
  | "MODE_LOCKED"
  | "SESSION_LIMIT"
  | "SESSION_ACTIVE_NOT_FINAL"
  | "STRUCTURE_LOCKED"
  | "INVALID_PATCH"
  | "FRAME_UNSUPPORTED"
  | "FRAME_TOO_LARGE"
  | "FRAME_DIMENSIONS"
  | "FRAME_DECODE_FAILED"
  | "FRAME_QUOTA"
  | "FRAME_NOT_FOUND"
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
  reason?: "HOLD" | "NAME_EMPTY" | "NAME_TOO_LONG" | "NAME_CHARS" | (string & {});
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
      payload: {
        participantId: string;
        connection?: ConnectionState;
        disconnectedAtMs?: number | null;
        ready?: boolean;
        camera?: CameraState;
        mirrored?: boolean;
        cameraPresentation?: CameraPresentation;
      };
    }
  | { type: "room.status"; payload: { status: RoomStatus; emptySinceMs: number | null } }
  /** Sesi berubah (state, voting, mode, studio): selalu membawa SessionView lengkap → semua klien identik. */
  | { type: "session.state"; payload: { session: SessionView; sessionCount: number } }
  | { type: "session.invite"; payload: { sessionId: string; index: number; from: string } }
  | { type: "vote.tie"; payload: { sessionId: string; round: 2; options: string[] } }
  /** Studio bersama berubah (P05): StudioState lengkap + ringkasan perubahan (siapa, field, Balikin). */
  | { type: "studio.updated"; payload: { sessionId: string; studio: StudioState; change: StudioChange | null } }
  /** Frame custom selesai divalidasi & siap dipakai (10 §9). */
  | { type: "frame.added"; payload: { frame: CustomFrameView; by: string } }
  | { type: "vote.resolved"; payload: { sessionId: string; mode: string; method: string; tally: Record<string, number>; options?: string[] } }
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
  /** Alasan rinci (mis. INVALID_PATCH → SAFEGUARD/BINDING/GEOMETRY/STALE_UNDO). */
  reason?: string;
  /** Data tambahan non-rahasia (mis. pelanggaran safeguard + alternatif). */
  detail?: unknown;
}

export interface CursorPayload {
  surface: CursorSurface;
  x: number;
  y: number;
  label?: string;
}

// ---------- WebRTC signaling (14 §5.3, P03) ----------

export type RtcSignalType = "rtc.offer" | "rtc.answer" | "rtc.ice" | "rtc.restart";
export const RTC_SIGNAL_TYPES: readonly RtcSignalType[] = ["rtc.offer", "rtc.answer", "rtc.ice", "rtc.restart"];

/**
 * Payload sinyal. `from` selalu diisi SERVER dari identitas terautentikasi (klien tidak bisa memalsukan).
 * `pc` = id koneksi peer milik pengirim (membedakan PC baru setelah reload dari PC lama).
 * Volatile: tidak disimpan, tidak di-replay, tidak dicatat di log.
 */
export interface RtcSignal {
  to: string;
  from?: string;
  pc: string;
  /** pcId PENERIMA yang sedang direspons (jawaban/kandidat untuk PC lama dibuang). */
  rpc?: string;
  sdp?: { type: "offer" | "answer"; sdp: string };
  candidate?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null; usernameFragment?: string | null } | null;
}

export interface IceServersResponse {
  iceServers: { urls: string[]; username?: string; credential?: string }[];
  ttlSec: number;
  /** true bila TURN dikonfigurasi (DEC-073). STUN saja = false. */
  turn: boolean;
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

// ---------- Frame custom (P05, 14 §4, 10 §9) ----------

/** `POST /api/rooms/{code}/frames` → URL upload presigned (maks. 10 MB, PNG/WebP). */
export interface FramePrepareRequest {
  fileName: string;
  contentType: string;
  bytes: number;
}

export interface FramePrepareResponse {
  frameId: string;
  uploadUrl: string;
  /** Header yang WAJIB dikirim bersama PUT (Content-Type yang ditandatangani). */
  uploadHeaders: Record<string, string>;
  expiresInSec: number;
}

/** `POST /api/rooms/{code}/frames/{frameId}/complete` → frame tervalidasi & di-re-encode. */
export interface FrameCompleteResponse {
  frame: CustomFrameView;
  /** Jumlah lubang transparan terdeteksi ("4 lubang ketemu"). */
  holes: number;
}

/** `GET /api/rooms/{code}/frames/{frameId}/url` → signed URL berumur pendek (≤ 10 menit). */
export interface FrameUrlResponse {
  url: string;
  expiresAtMs: number;
}
