import type { PlayerColor } from "../players";
import type { CameraPresentation } from "../protocol";
import type { ParticipantSlot } from "../studio/types";

/**
 * Capture tersinkron & retake individual (P06, 09 §7–§12, 14 §7). Tipe + fungsi murni yang dipakai
 * server (otoritatif) dan klien (tampilan). INVARIANT: `acceptedAttemptId` hanya ditulis lewat satu
 * fungsi server `setAccepted` (09 §9.4); modul ini tidak punya penulis field itu.
 */

export type ShotState = "IDLE" | "COUNTDOWN" | "REVIEW" | "DONE";
export type ParticipantShotStatus =
  | "PENDING"
  | "CAPTURING"
  | "UPLOADING"
  | "DECIDING"
  | "RETAKE_COUNTDOWN"
  | "ACCEPTED"
  | "SKIPPED"
  | "NOT_REQUIRED"
  | "MISSING"
  | "FAILED";
export type AttemptStatus = "CREATED" | "UPLOADING" | "READY" | "REJECTED" | "FAILED";
export type AttemptKind = "shot" | "retake" | "makeup";
export type AttemptPartName = "preview" | "full";
/** Varian turunan server untuk editor (<= 1600 px) selain preview 640 px & full <= 4096 px. */
export type AttemptViewPart = AttemptPartName | "edit";

export interface AttemptPart {
  bytes: number;
  width: number;
  height: number;
  sha256: string;
}

export interface Attempt {
  attemptId: string;
  shotIndex: number;
  ownerId: string;
  ownerNameAtCapture: string;
  ownerColor: PlayerColor;
  /** Nomor percobaan peserta di shot ini (1, 2, …) — "✕ Take n · diulang". */
  attemptNo: number;
  kind: AttemptKind;
  status: AttemptStatus;
  createdAtMs: number;
  capturedAtServerMs: number | null;
  /** Tertinggal > 1000 ms dari T0 (diagnostik saja, bukan penolakan). */
  late: boolean;
  mirrored: boolean;
  preview: AttemptPart | null;
  full: AttemptPart | null;
  /** Varian <= 1600 px untuk editor (dibuat server saat full diverifikasi). */
  edit?: AttemptPart | null;
  /** Objek storage sudah dihapus (attempt tidak terpakai setelah shot DONE, DEC-029). */
  purged: boolean;
  /** SERVER ONLY (dihapus dari view): key object storage. */
  previewKey?: string;
  fullKey?: string;
  editKey?: string;
}

export interface ShotParticipantState {
  status: ParticipantShotStatus;
  attempts: string[];
  currentAttemptId: string | null;
  /** INVARIANT: hanya diubah oleh pemiliknya lewat `setAccepted` (09 §9.4). */
  acceptedAttemptId: string | null;
  retakeT0ServerMs: number | null;
  statusAtMs: number;
}

export interface Shot {
  index: number;
  state: ShotState;
  t0ServerMs: number | null;
  armedBy: string | null;
  armedAtMs: number | null;
  countdownSec: number;
  /** Peserta wajib (DEC-028): dihitung saat T0. */
  required: string[];
  /** participantId → slot P1..P4 saat shot diambil (resolusi binding, DEC-087). */
  slotOf: Record<string, ParticipantSlot>;
  perParticipant: Record<string, ShotParticipantState>;
  doneAtMs: number | null;
  /** Pembatal terakhir (Tunggu!) — untuk pesan "{nama} nahan dulu". */
  heldBy: string | null;
}

export interface CaptureState {
  /** Peserta sesi ini (snapshot saat shot pertama di-arm, DEC-030): join terlambat ikut sesi berikutnya. */
  eligible: Record<string, ParticipantSlot>;
  shotCount: number;
  shots: Shot[];
  attempts: Record<string, Attempt>;
  /** Byte terverifikasi milik attempt (batas storage room, DEC-085). */
  bytesUsed: number;
}

/** Default PROPOSED (DEC-026..029, 069, 072, 079, 080, 085) sebagai konfigurasi terpusat. */
export const CAPTURE_CONFIG = {
  countdownChoices: [3, 5, 10] as const,
  defaultCountdownSec: 5,
  /** DEC-028: "Lanjut tanpa dia" setelah 15 detik putus. */
  skipAfterMs: 15_000,
  /** DEC-080: Colek maks. 1× per 20 detik per pengirim. */
  nudgeIntervalMs: 20_000,
  maxFullBytes: 8 * 1024 * 1024,
  maxPreviewBytes: 400 * 1024,
  previewMaxPx: 640,
  /** DEC-072: sisi terpanjang foto ≤ 4096 px, JPEG 0.92. */
  fullMaxPx: 4096,
  /** Varian editor (P07): sisi terpanjang <= 1600 px, JPEG 0.85. */
  editMaxPx: 1600,
  fullQuality: 0.92,
  previewQuality: 0.8,
  retryQuality: 0.85,
  uploadRetries: 3,
  uploadBackoffMs: [1_000, 2_000, 4_000] as const,
  lateThresholdMs: 1_000,
  /** DEC-085 (technical safeguard): 1 GB per room. */
  roomStorageLimitBytes: 1024 * 1024 * 1024,
  uploadUrlTtlSec: 600,
  viewUrlTtlSec: 600,
  /** Toleransi `attempt.prepare` sebelum T0 menurut jam server (offset klien tidak sempurna). */
  prepareEarlyMs: 500,
  /** Proteksi storage: retake tetap tanpa batas produk, tapi attempt per peserta per shot dibatasi wajar. */
  maxAttemptsPerParticipantShot: 60,
  /** Banner "Shot n beres!" ditampilkan klien selama ini. */
  shotDoneBannerMs: 3_000,
} as const;

