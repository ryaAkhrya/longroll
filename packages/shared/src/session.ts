import { LIMITS } from "./config";
import type { CaptureState } from "./capture";
import type { PlayerColor } from "./players";
import type { StudioState } from "./studio/types";

/** 4 mode (08 §2, REQ-VOTE-02). */
export type Mode = "PHOTO_STRIP" | "GROUP_SHOT" | "PHOTO_GRID" | "FREEFORM_COLLAGE";
export const MODES: readonly Mode[] = ["PHOTO_STRIP", "GROUP_SHOT", "PHOTO_GRID", "FREEFORM_COLLAGE"];

export const MODE_INFO: Record<Mode, { name: string; short: string; description: string }> = {
  PHOTO_STRIP: { name: "Photo Strip", short: "Strip", description: "Strip vertikal, 3–4 shot." },
  GROUP_SHOT: { name: "Group Shot", short: "Group", description: "Empat kamera jadi satu foto." },
  PHOTO_GRID: { name: "Photo Grid", short: "Grid", description: "Mosaik 2×2 sampai 3×3." },
  FREEFORM_COLLAGE: { name: "Freeform Collage", short: "Collage", description: "Tempel bebas, miring, numpuk." },
};

export type SessionState = "VOTING" | "STUDIO" | "CAPTURING" | "EDITING" | "FINAL" | "CLOSED";
export type VotingPhase = "OPEN" | "CLOSING" | "RESOLVING" | "TIE_ROUND" | "RANDOM_PICK" | "LOCKED";
export type VoteMethod = "UNANIMOUS" | "MAJORITY" | "RANDOM";

export interface VoteResult {
  mode: Mode;
  method: VoteMethod;
  /** Tally ronde penentu. */
  tally: Partial<Record<Mode, number>>;
  /** Opsi yang diundi bila RANDOM. */
  options?: Mode[];
}

export interface VotingView {
  phase: VotingPhase;
  round: 1 | 2;
  options: Mode[];
  /** Suara terbuka (08 §4): participantId → mode. */
  votes: Record<string, Mode>;
  /** Jendela "Tutup vote" 5 s (DEC-023). Tidak ada timer penutup otomatis (DEC-046). */
  closingAtMs: number | null;
  closedBy: string | null;
  /** Tally ronde 1 yang berakhir seri (untuk ditampilkan di ronde 2). */
  tieTally: Partial<Record<Mode, number>> | null;
  result: VoteResult | null;
}

