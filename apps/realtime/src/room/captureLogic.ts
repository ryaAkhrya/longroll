import {
  CAPTURE_CONFIG,
  PARTICIPANT_SLOTS,
  attemptKey,
  isCountdownChoice,
  lockStudioStructure,
  publicCapture,
  publicStudio,
  shotSettled,
} from "@longroll/shared";
import type { Attempt, AttemptPartName, CaptureState, ParticipantSlot, SessionView, Shot, ShotParticipantState } from "@longroll/shared";
import { uuidv7 } from "../security";
import { activeSession, publicSession } from "./sessionLogic";
import type { Emit } from "./sessionLogic";
import { RoomError } from "./types";
import type { RoomState } from "./types";

/**
 * Capture tersinkron & retake individual (P06, 09 §7–§12). Semua fungsi bekerja pada DRAFT state di
 * dalam commit actor (serial, disimpan sebelum ack).
 *
 * INVARIANT (09 §9.4, REQ-CAP-07/10): `acceptedAttemptId` HANYA ditulis oleh `setAccepted` di file ini,
 * dan hanya dipanggil dari aksi PEMILIKNYA (`capture.accept` / `capture.retake` / `capture.reopen` tidak
 * menyentuh peserta lain). Tidak ada timer, cleanup, atau reconnect yang menulisnya. Tidak ada auto-accept.
 */

const SLOTS = new Set<string>(PARTICIPANT_SLOTS);
const toInt = (v: unknown) => (Number.isInteger(v) ? (v as number) : null);

function newPs(status: ShotParticipantState["status"], now: number): ShotParticipantState {
  return { status, attempts: [], currentAttemptId: null, acceptedAttemptId: null, retakeT0ServerMs: null, statusAtMs: now };
}

function setStatus(ps: ShotParticipantState, status: ShotParticipantState["status"], now: number) {
  ps.status = status;
  ps.statusAtMs = now;
}

/** Sesi yang boleh menjalankan capture: STUDIO (sebelum shot 1) atau CAPTURING. */
function captureSession(draft: RoomState, sessionId: unknown): SessionView {
  const s = activeSession(draft);
  if (!s || s.sessionId !== sessionId || (s.state !== "STUDIO" && s.state !== "CAPTURING") || !s.studio || !s.mode) throw new RoomError("NOT_IN_STUDIO");
  return s;
}

function lastShot(c: CaptureState | null): Shot | null {
  return c && c.shots.length ? c.shots[c.shots.length - 1]! : null;
}

export function emitCapture(draft: RoomState, emit: Emit, s: SessionView) {
  void draft;
  emit({ type: "capture.state", payload: { sessionId: s.sessionId, capture: publicCapture(s.capture)! } });
}

export function emitSessionState(draft: RoomState, emit: Emit, s: SessionView) {
  emit({ type: "session.state", payload: { session: publicSession(s), sessionCount: draft.sessionOrder.length } });
}

// ---------------------------------------------------------------- satu-satunya penulis acceptedAttemptId

/**
 * 09 §9.4. SATU-SATUNYA fungsi yang menulis `acceptedAttemptId`. `actorId` WAJIB pemilik; attempt
 * (bila ada) wajib milik peserta itu dan shot belum DONE. `null` = melepas pilihan (hanya oleh
 * pemilik saat ia mengulang foto yang tadinya ia pakai).
 */
export function setAccepted(c: CaptureState, shot: Shot, participantId: string, attemptId: string | null, actorId: string) {
  if (actorId !== participantId) throw new RoomError("FORBIDDEN_NOT_OWNER");
  if (shot.state === "DONE") throw new RoomError("SHOT_DONE");
  const ps = shot.perParticipant[participantId];
  if (!ps) throw new RoomError("NOT_REQUIRED");
  if (attemptId !== null) {
    const a = c.attempts[attemptId];
    if (!a || a.ownerId !== participantId || a.shotIndex !== shot.index) throw new RoomError("FORBIDDEN_NOT_OWNER");
  }
  ps.acceptedAttemptId = attemptId;
}

