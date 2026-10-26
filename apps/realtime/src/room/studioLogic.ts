import {
  FRAME_LIMITS,
  PARTICIPANT_SLOTS,
  applyStudioPatch,
  builtinFrame,
  initStudio,
  lockStudioStructure,
  publicStudio,
  regenerateForParticipants,
  revertStudio,
  sanitizePatch,
} from "@longroll/shared";
import type { CustomFrameView, FrameContentType, FrameTemplate, ParticipantSlot, SessionView, StudioContext, StudioResult } from "@longroll/shared";
import { uuidv7 } from "../security";
import { framePrefix } from "../storage/types";
import { activeSession } from "./sessionLogic";
import type { Emit, StudioInit } from "./sessionLogic";
import { RoomError } from "./types";
import type { RoomState, ServerFrame } from "./types";

/**
 * Studio bersama (P05) & frame custom sebagai fungsi atas DRAFT state di dalam commit actor.
 * Logika patch/validasi/undo ada di `@longroll/shared` (sama persis dengan prediksi klien);
 * modul ini menambah otorisasi state, identitas pengubah, dan event.
 */

/** Slot peserta wajib (non-LEFT), urut P1..P4. */
export function participantSlotsOf(state: RoomState): ParticipantSlot[] {
  const used = new Set(Object.values(state.participants).filter((p) => p.connection !== "LEFT").map((p) => p.color));
  return PARTICIPANT_SLOTS.filter((s) => used.has(s));
}

export function frameLookupFor(state: RoomState): StudioContext["frameLookup"] {
  return (frameId, source) => {
    if (source === "BUILTIN") return builtinFrame(frameId);
    const f = state.frames[frameId];
    return f?.status === "READY" && f.template ? f.template : undefined;
  };
}

/** Hook lock mode (P04 → P05): studio awal dengan default mode (DEC-061 OPEN: default sementara). */
export const defaultStudioInit: StudioInit = (draft, s) => {
  if (!s.mode) return;
  const slots = participantSlotsOf(draft);
  s.studio = initStudio(s.mode, slots.length ? slots : ["P1"]);
};

/** SessionView untuk klien: tanpa nilai undo internal. */
export function publicSession(s: SessionView): SessionView {
  return { ...structuredClone(s), studio: publicStudio(s.studio) };
}

function emitStudio(emit: Emit, s: SessionView) {
  emit({ type: "studio.updated", payload: { sessionId: s.sessionId, studio: publicStudio(s.studio)!, change: s.studio?.lastChange ?? null } });
}

function requireStudio(draft: RoomState, sessionId: unknown): SessionView {
  const s = activeSession(draft);
  if (!s || s.sessionId !== sessionId || s.state !== "STUDIO" || !s.studio || !s.mode) throw new RoomError("NOT_IN_STUDIO");
  return s;
}

function context(draft: RoomState, s: SessionView, by: string, nowMs: number): StudioContext {
  return { mode: s.mode!, participantSlots: participantSlotsOf(draft), by, nowMs, changeId: uuidv7(nowMs), frameLookup: frameLookupFor(draft) };
}

function apply(s: SessionView, r: StudioResult, emit: Emit) {
  if (!r.ok) throw new RoomError(r.error.code, r.error.reason, r.error.violation ? { violation: r.error.violation } : undefined);
  s.studio = r.studio;
  emitStudio(emit, s);
}

/** `studio.update {sessionId, patch, baseVersion}` (14 §6). Mode tidak bisa diubah lewat studio (MODE_LOCKED). */
export function studioUpdate(draft: RoomState, emit: Emit, by: string, payload: unknown, nowMs: number) {
  const p = (payload ?? {}) as { sessionId?: unknown; patch?: unknown; baseVersion?: unknown };
  const s = requireStudio(draft, p.sessionId);
  if (p.patch && typeof p.patch === "object" && "mode" in p.patch) throw new RoomError("MODE_LOCKED");
  const patch = sanitizePatch(p.patch);
  if (!patch) throw new RoomError("INVALID_PATCH", "SHAPE");
  const base = Number.isInteger(p.baseVersion) ? (p.baseVersion as number) : undefined;
  apply(s, applyStudioPatch(s.studio!, patch, base, context(draft, s, by, nowMs)), emit);
}

/** `studio.revert {sessionId, changeId}` — "Balikin" satu langkah (perubahan terakhir saja). */
export function studioRevert(draft: RoomState, emit: Emit, by: string, payload: unknown, nowMs: number) {
  const p = (payload ?? {}) as { sessionId?: unknown; changeId?: unknown };
  const s = requireStudio(draft, p.sessionId);
  if (typeof p.changeId !== "string") throw new RoomError("INVALID_PATCH", "SHAPE");
  apply(s, revertStudio(s.studio!, p.changeId, context(draft, s, by, nowMs)), emit);
}

