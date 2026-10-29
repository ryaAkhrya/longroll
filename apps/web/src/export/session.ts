import * as Y from "yjs";
import { computeExportSize, createEditorDoc } from "@longroll/shared";
import type { ExportSize, ResultPreviewPrepared } from "@longroll/shared";
import { attemptUrl } from "@/capture/attemptUrls";
import { sha256Hex } from "@/capture/captureFrame";
import { loadFrameImage } from "@/components/studio/canvas/assets";
import { ApiError, uploadToUrl } from "@/room/api";
import type { RoomClient } from "@/room/client";
import { documentModel } from "@/render/model";
import type { ModelContext } from "@/render/model";
import { ExportError, renderExport } from "./render";
import type { BitmapLike, ExportRequest } from "./render";

/** Pratinjau hasil: sisi terpanjang ≤ 1600 px, WebP ≤ 1 MB (DEC-059/060). */
export const PREVIEW_MAX_PX = 1600;
export const PREVIEW_MAX_BYTES = 1024 * 1024;

const b64 = (u: Uint8Array) => {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Muat dokumen sesi (FINAL atau CLOSED yang punya hasil) lewat `editor.sync`, tanpa ikut mengedit. */
export async function loadSessionDoc(client: RoomClient, sessionId: string): Promise<Y.Doc> {
  const doc = createEditorDoc();
  const ack = await client.sendIntent("editor.sync", { sessionId, stateVector: b64(Y.encodeStateVector(doc)) });
  if (!ack.ok) throw new Error(ack.error ?? "SYNC_FAILED");
  const data = ack.data as { update?: string } | undefined;
  if (data?.update) Y.applyUpdate(doc, unb64(data.update), "remote");
  return doc;
}

/** Foto untuk export: varian `edit` (≤1600 px) bila cukup, `full` hanya bila sel membutuhkan piksel lebih. */
export function photoLoader(code: string, editMaxPx = 1600): ExportRequest["loadPhoto"] {
  return async (attemptId, minLongSide) => {
    const part = minLongSide > editMaxPx ? "full" : "edit";
    const url = await attemptUrl(code, attemptId, part);
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) throw new ExportError("PHOTO_LOAD", "foto");
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    // drawPhotoBody membaca naturalWidth/Height (HTMLImageElement); ImageBitmap hanya punya width/height.
    return Object.defineProperties(bmp, { naturalWidth: { value: bmp.width }, naturalHeight: { value: bmp.height } }) as unknown as BitmapLike;
  };
}

export async function overlayFor(code: string, frameId: string | null) {
  if (!frameId) return null;
  try {
    return await loadFrameImage(code, frameId);
  } catch {
    return null;
  }
}

export interface PreparedExport {
  request: Omit<ExportRequest, "format" | "size" | "onProgress" | "signal">;
  baseW: number;
  baseH: number;
}

export async function prepareExport(client: RoomClient, doc: Y.Doc, ctx: ModelContext): Promise<PreparedExport | null> {
  const m = documentModel(doc, ctx);
  if (!m) return null;
  return {
    request: { model: m.model, overlay: await overlayFor(client.code, m.frameId), loadPhoto: photoLoader(client.code) },
    baseW: m.meta.canvas.w,
    baseH: m.meta.canvas.h,
  };
}

/** Ukuran pratinjau: ASLI diperkecil seragam sampai sisi terpanjang ≤ 1600 px. */
export function previewSize(w: number, h: number): ExportSize {
  const base = computeExportSize({ w, h }, "ASLI");
  const long = Math.max(base.width, base.height);
  if (long <= PREVIEW_MAX_PX) return base;
  const s = PREVIEW_MAX_PX / long;
  return { ...base, scale: s, width: Math.max(1, Math.floor(base.width * s)), height: Math.max(1, Math.floor(base.height * s)) };
}

/**
 * Render pratinjau WebP ≤ 1 MB lalu unggah (`result.preview.prepare` → PUT → `result.preview.uploaded`).
 * `version` harus sama dengan versi finalisasi; versi lama ditolak server (TOO_LATE) dan dilewati.
 */
export async function renderAndUploadPreview(client: RoomClient, sessionId: string, version: number, prepared: PreparedExport, signal?: AbortSignal): Promise<"uploaded" | "stale"> {
  const ack = await client.sendIntent("result.preview.prepare", { sessionId, version });
  if (!ack.ok) return ack.error === "TOO_LATE" ? "stale" : Promise.reject(new Error(ack.error ?? "PREPARE_FAILED"));
  const target = ack.data as ResultPreviewPrepared;
  let size = previewSize(prepared.baseW, prepared.baseH);
  let blob: Blob | null = null;
  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    const out = await renderExport({ ...prepared.request, format: "webp", quality: q, size, signal });
    if (out.blob.size <= Math.min(target.maxBytes, PREVIEW_MAX_BYTES)) {
      blob = out.blob;
      break;
    }
    size = { ...size, scale: size.scale * 0.85, width: Math.floor(size.width * 0.85), height: Math.floor(size.height * 0.85) };
  }
  if (!blob) throw new Error("PREVIEW_TOO_LARGE");
  await uploadToUrl(target.uploadUrl.url, target.uploadUrl.headers, blob, () => undefined).catch((err) => {
    throw err instanceof ApiError ? err : new Error("UPLOAD_FAILED");
  });
  const done = await client.sendIntent("result.preview.uploaded", { sessionId, version, bytes: blob.size, sha256: await sha256Hex(blob) });
  if (done.ok) return "uploaded";
  if (done.error === "TOO_LATE") return "stale";
  throw new Error(done.error ?? "UPLOADED_FAILED");
}
