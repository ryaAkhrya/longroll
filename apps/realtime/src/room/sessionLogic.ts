import { randomInt } from "node:crypto";
import { MODES, SESSION_CONFIG, canCloseVoting, everyoneVoted, newVoting, publicStudio, resolveVotes, votingOpen } from "@longroll/shared";
import type { Mode, RoomEvent, SessionView } from "@longroll/shared";
import { uuidv7 } from "../security";
import { RoomError } from "./types";
import type { RoomState } from "./types";

/**
 * Voting & sesi (08, P04) sebagai fungsi atas DRAFT state di dalam commit actor (serial, disimpan
 * sebelum ack). Tidak ada host: setiap aksi boleh dilakukan peserta terhubung mana pun.
 * TIDAK ADA timer penutup voting otomatis (DEC-046); satu-satunya timer adalah jendela "Tutup vote".
 */

export type Emit = (e: RoomEvent) => void;

/** Hook P05: inisialisasi studio saat mode terkunci (diinjeksi actor agar modul ini tidak bergantung). */
export type StudioInit = (draft: RoomState, session: SessionView) => void;

export function activeSession(state: RoomState): SessionView | null {
  return state.activeSessionId ? (state.sessions[state.activeSessionId] ?? null) : null;
}

/** Peserta yang ditunggu penutupan otomatis: CONNECTED (punya socket atau status tersimpan). */
export function connectedIds(state: RoomState, hasSocket: (pid: string) => boolean): string[] {
  return Object.values(state.participants)
    .filter((p) => p.connection === "CONNECTED" || (p.connection !== "LEFT" && hasSocket(p.participantId)))
    .map((p) => p.participantId);
}

export function emitSession(draft: RoomState, emit: Emit, session: SessionView) {
  emit({ type: "session.state", payload: { session: { ...structuredClone(session), studio: publicStudio(session.studio) }, sessionCount: draft.sessionOrder.length } });
}

/** `session.create` (DEC-063): hanya jika belum ada sesi atau sesi aktif sudah FINAL/CLOSED; batas 20 (DEC-053). */
export function createSession(draft: RoomState, emit: Emit, by: string, nowMs: number): SessionView {
  const current = activeSession(draft);
  if (current && current.state !== "FINAL" && current.state !== "CLOSED") throw new RoomError("SESSION_ACTIVE_NOT_FINAL");
  if (draft.sessionOrder.length >= SESSION_CONFIG.maxSessionsPerRoom) throw new RoomError("SESSION_LIMIT");
  if (current) {
    current.state = "CLOSED";
    current.eventLog.push({ atMs: nowMs, type: "CLOSED" });
    emitSession(draft, emit, current);
  }
  const session: SessionView = {
    sessionId: uuidv7(nowMs),
    index: draft.sessionOrder.length + 1,
    state: "VOTING",
    createdAtMs: nowMs,
    createdBy: by,
    mode: null,
    lockedAtMs: null,
    voting: newVoting(),
    studio: null,
    eventLog: [{ atMs: nowMs, type: "CREATED", by }],
  };
  draft.sessions[session.sessionId] = session;
  draft.sessionOrder.push(session.sessionId);
  draft.activeSessionId = session.sessionId;
  emitSession(draft, emit, session);
  emit({ type: "session.invite", payload: { sessionId: session.sessionId, index: session.index, from: by } });
  return session;
}

function requireVoting(draft: RoomState, sessionId: unknown, round: unknown): SessionView {
  const s = activeSession(draft);
  if (!s || s.sessionId !== sessionId) throw new RoomError("VOTING_CLOSED");
  if (s.state !== "VOTING" || !votingOpen(s.voting)) throw new RoomError(s.mode ? "MODE_LOCKED" : "VOTING_CLOSED");
  if (round !== undefined && round !== s.voting.round) throw new RoomError("VOTING_CLOSED");
  return s;
}

/** `vote.cast`: satu suara aktif per peserta; mengirim lagi = mengganti (08 §4). */
export function castVote(draft: RoomState, emit: Emit, by: string, payload: unknown, connected: string[], nowMs: number, init: StudioInit) {
  const p = (payload ?? {}) as { sessionId?: unknown; round?: unknown; mode?: unknown };
  const s = requireVoting(draft, p.sessionId, p.round);
  if (!MODES.includes(p.mode as Mode) || !s.voting.options.includes(p.mode as Mode)) throw new RoomError("INVALID_OPTION");
  if (s.voting.votes[by] === p.mode) return; // idempoten
  s.voting.votes[by] = p.mode as Mode;
  maybeAutoResolve(draft, emit, s, connected, nowMs, init) || emitSession(draft, emit, s);
}

