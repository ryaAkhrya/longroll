import { MODE_INFO } from "@longroll/shared";
import type { GalleryView, SessionResult, SessionView } from "@longroll/shared";
import { framePrefix, roomPrefix } from "../storage/types";
import type { ObjectStorage } from "../storage/types";
import type { RoomState } from "./types";

/**
 * Hasil sesi & galeri (P08, 12 §1–§3, 14 §10). Fungsi murni atas state room + helper signed URL.
 * Galeri HANYA memuat attempt yang dipilih pemiliknya di shot DONE (ACCEPTED): tidak ada field/route untuk
 * attempt REJECTED (REQ-GAL-07/08, DEC-092) — penyaringan dilakukan di SERVER, bukan hanya di UI.
 */

export const RESULT_PREVIEW_MAX_BYTES = 1024 * 1024;
export const RESULT_PREVIEW_MAX_PX = 1600;
export const URL_TTL_SEC = 600;

export const sessionPrefix = (roomId: string, sessionId: string) => `${roomPrefix(roomId)}sessions/${sessionId}/`;
export const docSnapshotKey = (roomId: string, sessionId: string) => `${sessionPrefix(roomId, sessionId)}doc.bin`;
export const resultPreviewKey = (roomId: string, sessionId: string) => `${sessionPrefix(roomId, sessionId)}preview.webp`;

/** Attempt yang dipilih pemiliknya di shot DONE → daftar untuk SessionResult. */
export function acceptedList(s: SessionView): SessionResult["acceptedAttempts"] {
  const out: SessionResult["acceptedAttempts"] = [];
  const c = s.capture;
  if (!c) return out;
  for (const shot of c.shots) {
    if (shot.state !== "DONE") continue;
    for (const pid of shot.required) {
      const id = shot.perParticipant[pid]?.acceptedAttemptId;
      const a = id ? c.attempts[id] : undefined;
      if (a) out.push({ shotIndex: shot.index, participantId: pid, attemptId: a.attemptId, participantNameAtCapture: a.ownerNameAtCapture, color: a.ownerColor });
    }
  }
  return out;
}

/** Dibuat/diperbarui saat finalisasi (DEC-059). Finalisasi ulang setelah Balik edit menaikkan `version`. */
export function buildResult(draft: RoomState, s: SessionView, by: string, nowMs: number): SessionResult {
  const accepted = acceptedList(s);
  const seen = new Map<string, SessionResult["participants"][number]>();
  for (const a of accepted) seen.set(a.participantId, { participantId: a.participantId, name: a.participantNameAtCapture, color: a.color });
  for (const p of Object.values(draft.participants)) if (p.connection !== "LEFT" && !seen.has(p.participantId)) seen.set(p.participantId, { participantId: p.participantId, name: p.displayName, color: p.color });
  return {
    sessionId: s.sessionId,
    index: s.index,
    mode: s.mode!,
    title: `Sesi ${s.index}`,
    finalizedAtMs: nowMs,
    finalizedBy: by,
    dateMs: s.lockedAtMs ?? s.createdAtMs,
    frameRef: s.studio?.frame ? s.studio.frame.frameId : null,
    outputPreset: s.studio?.layout.output.preset ?? "AUTO",
    acceptedAttempts: accepted,
    participants: [...seen.values()],
    version: (s.result?.version ?? 0) + 1,
    docSnapshotKey: docSnapshotKey(draft.roomId, s.sessionId),
    previewKey: null,
    previewReady: false,
  };
}

/** Sesi yang tampil di galeri: FINAL atau CLOSED yang punya hasil, urut waktu finalisasi (REQ-GAL-03). */
export function gallerySessions(state: RoomState): SessionView[] {
  return Object.values(state.sessions)
    .filter((s) => (s.state === "FINAL" || s.state === "CLOSED") && s.result)
    .sort((a, b) => a.result!.finalizedAtMs - b.result!.finalizedAtMs);
}

/** Key storage yang boleh diminta lewat `asset.urls`: milik room ini DAN dikenal state (tidak pernah attempt REJECTED). */
export function allowedAssetKeys(state: RoomState): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of gallerySessions(state)) {
    const r = s.result!;
    if (r.previewReady && r.previewKey) out.set(r.previewKey, "result_preview");
    for (const a of r.acceptedAttempts) {
      const at = s.capture?.attempts[a.attemptId];
      if (!at || at.purged) continue;
      if (at.previewKey) out.set(at.previewKey, "attempt_preview");
      if (at.editKey && at.edit) out.set(at.editKey, "attempt_edit");
      if (at.fullKey && at.full) out.set(at.fullKey, "attempt_full");
    }
  }
  // Frame custom milik room (ikut dibersihkan bersama room): signed URL baca sudah ada di jalur frames.
  void framePrefix;
  return out;
}

export async function buildGallery(state: RoomState, storage: ObjectStorage, nowMs: number): Promise<GalleryView> {
  const expiresAtMs = nowMs + URL_TTL_SEC * 1000;
  const sessions: GalleryView["sessions"] = [];
  const perPerson: GalleryView["perPerson"] = [];
  for (const s of gallerySessions(state)) {
    const r = s.result!;
    sessions.push({
      sessionId: s.sessionId,
      index: s.index,
      mode: s.mode ? MODE_INFO[s.mode].name : "",
      title: r.title,
      finalizedAtMs: r.finalizedAtMs,
      version: r.version,
      dateMs: r.dateMs,
      state: s.state as "FINAL" | "CLOSED",
      previewUrl: r.previewReady && r.previewKey ? await storage.presignGet(r.previewKey, URL_TTL_SEC) : null,
      expiresAtMs,
      participants: r.participants,
    });
    for (const a of r.acceptedAttempts) {
      const at = s.capture?.attempts[a.attemptId];
      if (!at || at.purged || !at.previewKey || !at.preview) continue;
      perPerson.push({
        sessionId: s.sessionId,
        shotIndex: a.shotIndex,
        participantId: a.participantId,
        participantName: a.participantNameAtCapture,
        color: a.color,
        attemptId: a.attemptId,
        previewUrl: await storage.presignGet(at.previewKey, URL_TTL_SEC),
        expiresAtMs,
      });
    }
  }
  return { sessions, perPerson };
}