// ---------------------------------------------------------------- arm / hold / T0

export function initCapture(draft: RoomState, s: SessionView): CaptureState {
  const eligible: Record<string, ParticipantSlot> = {};
  for (const p of Object.values(draft.participants)) if (p.connection !== "LEFT" && SLOTS.has(p.color)) eligible[p.participantId] = p.color as ParticipantSlot;
  const c: CaptureState = { eligible, shotCount: s.studio!.layout.shotCount, shots: [], attempts: {}, bytesUsed: 0 };
  s.capture = c;
  return c;
}

/** DEC-028: wajib = terhubung dengan socket DAN kamera live, dan peserta sesi ini (DEC-030). */
function requiredFor(draft: RoomState, c: CaptureState, hasSocket: (pid: string) => boolean): string[] {
  return Object.values(draft.participants)
    .filter((p) => p.connection === "CONNECTED" && hasSocket(p.participantId) && p.camera === "live" && c.eligible[p.participantId] !== undefined)
    .map((p) => p.participantId);
}

export function armShot(draft: RoomState, emit: Emit, by: string, payload: unknown, now: number, hasSocket: (pid: string) => boolean) {
  const p = (payload ?? {}) as { sessionId?: unknown; shotIndex?: unknown; confirmNotReady?: unknown };
  const s = captureSession(draft, p.sessionId);
  const first = !s.capture;
  const c = s.capture ?? initCapture(draft, s);
  const idx = toInt(p.shotIndex);
  if (idx === null || idx < 0) throw new RoomError("BAD_REQUEST");
  const done = c.shots.filter((x) => x.state === "DONE").length;
  const cur = lastShot(c);
  if (cur && (cur.state === "COUNTDOWN" || cur.state === "REVIEW")) throw new RoomError("ALREADY_ARMED");
  if (idx < done || idx >= c.shotCount) throw new RoomError("SHOT_DONE");
  if (idx !== done) throw new RoomError("BAD_REQUEST");

  const required = requiredFor(draft, c, hasSocket);
  if (!required.length) throw new RoomError("NOT_REQUIRED");
  const notReady = required.filter((pid) => !draft.participants[pid]!.ready);
  if (notReady.length && p.confirmNotReady !== true) throw new RoomError("CONFIRM_REQUIRED", undefined, { notReady: notReady.length });

  const countdownSec = isCountdownChoice(s.studio!.countdownSec) ? s.studio!.countdownSec : CAPTURE_CONFIG.defaultCountdownSec;
  const shot: Shot = {
    index: idx,
    state: "COUNTDOWN",
    t0ServerMs: now + countdownSec * 1000,
    armedBy: by,
    armedAtMs: now,
    countdownSec,
    required,
    slotOf: { ...c.eligible },
    perParticipant: Object.fromEntries(Object.keys(c.eligible).map((pid) => [pid, newPs("PENDING", now)])),
    doneAtMs: null,
    heldBy: null,
  };
  if (cur && cur.index === idx) c.shots[c.shots.length - 1] = shot;
  else c.shots.push(shot);

  // DEC-065: shot pertama yang di-arm mengunci struktur layout; sesi masuk CAPTURING.
  if (first || !s.studio!.structureLocked) {
    s.studio = lockStudioStructure(s.studio!);
    emit({ type: "studio.updated", payload: { sessionId: s.sessionId, studio: publicStudio(s.studio)!, change: s.studio.lastChange } });
  }
  if (s.state === "STUDIO") {
    s.state = "CAPTURING";
    s.eventLog.push({ atMs: now, type: "CAPTURING", by });
    emitSessionState(draft, emit, s);
  }
  emit({ type: "shot.countdown", payload: { sessionId: s.sessionId, shotIndex: idx, t0ServerMs: shot.t0ServerMs!, countdownSec, initiatedBy: by, required } });
  emitCapture(draft, emit, s);
}