export function isCountdownChoice(n: unknown): n is 3 | 5 | 10 {
  return (CAPTURE_CONFIG.countdownChoices as readonly unknown[]).includes(n);
}

export const SETTLED: readonly ParticipantShotStatus[] = ["ACCEPTED", "SKIPPED"];

/** Shot aktif (terakhir yang belum DONE), atau null bila semua selesai. */
export function activeShot(c: CaptureState | null | undefined): Shot | null {
  if (!c) return null;
  const last = c.shots[c.shots.length - 1];
  return last && last.state !== "DONE" ? last : null;
}

/** DEC-028: semua peserta wajib ACCEPTED / SKIPPED. */
export function shotSettled(shot: Shot): boolean {
  return shot.required.every((pid) => SETTLED.includes(shot.perParticipant[pid]?.status ?? "PENDING"));
}

/** Foto accepted untuk cell (shotIndex, participantSlot) — null bila belum DONE / tidak ada. */
export function acceptedForCell(c: CaptureState | null | undefined, shotIndex: number, slot: ParticipantSlot): string | null {
  const shot = c?.shots[shotIndex];
  if (!shot || shot.state !== "DONE") return null;
  for (const [pid, s] of Object.entries(shot.slotOf)) if (s === slot) return shot.perParticipant[pid]?.acceptedAttemptId ?? null;
  return null;
}

/** View publik attempt: tanpa key storage. */
export function publicAttempt(a: Attempt): Attempt {
  const { previewKey, fullKey, editKey, ...rest } = a;
  void previewKey;
  void fullKey;
  void editKey;
  return rest;
}

export function publicCapture(c: CaptureState | null | undefined): CaptureState | null {
  if (!c) return null;
  return { ...c, attempts: Object.fromEntries(Object.entries(c.attempts).map(([k, a]) => [k, publicAttempt(a)])) };
}

// ---------------------------------------------------------------- jam (DEC-074, 09 §7.1)

export interface ClockSample {
  rttMs: number;
  offsetMs: number;
}

/** Sampel ping-pong: offset = ts − (t1 + rtt/2). */
export function clockSample(t1: number, serverTs: number, t2: number): ClockSample {
  const rttMs = Math.max(0, t2 - t1);
  return { rttMs, offsetMs: serverTs - (t1 + rttMs / 2) };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Median offset; sampel dengan rtt > 2× median rtt dibuang. null bila tidak ada sampel. */
export function computeClockOffset(samples: ClockSample[]): number | null {
  if (!samples.length) return null;
  const mr = median(samples.map((s) => s.rttMs));
  const kept = samples.filter((s) => s.rttMs <= Math.max(2 * mr, 1));
  return Math.round(median((kept.length ? kept : samples).map((s) => s.offsetMs)));
}

// ---------------------------------------------------------------- crop framing (09 §4.1, DEC-064)

export interface CaptureCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Ukuran output (piksel), sisi terpanjang ≤ maxPx, tanpa upscale. */
  outW: number;
  outH: number;
  /** Cermin horizontal saat menggambar (WYSIWYG, DEC-064). */
  flip: boolean;
}

/**
 * Wilayah frame kamera yang terlihat di pratinjau (transform `presentationTransform`: zoom + geser,
 * relatif terhadap frame) → crop sumber. Cermin: wilayah dihitung pada gambar tercermin lalu digambar
 * terbalik, persis seperti yang dilihat pemilik. Skala seragam (tidak ada distorsi).
 */
export function captureCrop(srcW: number, srcH: number, cp: CameraPresentation, mirrored: boolean, maxPx: number = CAPTURE_CONFIG.fullMaxPx): CaptureCrop {
  const z = Math.max(1, Math.min(2, cp.zoom || 1));
  const sw = srcW / z;
  const sh = srcH / z;
  const k = (z - 1) / (2 * z);
  const cxView = 0.5 + cp.offset.x * k;
  const cx = mirrored ? 1 - cxView : cxView;
  const cy = 0.5 + cp.offset.y * k;
  const clamp = (v: number, size: number, total: number) => Math.max(0, Math.min(total - size, v));
  const sx = clamp(cx * srcW - sw / 2, sw, srcW);
  const sy = clamp(cy * srcH - sh / 2, sh, srcH);
  const scale = Math.min(1, maxPx / Math.max(sw, sh));
  return { sx, sy, sw, sh, outW: Math.max(1, Math.round(sw * scale)), outH: Math.max(1, Math.round(sh * scale)), flip: mirrored };
}

/** Kunci object storage attempt (14 §11, 15 §8). */
export function attemptKey(roomId: string, attemptId: string, part: AttemptViewPart): string {
  return `rooms/${roomId}/attempts/${attemptId}/${part}.jpg`;
}