/** Peserta berubah saat STUDIO sebelum shot 1 → BindingPlan dibangkitkan ulang (07 §7.2). */
export function syncStudioParticipants(draft: RoomState, emit: Emit) {
  const s = activeSession(draft);
  if (!s || s.state !== "STUDIO" || !s.studio || !s.mode) return;
  const next = regenerateForParticipants(s.studio, s.mode, participantSlotsOf(draft), frameLookupFor(draft));
  if (!next) return;
  s.studio = next;
  emitStudio(emit, s);
}

/** Kunci struktur setelah shot pertama (DEC-065). Dipicu P06; tersedia sekarang untuk diuji. */
export function lockStructure(draft: RoomState, emit: Emit, sessionId: string) {
  const s = requireStudio(draft, sessionId);
  if (s.studio!.structureLocked) return;
  s.studio = lockStudioStructure(s.studio!);
  emitStudio(emit, s);
}

// ---------------------------------------------------------------- frame custom (10 §9)

export function customFramesOf(state: RoomState): CustomFrameView[] {
  return Object.values(state.frames)
    .filter((f) => f.status === "READY" && f.template)
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
    .map((f) => ({ frameId: f.frameId, template: structuredClone(f.template!), createdAtMs: f.createdAtMs }));
}

/** Nama file upload: hanya teks (render sebagai teks), tanpa path & karakter kontrol. */
export function sanitizeFileName(raw: unknown): string {
  const s = typeof raw === "string" ? raw : "";
  const base = s.split(/[\\/]/).pop() ?? "";
  const clean = Array.from(base.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").trim()).slice(0, FRAME_LIMITS.MAX_FILE_NAME).join("");
  return clean || "frame";
}

function liveFrameCount(state: RoomState, nowMs: number) {
  return Object.values(state.frames).filter((f) => f.status === "READY" || (f.expiresAtMs ?? 0) > nowMs).length;
}

/** Presign (14 §4): tipe & ukuran deklarasi diperiksa; kuota 20/room (DEC-067). Validasi sesungguhnya saat complete. */
export function prepareFrame(draft: RoomState, by: string, input: { fileName: unknown; contentType: unknown; bytes: unknown }, nowMs: number): ServerFrame {
  if (!FRAME_LIMITS.CONTENT_TYPES.includes(input.contentType as FrameContentType)) throw new RoomError("FRAME_UNSUPPORTED");
  const bytes = input.bytes;
  if (!Number.isInteger(bytes) || (bytes as number) < 1) throw new RoomError("BAD_REQUEST");
  if ((bytes as number) > FRAME_LIMITS.MAX_BYTES) throw new RoomError("FRAME_TOO_LARGE");
  if (liveFrameCount(draft, nowMs) >= FRAME_LIMITS.QUOTA_PER_ROOM) throw new RoomError("FRAME_QUOTA");
  const frameId = crypto.randomUUID();
  const frame: ServerFrame = {
    frameId,
    uploadedBy: by,
    status: "PENDING",
    fileName: sanitizeFileName(input.fileName),
    contentType: input.contentType as FrameContentType,
    declaredBytes: bytes as number,
    rawKey: `${framePrefix(draft.roomId)}${frameId}.upload`,
    objectKey: null,
    bytes: null,
    template: null,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + FRAME_LIMITS.UPLOAD_TTL_SEC * 1000,
  };
  draft.frames[frameId] = frame;
  return frame;
}

export function frameReady(draft: RoomState, emit: Emit, frameId: string, result: { objectKey: string; bytes: number; template: FrameTemplate }) {
  const f = draft.frames[frameId];
  if (!f || f.status !== "PENDING") throw new RoomError("FRAME_NOT_FOUND");
  Object.assign(f, { status: "READY", objectKey: result.objectKey, bytes: result.bytes, template: result.template, expiresAtMs: null });
  emit({ type: "frame.added", payload: { frame: { frameId, template: structuredClone(result.template), createdAtMs: f.createdAtMs }, by: f.uploadedBy } });
}

/** Upload PENDING yang kedaluwarsa → dihapus; mengembalikan key objek mentah untuk dihapus dari storage. */
export function expirePendingFrames(draft: RoomState, nowMs: number): string[] {
  const keys: string[] = [];
  for (const f of Object.values(draft.frames)) {
    if (f.status === "PENDING" && (f.expiresAtMs ?? 0) <= nowMs) {
      keys.push(f.rawKey);
      delete draft.frames[f.frameId];
    }
  }
  return keys;
}