/** "Tunggu!" oleh siapa pun sebelum T0 (DEC-026); setelah T0 → TOO_LATE (SY-02). */
export function holdShot(draft: RoomState, emit: Emit, by: string, payload: unknown, now: number) {
  const p = (payload ?? {}) as { sessionId?: unknown; shotIndex?: unknown };
  const s = captureSession(draft, p.sessionId);
  const shot = lastShot(s.capture);
  const idx = toInt(p.shotIndex);
  if (!shot || idx === null || shot.index !== idx) throw new RoomError("TOO_LATE");
  if (shot.state === "DONE") throw new RoomError("SHOT_DONE");
  if (shot.state !== "COUNTDOWN" || shot.t0ServerMs === null || now >= shot.t0ServerMs) throw new RoomError("TOO_LATE");
  const c = s.capture!;
  shot.state = "IDLE";
  shot.t0ServerMs = null;
  shot.required = [];
  shot.heldBy = by;
  shot.perParticipant = Object.fromEntries(Object.keys(c.eligible).map((pid) => [pid, newPs("PENDING", now)]));
  emit({ type: "shot.cancelled", payload: { sessionId: s.sessionId, shotIndex: shot.index, by } });
  emitCapture(draft, emit, s);
}

/** T0 lewat: COUNTDOWN → REVIEW; peserta wajib terhubung → CAPTURING, wajib tapi putus → MISSING. */
export function processT0(draft: RoomState, emit: Emit, now: number, hasSocket: (pid: string) => boolean): boolean {
  const s = activeSession(draft);
  const shot = s?.state === "CAPTURING" ? lastShot(s.capture) : null;
  if (!s || !shot || shot.state !== "COUNTDOWN" || shot.t0ServerMs === null || now < shot.t0ServerMs) return false;
  shot.state = "REVIEW";
  for (const pid of Object.keys(shot.perParticipant)) {
    const ps = shot.perParticipant[pid]!;
    if (!shot.required.includes(pid)) setStatus(ps, "NOT_REQUIRED", now);
    else {
      const part = draft.participants[pid];
      setStatus(ps, part && part.connection === "CONNECTED" && hasSocket(pid) ? "CAPTURING" : "MISSING", now);
    }
  }
  emitCapture(draft, emit, s);
  return true;
}

/** Countdown retake individual habis → CAPTURING untuk peserta itu saja (SY-07: putus → MISSING). */
export function processRetakeT0(draft: RoomState, emit: Emit, pid: string, now: number, hasSocket: (pid: string) => boolean): boolean {
  const s = activeSession(draft);
  const shot = s?.state === "CAPTURING" ? lastShot(s.capture) : null;
  const ps = shot?.state === "REVIEW" ? shot.perParticipant[pid] : undefined;
  if (!s || !shot || !ps || ps.status !== "RETAKE_COUNTDOWN" || ps.retakeT0ServerMs === null || now < ps.retakeT0ServerMs) return false;
  const part = draft.participants[pid];
  ps.retakeT0ServerMs = null;
  setStatus(ps, part && part.connection === "CONNECTED" && hasSocket(pid) ? "CAPTURING" : "MISSING", now);
  emitCapture(draft, emit, s);
  return true;
}

// ---------------------------------------------------------------- attempt

function activeReview(draft: RoomState, sessionId: unknown, shotIndex: unknown): { s: SessionView; c: CaptureState; shot: Shot } {
  const s = captureSession(draft, sessionId);
  const c = s.capture;
  const idx = toInt(shotIndex);
  const shot = c ? c.shots.find((x) => x.index === idx) : undefined;
  if (!c || !shot) throw new RoomError("TOO_LATE");
  if (shot.state === "DONE") throw new RoomError("SHOT_DONE");
  return { s, c, shot };
}

export interface PreparedAttempt {
  attemptId: string;
  previewKey: string;
  fullKey: string;
  /** true bila attempt yang sama dipakai ulang (retry upload / URL kedaluwarsa). */
  reused: boolean;
}

