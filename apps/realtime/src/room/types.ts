import type { AckPayload, CameraPresentation, CameraState, ConnectionState, ErrorCode, FrameContentType, FrameTemplate, PlayerColor, RoomStatus, S2C, SessionView } from "@longroll/shared";

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
  mirrored: boolean;
  cameraPresentation: CameraPresentation;
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
  /** Semua sesi room (14 §6); disimpan di tabel lr_sessions. */
  sessions: Record<string, SessionView>;
  roomVersion: number;
  lastSeq: number;
  /** SERVER ONLY: bertambah tiap simpan; optimistic concurrency di store (bukan roomVersion klien). */
  revision: number;
  /** Frame custom room (P05, DEC-054) — juga indeks aset untuk cleanup (14 §11). Tabel lr_frames. */
  frames: Record<string, ServerFrame>;
}

/** Frame custom: PENDING (presign diterbitkan, belum divalidasi) → READY (re-encode & lolos validasi). */
export interface ServerFrame {
  frameId: string;
  uploadedBy: string;
  status: "PENDING" | "READY";
  fileName: string;
  contentType: FrameContentType;
  declaredBytes: number;
  rawKey: string;
  objectKey: string | null;
  bytes: number | null;
  template: FrameTemplate | null;
  createdAtMs: number;
  /** Batas upload PENDING; null setelah READY. */
  expiresAtMs: number | null;
}

export class RoomError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly reason?: string,
    /** Data tambahan non-rahasia untuk ack (mis. pelanggaran safeguard + alternatif). */
    readonly detail?: unknown,
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