/** `vote.close`: hanya setelah > 50% peserta CONNECTED memilih; jendela 5 s, idempoten (DEC-023). */
export function closeVote(draft: RoomState, emit: Emit, by: string, payload: unknown, connected: string[], nowMs: number) {
  const p = (payload ?? {}) as { sessionId?: unknown; round?: unknown };
  const s = requireVoting(draft, p.sessionId, p.round);
  if (s.voting.phase === "CLOSING") return;
  if (!canCloseVoting(s.voting, connected)) throw new RoomError("CLOSE_NOT_ALLOWED");
  s.voting.phase = "CLOSING";
  s.voting.closingAtMs = nowMs + SESSION_CONFIG.voteCloseWindowMs;
  s.voting.closedBy = by;
  s.eventLog.push({ atMs: nowMs, type: "CLOSING", by, detail: { round: s.voting.round } });
  emitSession(draft, emit, s);
}

/** Semua CONNECTED sudah memilih → langsung resolve. true bila terjadi resolusi. */
export function maybeAutoResolve(draft: RoomState, emit: Emit, s: SessionView, connected: string[], nowMs: number, init: StudioInit): boolean {
  if (s.state !== "VOTING" || !votingOpen(s.voting)) return false;
  if (!everyoneVoted(s.voting, connected)) return false;
  return resolve(draft, emit, s, nowMs, init);
}

/** Jendela CLOSING habis (timer actor / pemulihan setelah restart). */
export function closingExpired(draft: RoomState, emit: Emit, nowMs: number, init: StudioInit): boolean {
  const s = activeSession(draft);
  if (!s || s.state !== "VOTING" || s.voting.phase !== "CLOSING" || (s.voting.closingAtMs ?? 0) > nowMs) return false;
  if (!resolve(draft, emit, s, nowMs, init)) {
    // Semua suara hilang (peserta keluar) selama jendela: kembali menerima suara di ronde yang sama.
    s.voting.phase = s.voting.round === 2 ? "TIE_ROUND" : "OPEN";
    s.voting.closingAtMs = null;
    s.voting.closedBy = null;
    emitSession(draft, emit, s);
  }
  return true;
}

/** resolve (08 §6) → LOCKED / TIE_ROUND / RANDOM_PICK→LOCKED. Acak memakai CSPRNG server (DEC-024). */
export function resolve(draft: RoomState, emit: Emit, s: SessionView, nowMs: number, init: StudioInit): boolean {
  const notLeft = (pid: string) => draft.participants[pid] !== undefined && draft.participants[pid]!.connection !== "LEFT";
  const r = resolveVotes(s.voting.votes, notLeft, s.voting.options);
  if (r.kind === "none") return false;
  if (r.kind === "winner") {
    lock(draft, emit, s, { mode: r.mode, method: r.method, tally: r.tally }, nowMs, init);
    return true;
  }
  if (s.voting.round === 1) {
    s.voting = { phase: "TIE_ROUND", round: 2, options: r.options, votes: {}, closingAtMs: null, closedBy: null, tieTally: r.tally, result: null };
    s.eventLog.push({ atMs: nowMs, type: "TIE", detail: { options: r.options, tally: r.tally } });
    emitSession(draft, emit, s);
    emit({ type: "vote.tie", payload: { sessionId: s.sessionId, round: 2, options: r.options } });
    return true;
  }
  const mode = r.options[randomInt(r.options.length)]!;
  s.eventLog.push({ atMs: nowMs, type: "RANDOM_PICK", detail: { options: r.options, mode, tally: r.tally } });
  lock(draft, emit, s, { mode, method: "RANDOM", tally: r.tally, options: r.options }, nowMs, init);
  return true;
}

function lock(draft: RoomState, emit: Emit, s: SessionView, result: NonNullable<SessionView["voting"]["result"]>, nowMs: number, init: StudioInit) {
  s.voting.phase = "LOCKED";
  s.voting.closingAtMs = null;
  s.voting.result = result;
  // REQ-VOTE-06: mode ditulis SEKALI. Langsung STUDIO; klien menampilkan hasil ≤ 3 s (DEC-081).
  s.mode = result.mode;
  s.lockedAtMs = nowMs;
  s.state = "STUDIO";
  s.eventLog.push({ atMs: nowMs, type: "LOCKED", detail: { mode: result.mode, method: result.method } });
  init(draft, s);
  emitSession(draft, emit, s);
  emit({
    type: "vote.resolved",
    payload: { sessionId: s.sessionId, mode: result.mode, method: result.method, tally: result.tally as Record<string, number>, options: result.options },
  });
}

/** Peserta LEFT: suaranya dihapus & tally dihitung ulang (08 §7). Peserta putus: tidak ditunggu lagi. */
export function onPresenceChanged(draft: RoomState, emit: Emit, leftId: string | null, connected: string[], nowMs: number, init: StudioInit) {
  const s = activeSession(draft);
  if (!s || s.state !== "VOTING" || !votingOpen(s.voting)) return;
  let changed = false;
  if (leftId && s.voting.votes[leftId] !== undefined) {
    delete s.voting.votes[leftId];
    changed = true;
  }
  if (maybeAutoResolve(draft, emit, s, connected, nowMs, init)) return;
  if (changed) emitSession(draft, emit, s);
}