/** `attempt.prepare`: attempt baru untuk peserta yang sedang CAPTURING, atau presign ulang attempt UPLOADING yang sama. */
export function prepareAttempt(draft: RoomState, emit: Emit, by: string, payload: unknown, now: number, hasSocket: (pid: string) => boolean): PreparedAttempt {
  const p = (payload ?? {}) as { sessionId?: unknown; shotIndex?: unknown; kind?: unknown };
  const { s, c, shot } = activeReview(draft, p.sessionId, p.shotIndex);
  // Prepare bisa tiba sedikit sebelum timer T0 server berjalan: lakukan transisi yang jatuh tempo.
  if (shot.state === "COUNTDOWN" && shot.t0ServerMs !== null && now >= shot.t0ServerMs - CAPTURE_CONFIG.prepareEarlyMs) processT0(draft, emit, Math.max(now, shot.t0ServerMs), hasSocket);
  if (shot.state !== "REVIEW") throw new RoomError("TOO_LATE");
  processRetakeT0(draft, emit, by, now + CAPTURE_CONFIG.prepareEarlyMs, hasSocket);
  const ps = shot.perParticipant[by];
  if (!ps || !shot.required.includes(by) || ps.status === "NOT_REQUIRED") throw new RoomError("NOT_REQUIRED");
  const kind = p.kind === "retake" || p.kind === "makeup" ? p.kind : "shot";

  if (ps.status === "UPLOADING" && ps.currentAttemptId) {
    const a = c.attempts[ps.currentAttemptId];
    if (a && a.status === "UPLOADING" && a.ownerId === by) return { attemptId: a.attemptId, previewKey: a.previewKey!, fullKey: a.fullKey!, reused: true };
  }
  if (ps.status !== "CAPTURING") throw new RoomError("TOO_LATE");
  if (ps.attempts.length >= CAPTURE_CONFIG.maxAttemptsPerParticipantShot) throw new RoomError("RATE_LIMITED");
  if (c.bytesUsed + CAPTURE_CONFIG.maxFullBytes + CAPTURE_CONFIG.maxPreviewBytes > CAPTURE_CONFIG.roomStorageLimitBytes) throw new RoomError("ROOM_STORAGE_LIMIT");

  const part = draft.participants[by]!;
  const attemptId = uuidv7(now);
  const attempt: Attempt = {
    attemptId,
    shotIndex: shot.index,
    ownerId: by,
    ownerNameAtCapture: part.displayName,
    ownerColor: part.color,
    attemptNo: ps.attempts.length + 1,
    kind,
    status: "UPLOADING",
    createdAtMs: now,
    capturedAtServerMs: null,
    late: false,
    mirrored: part.mirrored,
    preview: null,
    full: null,
    edit: null,
    purged: false,
    previewKey: attemptKey(draft.roomId, attemptId, "preview"),
    fullKey: attemptKey(draft.roomId, attemptId, "full"),
    editKey: attemptKey(draft.roomId, attemptId, "edit"),
  };
  c.attempts[attemptId] = attempt;
  ps.attempts.push(attemptId);
  ps.currentAttemptId = attemptId;
  setStatus(ps, "UPLOADING", now);
  emitCapture(draft, emit, s);
  return { attemptId, previewKey: attempt.previewKey!, fullKey: attempt.fullKey!, reused: false };
}

export interface UploadClaim {
  attemptId: string;
  part: AttemptPartName;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  capturedAtServerMs: number | null;
}

/** Validasi bentuk klaim upload (input tak tepercaya). */
export function parseUploadClaim(payload: unknown): UploadClaim {
  const p = (payload ?? {}) as Record<string, unknown>;
  const part = p.part === "preview" || p.part === "full" ? p.part : null;
  const bytes = toInt(p.bytes);
  const width = toInt(p.width);
  const height = toInt(p.height);
  if (typeof p.attemptId !== "string" || p.attemptId.length > 64 || !part || bytes === null || width === null || height === null) throw new RoomError("UPLOAD_MISMATCH");
  if (typeof p.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(p.sha256)) throw new RoomError("UPLOAD_MISMATCH");
  const max = part === "preview" ? CAPTURE_CONFIG.maxPreviewBytes : CAPTURE_CONFIG.maxFullBytes;
  const maxPx = part === "preview" ? CAPTURE_CONFIG.previewMaxPx : CAPTURE_CONFIG.fullMaxPx;
  if (bytes < 1 || bytes > max || width < 1 || height < 1 || Math.max(width, height) > maxPx) throw new RoomError("UPLOAD_MISMATCH");
  const cap = typeof p.capturedAtServerMs === "number" && Number.isFinite(p.capturedAtServerMs) ? Math.round(p.capturedAtServerMs) : null;
  return { attemptId: p.attemptId, part, bytes, width, height, sha256: p.sha256, capturedAtServerMs: cap };
}

