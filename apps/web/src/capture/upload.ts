import { CAPTURE_CONFIG } from "@longroll/shared";
import type { AttemptPrepared } from "@longroll/shared";
import { ApiError, uploadToUrl } from "@/room/api";
import type { RoomClient } from "@/room/client";
import type { CapturedPhoto, PhotoBlob } from "./captureFrame";

export type UploadOutcome = { ok: true } | { ok: false; reason: "FAILED" | "STALE" };

interface UploadArgs {
  client: RoomClient;
  sessionId: string;
  shotIndex: number;
  kind: "shot" | "retake" | "makeup";
  photo: CapturedPhoto;
  onProgress?: (fraction: number) => void;
  /** Dipakai tes untuk mempercepat backoff. */
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Upload preview dulu lalu full (09 §7.2): PUT ke URL bertanda tangan → `attempt.uploaded` (verifikasi server).
 * Retry 3× dengan backoff 1/2/4 s; ditolak karena ukuran → kompres ulang 0.85 sekali. Respons "basi"
 * (attempt sudah ditolak / shot selesai / bukan wajib) menghentikan upload tanpa error ke pengguna.
 */
export async function uploadAttempt(args: UploadArgs): Promise<UploadOutcome & { attemptId?: string }> {
  const { client, sessionId, shotIndex, kind, photo } = args;
  const sleep = args.sleep ?? wait;
  const prepare = async (): Promise<AttemptPrepared | "STALE" | null> => {
    for (let i = 0; i < 5; i++) {
      const ack = await client.sendIntent("attempt.prepare", { sessionId, shotIndex, kind });
      if (ack.ok) return ack.data as AttemptPrepared;
      // Jam klien sedikit maju dari server → belum T0 di server: coba lagi sebentar.
      if (ack.error === "TOO_LATE" && i < 4) {
        await sleep(250);
        continue;
      }
      if (ack.error === "SERVICE_UNAVAILABLE" || ack.error === "ROOM_STORAGE_LIMIT") return null;
      return "STALE";
    }
    return "STALE";
  };

  let prepared = await prepare();
  if (prepared === "STALE") return { ok: false, reason: "STALE" };
  if (!prepared) return { ok: false, reason: "FAILED" };
  const attemptId = prepared.attemptId;
  const parts: ("preview" | "full")[] = ["preview", "full"];
  let progressDone = 0;

  for (const part of parts) {
    let blob: PhotoBlob = photo[part];
    let recompressed = false;
    let ok = false;
    for (let attempt = 0; attempt <= CAPTURE_CONFIG.uploadRetries && !ok; attempt++) {
      if (attempt > 0) await sleep(CAPTURE_CONFIG.uploadBackoffMs[Math.min(attempt - 1, CAPTURE_CONFIG.uploadBackoffMs.length - 1)]!);
      try {
        const target = prepared!.uploadUrls[part];
        await uploadToUrl(target.url, target.headers, blob.blob, (f) => args.onProgress?.((progressDone + f) / parts.length));
        const ack = await client.sendIntent("attempt.uploaded", {
          attemptId,
          part,
          bytes: blob.blob.size,
          width: blob.width,
          height: blob.height,
          sha256: blob.sha256,
          capturedAtServerMs: photo.capturedAtServerMs,
        });
        if (ack.ok) {
          ok = true;
          break;
        }
        if (["ATTEMPT_REJECTED", "SHOT_DONE", "FORBIDDEN_NOT_OWNER", "NOT_CONNECTED"].includes(ack.error ?? "")) return { ok: false, reason: "STALE", attemptId };
      } catch (err) {
        if (err instanceof ApiError && (err.status === 413 || err.code === "FRAME_TOO_LARGE") && part === "full" && !recompressed) {
          recompressed = true;
          blob = await photo.recompress();
          attempt = -1; // percobaan baru dengan blob yang lebih kecil
          continue;
        }
        if (err instanceof ApiError && err.status === 403) {
          // URL kedaluwarsa: presign ulang attempt yang sama.
          const again = await prepare();
          if (again && again !== "STALE") prepared = again;
        }
      }
    }
    if (!ok) return { ok: false, reason: "FAILED", attemptId };
    progressDone += 1;
  }
  args.onProgress?.(1);
  return { ok: true, attemptId };
}