export interface SessionLogEntry {
  atMs: number;
  type: "CREATED" | "CLOSING" | "TIE" | "RANDOM_PICK" | "LOCKED" | "CAPTURING" | "EDITING" | "FINAL" | "REOPENED" | "CLOSED";
  by?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Sesi (14 §6). `studio` diisi P05 saat mode terkunci (StudioState, `studio/types.ts`).
 */
export interface SessionView<TStudio = StudioState> {
  sessionId: string;
  index: number;
  state: SessionState;
  createdAtMs: number;
  createdBy: string;
  mode: Mode | null;
  lockedAtMs: number | null;
  voting: VotingView;
  studio: TStudio | null;
  /** P06: shot, attempt, keputusan per peserta (null sebelum shot pertama di-arm). */
  capture: CaptureState | null;
  /** P08: ada setelah Selesai edit (FINAL) dan tetap ada setelah CLOSED (galeri). */
  result: SessionResult | null;
  eventLog: SessionLogEntry[];
}

/**
 * Hasil sesi (12 2): dibuat/diperbarui saat `session.finalize` (DEC-059). Key storage hanya di server
 * (`docSnapshotKey`, `previewKey`); klien memperoleh gambar lewat `gallery.get` / `asset.urls` (signed URL).
 */
export interface SessionResult {
  sessionId: string;
  index: number;
  mode: Mode;
  title: string;
  finalizedAtMs: number;
  finalizedBy: string;
  /** Tanggal yang tampil di dekor frame (sama dengan editor: lockedAtMs ?? createdAtMs). */
  dateMs: number;
  frameRef: string | null;
  outputPreset: string;
  acceptedAttempts: { shotIndex: number; participantId: string; attemptId: string; participantNameAtCapture: string; color: PlayerColor }[];
  participants: { participantId: string; name: string; color: PlayerColor }[];
  /** Versi finalisasi (naik tiap Balik edit + Selesai lagi) — membedakan pratinjau lama/baru. */
  version: number;
  /** SERVER ONLY. */
  docSnapshotKey?: string;
  previewKey?: string | null;
  /** Pratinjau WebP hasil render klien sudah diunggah & diverifikasi. */
  previewReady: boolean;
}

export function publicResult(r: SessionResult | null | undefined): SessionResult | null {
  if (!r) return null;
  const { docSnapshotKey, previewKey, ...rest } = r;
  void docSnapshotKey;
  void previewKey;
  return rest;
}

/** Default PROPOSED terpusat (DEC-023/025/053/081). */
export const SESSION_CONFIG = {
  voteCloseWindowMs: 5_000,
  studioAutoEnterMs: 3_000,
  minParticipantsToStart: 1,
  maxSessionsPerRoom: LIMITS.maxSessionsPerRoom,
} as const;

export function newVoting(): VotingView {
  return { phase: "OPEN", round: 1, options: [...MODES], votes: {}, closingAtMs: null, closedBy: null, tieTally: null, result: null };
}

/** Fase di mana suara diterima. */
export function votingOpen(v: VotingView): boolean {
  return v.phase === "OPEN" || v.phase === "CLOSING" || v.phase === "TIE_ROUND";
}

export function tallyVotes(votes: Record<string, Mode>, counts: (participantId: string) => boolean): Partial<Record<Mode, number>> {
  const tally: Partial<Record<Mode, number>> = {};
  for (const [pid, mode] of Object.entries(votes)) if (counts(pid)) tally[mode] = (tally[mode] ?? 0) + 1;
  return tally;
}

export type Resolution =
  | { kind: "none" }
  | { kind: "winner"; mode: Mode; method: Exclude<VoteMethod, "RANDOM">; tally: Partial<Record<Mode, number>> }
  | { kind: "tie"; options: Mode[]; tally: Partial<Record<Mode, number>> };

/**
 * resolve (08 §6): hanya suara peserta non-LEFT. Tanpa suara → none. Satu pemenang → winner
 * (UNANIMOUS bila semua suara sama). Seri → tie (pemanggil memutuskan ronde ulang vs acak).
 */
export function resolveVotes(votes: Record<string, Mode>, counts: (participantId: string) => boolean, options: readonly Mode[]): Resolution {
  const tally = tallyVotes(votes, counts);
  const entries = (Object.entries(tally) as [Mode, number][]).filter(([m]) => options.includes(m));
  if (entries.length === 0) return { kind: "none" };
  const max = Math.max(...entries.map(([, n]) => n));
  const winners = entries.filter(([, n]) => n === max).map(([m]) => m);
  if (winners.length === 1) return { kind: "winner", mode: winners[0]!, method: entries.length === 1 ? "UNANIMOUS" : "MAJORITY", tally };
  // Urutan opsi seri mengikuti urutan mode kanonik (deterministik di semua klien).
  return { kind: "tie", options: MODES.filter((m) => winners.includes(m)), tally };
}

/** "Tutup vote" tersedia saat suara > 50% peserta CONNECTED (DEC-023). */
export function canCloseVoting(v: VotingView, connectedIds: readonly string[]): boolean {
  if (v.phase !== "OPEN" && v.phase !== "TIE_ROUND") return false;
  if (connectedIds.length === 0) return false;
  const voted = connectedIds.filter((id) => v.votes[id] !== undefined).length;
  return voted * 2 > connectedIds.length;
}

/** Semua peserta CONNECTED sudah memilih (≥ 1 peserta terhubung). */
export function everyoneVoted(v: VotingView, connectedIds: readonly string[]): boolean {
  return connectedIds.length > 0 && connectedIds.every((id) => v.votes[id] !== undefined);
}