/** Pra-validasi `attempt.uploaded`: pemilik, status, idempotensi (attemptId, part, sha256). */
export function uploadPrecheck(draft: RoomState, by: string, claim: UploadClaim): { key: string; editKey: string | null; already: boolean } {
  const s = activeSession(draft);
  const a = s?.capture?.attempts[claim.attemptId];
  if (!s || !a) throw new RoomError("UPLOAD_MISMATCH");
  if (a.ownerId !== by) throw new RoomError("FORBIDDEN_NOT_OWNER");
  const shot = s.capture!.shots.find((x) => x.index === a.shotIndex);
  if (shot?.state === "DONE") throw new RoomError("SHOT_DONE");
  const existing = a[claim.part];
  if (existing) {
    if (existing.sha256 === claim.sha256) return { key: "", editKey: null, already: true };
    throw new RoomError("UPLOAD_MISMATCH");
  }
  if (a.status === "REJECTED" || a.status === "FAILED") throw new RoomError("ATTEMPT_REJECTED");
  if (a.status !== "UPLOADING") throw new RoomError("UPLOAD_MISMATCH");
  return { key: (claim.part === "preview" ? a.previewKey : a.fullKey)!, editKey: claim.part === "full" ? (a.editKey ?? null) : null, already: false };
}

/** Bagian upload terverifikasi (objek ada, JPEG valid, ukuran cocok) → catat; preview → DECIDING, kedua bagian → READY. */
export function commitUploadPart(
  draft: RoomState,
  emit: Emit,
  by: string,
  claim: UploadClaim & { finalBytes: number; edit?: { bytes: number; width: number; height: number } | null },
  now: number,
) {
  const s = activeSession(draft);
  const c = s?.capture;
  const a = c?.attempts[claim.attemptId];
  if (!s || !c || !a) throw new RoomError("UPLOAD_MISMATCH");
  if (a.ownerId !== by) throw new RoomError("FORBIDDEN_NOT_OWNER");
  const existing = a[claim.part];
  if (existing) {
    if (existing.sha256 === claim.sha256) return;
    throw new RoomError("UPLOAD_MISMATCH");
  }
  // Attempt ditolak/gagal saat upload berjalan: bagian ini yatim (dibersihkan purge), jangan dihidupkan lagi.
  if (a.status !== "UPLOADING") throw new RoomError("ATTEMPT_REJECTED");
  const shot = c.shots.find((x) => x.index === a.shotIndex)!;
  if (shot.state === "DONE") throw new RoomError("SHOT_DONE");
  a[claim.part] = { bytes: claim.finalBytes, width: claim.width, height: claim.height, sha256: claim.sha256 };
  c.bytesUsed += claim.finalBytes;
  if (claim.part === "full" && claim.edit) {
    a.edit = { bytes: claim.edit.bytes, width: claim.edit.width, height: claim.edit.height, sha256: claim.sha256 };
    c.bytesUsed += claim.edit.bytes;
  }
  const ps = shot.perParticipant[by]!;
  if (claim.part === "preview" && ps.currentAttemptId === a.attemptId && ps.status === "UPLOADING") {
    a.capturedAtServerMs = claim.capturedAtServerMs;
    const t0 = a.kind === "shot" ? shot.t0ServerMs : (ps.retakeT0ServerMs ?? a.createdAtMs);
    a.late = claim.capturedAtServerMs !== null && t0 !== null && claim.capturedAtServerMs - t0 > CAPTURE_CONFIG.lateThresholdMs;
    setStatus(ps, "DECIDING", now);
  }
  if (a.preview && a.full) a.status = "READY";
  emit({ type: "attempt.ready", payload: { sessionId: s.sessionId, shotIndex: a.shotIndex, participantId: by, attemptId: a.attemptId, part: claim.part } });
  emitCapture(draft, emit, s);
}

/** Upload gagal 3× (klien melaporkan): FAILED + "Coba lagi" (09 §11). */
export function failAttempt(draft: RoomState, emit: Emit, by: string, payload: unknown, now: number) {
  const p = (payload ?? {}) as { attemptId?: unknown };
  const s = activeSession(draft);
  const a = s?.capture && typeof p.attemptId === "string" ? s.capture.attempts[p.attemptId] : undefined;
  if (!s || !s.capture || !a) throw new RoomError("UPLOAD_MISMATCH");
  if (a.ownerId !== by) throw new RoomError("FORBIDDEN_NOT_OWNER");
  const shot = s.capture.shots.find((x) => x.index === a.shotIndex)!;
  if (shot.state === "DONE") throw new RoomError("SHOT_DONE");
  if (a.status === "FAILED") return;
  if (a.status !== "UPLOADING") throw new RoomError("ATTEMPT_REJECTED");
  a.status = "FAILED";
  const ps = shot.perParticipant[by]!;
  if (ps.currentAttemptId === a.attemptId) setStatus(ps, "FAILED", now);
  emitCapture(draft, emit, s);
}

// ---------------------------------------------------------------- accept / retake / reopen / skip

export function acceptAttempt(draft: RoomState, emit: Emit, by: string, payload: unknown, now: number) {
  const p = (payload ?? {}) as { sessionId?: unknown; shotIndex?: unknown; attemptId?: unknown };
  const { s, c, shot } = activeReview(draft, p.sessionId, p.shotIndex);
  const a = typeof p.attemptId === "string" ? c.attempts[p.attemptId] : undefined;
  if (!a) throw new RoomError("ATTEMPT_REJECTED");
  if (a.ownerId !== by) throw new RoomError("FORBIDDEN_NOT_OWNER"); // TC-SEC-014
  if (a.shotIndex !== shot.index) throw new RoomError("BAD_REQUEST");
  const ps = shot.perParticipant[by];
  if (!ps) throw new RoomError("NOT_REQUIRED");
  if (ps.status === "ACCEPTED" && ps.acceptedAttemptId === a.attemptId) return; // idempoten
  if (a.status === "REJECTED" || a.status === "FAILED") throw new RoomError("ATTEMPT_REJECTED"); // SY-06
  if (a.status !== "READY") throw new RoomError("UPLOAD_MISMATCH", "NOT_READY");
  if (ps.status !== "DECIDING" || ps.currentAttemptId !== a.attemptId) throw new RoomError("ATTEMPT_REJECTED");
  setAccepted(c, shot, by, a.attemptId, by);
  setStatus(ps, "ACCEPTED", now);
  emitCapture(draft, emit, s);
  maybeComplete(draft, emit, s, now);
}

/** "Ganti pilihanku" (DEC-079): hanya pemilik, sebelum shot DONE; foto accepted tetap sampai ia memutuskan lagi. */
export function reopenDecision(draft: RoomState, emit: Emit, by: string, payload: unknown, now: number) {
  const p = (payload ?? {}) as { sessionId?: unknown; shotIndex?: unknown };
  const { s, shot } = activeReview(draft, p.sessionId, p.shotIndex);
  const ps = shot.perParticipant[by];
  if (!ps) throw new RoomError("NOT_REQUIRED");
  if (ps.status === "DECIDING") return;
  if (ps.status !== "ACCEPTED") throw new RoomError("BAD_REQUEST");
  setStatus(ps, "DECIDING", now);
  emitCapture(draft, emit, s);
}

/**
 * `capture.retake`: HANYA state `by` berubah (attempt-nya, status-nya, countdown-nya). Peserta lain
 * tidak disentuh sama sekali. Tanpa `attemptId` = "Ambil fotomu" / "Coba lagi" (MISSING, FAILED, foto hilang).
 */
export function retakeAttempt(draft: RoomState, emit: Emit, by: string, payload: unknown, now: number) {
  const p = (payload ?? {}) as { sessionId?: unknown; shotIndex?: unknown; attemptId?: unknown };
  const { s, c, shot } = activeReview(draft, p.sessionId, p.shotIndex);
  if (shot.state !== "REVIEW") throw new RoomError("TOO_LATE");
  const ps = shot.perParticipant[by];
  if (!ps || !shot.required.includes(by)) throw new RoomError("NOT_REQUIRED");
  const countdownMs = shot.countdownSec * 1000;
  let rejectedId: string | null = null;
  let attemptNo = ps.attempts.length + 1;

  if (p.attemptId !== undefined && p.attemptId !== null) {
    const a = typeof p.attemptId === "string" ? c.attempts[p.attemptId] : undefined;
    if (!a) throw new RoomError("ATTEMPT_REJECTED");
    if (a.ownerId !== by) throw new RoomError("FORBIDDEN_NOT_OWNER"); // TC-SEC-014
    if (a.status === "REJECTED") return; // idempoten
    if (a.shotIndex !== shot.index || ps.currentAttemptId !== a.attemptId) throw new RoomError("ATTEMPT_REJECTED");
    if (ps.status !== "DECIDING" && ps.status !== "ACCEPTED") throw new RoomError("BAD_REQUEST");
    a.status = "REJECTED";
    if (ps.acceptedAttemptId === a.attemptId) setAccepted(c, shot, by, null, by);
    rejectedId = a.attemptId;
    attemptNo = a.attemptNo;
  } else {
    if (ps.status === "RETAKE_COUNTDOWN") return; // idempoten
    if (!["MISSING", "FAILED", "CAPTURING", "UPLOADING"].includes(ps.status)) throw new RoomError("BAD_REQUEST");
    const cur = ps.currentAttemptId ? c.attempts[ps.currentAttemptId] : undefined;
    if (cur && cur.status !== "READY" && cur.status !== "REJECTED") cur.status = "FAILED";
  }
  ps.currentAttemptId = null;
  ps.retakeT0ServerMs = now + countdownMs;
  setStatus(ps, "RETAKE_COUNTDOWN", now);
  emit({
    type: "retake.started",
    payload: { sessionId: s.sessionId, shotIndex: shot.index, participantId: by, rejectedAttemptId: rejectedId, t0ServerMs: ps.retakeT0ServerMs, attemptNo },
  });
  emitCapture(draft, emit, s);
}

/** "Lanjut tanpa {nama}": hanya untuk peserta wajib yang terputus ≥ 15 detik (DEC-028). */
export function skipParticipant(draft: RoomState, emit: Emit, by: string, payload: unknown, now: number) {
  const p = (payload ?? {}) as { sessionId?: unknown; shotIndex?: unknown; participantId?: unknown };
  const { s, shot } = activeReview(draft, p.sessionId, p.shotIndex);
  if (shot.state !== "REVIEW" || typeof p.participantId !== "string") throw new RoomError("SKIP_NOT_ALLOWED");
  const pid = p.participantId;
  const ps = shot.perParticipant[pid];
  const target = draft.participants[pid];
  if (!ps || !target || !shot.required.includes(pid)) throw new RoomError("SKIP_NOT_ALLOWED");
  if (ps.status === "SKIPPED") return;
  if (ps.status === "ACCEPTED") throw new RoomError("SKIP_NOT_ALLOWED");
  const goneMs = target.disconnectedAtMs !== null ? now - target.disconnectedAtMs : -1;
  if (target.connection !== "RECONNECTING" || goneMs < CAPTURE_CONFIG.skipAfterMs) throw new RoomError("SKIP_NOT_ALLOWED");
  setStatus(ps, "SKIPPED", now);
  ps.retakeT0ServerMs = null;
  emitCapture(draft, emit, s);
  maybeComplete(draft, emit, s, now);
}

// ---------------------------------------------------------------- maju shot

/**
 * DEC-028: semua peserta wajib ACCEPTED/SKIPPED → shot DONE. Attempt yang tidak dipakai ditandai
 * untuk dihapus dari storage (DEC-029). Shot terakhir → sesi EDITING.
 */
export function maybeComplete(draft: RoomState, emit: Emit, s: SessionView, now: number): boolean {
  const c = s.capture;
  const shot = lastShot(c);
  if (!c || !shot || shot.state !== "REVIEW" || !shot.required.length || !shotSettled(shot)) return false;
  shot.state = "DONE";
  shot.doneAtMs = now;
  const accepted: Record<string, string | null> = {};
  for (const pid of Object.keys(shot.perParticipant)) accepted[pid] = shot.perParticipant[pid]!.acceptedAttemptId;
  const keep = new Set(Object.values(accepted).filter((x): x is string => !!x));
  for (const a of Object.values(c.attempts)) {
    if (a.shotIndex !== shot.index || keep.has(a.attemptId)) continue;
    if (a.status !== "REJECTED") a.status = "REJECTED"; // tidak pernah masuk set accepted
  }
  const last = shot.index >= c.shotCount - 1;
  emit({ type: "shot.done", payload: { sessionId: s.sessionId, shotIndex: shot.index, accepted, last } });
  if (last) {
    s.state = "EDITING";
    s.eventLog.push({ atMs: now, type: "EDITING" });
    emitSessionState(draft, emit, s);
  }
  emitCapture(draft, emit, s);
  return true;
}

/** Peserta LEFT: keluar dari `required` shot berjalan (09 §10.1); tak ada yang tersisa → shot dibatalkan. */
export function onParticipantLeft(draft: RoomState, emit: Emit, pid: string, now: number) {
  const s = activeSession(draft);
  const c = s?.capture;
  const shot = lastShot(c ?? null);
  if (!s || !c || !shot || (shot.state !== "COUNTDOWN" && shot.state !== "REVIEW")) return;
  const ps = shot.perParticipant[pid];
  if (!ps || !shot.required.includes(pid)) return;
  shot.required = shot.required.filter((x) => x !== pid);
  if (ps.status !== "ACCEPTED") setStatus(ps, "NOT_REQUIRED", now);
  if (!shot.required.length) {
    // Tidak ada peserta wajib tersisa: shot kembali IDLE (tidak ada foto yang diterima atas nama siapa pun).
    for (const a of Object.values(c.attempts)) if (a.shotIndex === shot.index && a.status !== "REJECTED") a.status = "REJECTED";
    shot.state = "IDLE";
    shot.t0ServerMs = null;
    emit({ type: "shot.cancelled", payload: { sessionId: s.sessionId, shotIndex: shot.index, by: pid } });
    emitCapture(draft, emit, s);
    return;
  }
  emitCapture(draft, emit, s);
  maybeComplete(draft, emit, s, now);
}

/** Attempt di shot DONE yang bukan pilihan pemiliknya & objeknya belum dihapus. */
export function purgeCandidates(state: RoomState): Attempt[] {
  const out: Attempt[] = [];
  for (const s of Object.values(state.sessions)) {
    const c = s.capture;
    if (!c) continue;
    for (const a of Object.values(c.attempts)) {
      const shot = c.shots.find((x) => x.index === a.shotIndex);
      if (!shot || shot.state !== "DONE" || a.purged) continue;
      if (shot.perParticipant[a.ownerId]?.acceptedAttemptId === a.attemptId) continue;
      out.push(a);
    }
  }
  return out;
}

/** Tandai attempt sudah dihapus dari storage; kuota storage room berkurang sebesar byte terverifikasi. */
export function markPurged(draft: RoomState, attemptIds: string[]) {
  for (const s of Object.values(draft.sessions)) {
    const c = s.capture;
    if (!c) continue;
    for (const id of attemptIds) {
      const a = c.attempts[id];
      if (!a || a.purged) continue;
      c.bytesUsed = Math.max(0, c.bytesUsed - (a.preview?.bytes ?? 0) - (a.full?.bytes ?? 0) - (a.edit?.bytes ?? 0));
      a.purged = true;
    }
  }
}
