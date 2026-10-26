import { FRAME_LIMITS, MODES } from "@longroll/shared";
import type { ErrorCode, FrameCompleteResponse, FramePrepareResponse, FrameTemplate, FrameUrlResponse } from "@longroll/shared";
import { log, metrics } from "../log";
import type { RoomActor } from "../room/RoomActor";
import { RoomError } from "../room/types";
import type { ServerFrame } from "../room/types";
import type { ObjectStorage } from "../storage/types";
import type { RoomStore } from "../store/types";
import { processFrame } from "./pipeline";

/**
 * Upload frame custom (10 §9, 14 §4, 15 §7): presign → PUT langsung ke storage privat → complete
 * (validasi & re-encode di server) → `frame.added`. Kuota 20/room & 20 upload/jam/peserta (DEC-067).
 */
export class FrameService {
  private readonly inflight = new Map<string, Promise<FrameCompleteResponse>>();

  constructor(
    private readonly storage: ObjectStorage,
    private readonly store: RoomStore,
  ) {}

  async prepare(actor: RoomActor, participantId: string, body: Record<string, unknown>): Promise<FramePrepareResponse & { retryAfterSec?: number }> {
    const hits = await this.store.hit(`frameUpload:${actor.roomId}:${participantId}`, 3600);
    if (hits > FRAME_LIMITS.UPLOADS_PER_HOUR) throw new RoomError("RATE_LIMITED");
    const frame = await actor.framePrepare(participantId, { fileName: body.fileName, contentType: body.contentType, bytes: body.bytes });
    const put = await this.storage.presignPut(frame.rawKey, { contentType: frame.contentType, bytes: frame.declaredBytes, expiresSec: FRAME_LIMITS.UPLOAD_TTL_SEC });
    return { frameId: frame.frameId, uploadUrl: put.url, uploadHeaders: put.headers, expiresInSec: FRAME_LIMITS.UPLOAD_TTL_SEC };
  }

  /** Idempoten: complete ganda untuk frame yang sama memakai hasil yang sama. */
  complete(actor: RoomActor, participantId: string, frameId: string): Promise<FrameCompleteResponse> {
    const key = `${actor.roomId}:${frameId}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = this.doComplete(actor, participantId, frameId).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async doComplete(actor: RoomActor, participantId: string, frameId: string): Promise<FrameCompleteResponse> {
    const f = actor.frameRecord(frameId);
    if (!f || f.uploadedBy !== participantId) throw new RoomError("FRAME_NOT_FOUND");
    if (f.status === "READY") return { frame: { frameId, template: f.template!, createdAtMs: f.createdAtMs }, holes: f.template!.slots?.length ?? 0 };
    if ((f.expiresAtMs ?? 0) <= Date.now()) throw new RoomError("FRAME_NOT_FOUND", "EXPIRED");

    const size = await this.storage.size(f.rawKey);
    if (size === null) throw new RoomError("FRAME_NOT_FOUND", "UPLOAD_MISSING");
    if (size > FRAME_LIMITS.MAX_BYTES) return this.reject(actor, f, "FRAME_TOO_LARGE");
    const raw = await this.storage.get(f.rawKey, FRAME_LIMITS.MAX_BYTES);
    if (!raw) throw new RoomError("FRAME_NOT_FOUND", "UPLOAD_MISSING");

    const started = Date.now();
    const result = await processFrame(raw, f.contentType);
    if (!result.ok) return this.reject(actor, f, result.error, result.reason);

    const objectKey = f.rawKey.replace(/\.upload$/, ".png");
    await this.storage.put(objectKey, result.png, "image/png");
    await this.storage.deleteMany([f.rawKey]);
    const template: FrameTemplate = {
      id: `room/${actor.roomId}/${frameId}`,
      name: Array.from(f.fileName.replace(/\.(png|webp)$/i, "")).slice(0, 40).join("") || "Frame",
      category: "CUSTOM",
      modes: [...MODES],
      baseSize: { w: result.width, h: result.height },
      adapt: result.holes.length ? "FIXED" : "CONTAIN",
      ...(result.holes.length ? { slots: result.holes } : {}),
      layers: { overlay: { kind: "custom", frameId, width: result.width, height: result.height } },
      palette: { bg: result.edgeColor, ink: "#1B1720" },
      license: { source: "Upload peserta room (room-scoped, DEC-054); tanggung jawab pengunggah" },
      version: 1,
      uploadedBy: participantId,
      fileName: f.fileName,
    };
    try {
      await actor.frameReady(frameId, { objectKey, bytes: result.png.byteLength, template });
    } catch (err) {
      await this.storage.deleteMany([objectKey]).catch(() => undefined);
      throw err;
    }
    metrics.inc("frame_upload_success_total");
    log.info("frame.ready", { roomId: actor.roomId, holes: result.holes.length, ms: Date.now() - started });
    return { frame: { frameId, template, createdAtMs: f.createdAtMs }, holes: result.holes.length };
  }

  private async reject(actor: RoomActor, f: ServerFrame, code: ErrorCode, reason?: string): Promise<never> {
    await this.storage.deleteMany([f.rawKey]).catch(() => undefined);
    await actor.frameDiscard(f.frameId).catch(() => undefined);
    metrics.inc("frame_upload_rejected_total");
    log.info("frame.rejected", { roomId: actor.roomId, code, reason });
    throw new RoomError(code, reason);
  }

  /** Signed URL berumur pendek (≤ 10 menit) untuk frame READY milik room ini. */
  async url(actor: RoomActor, frameId: string): Promise<FrameUrlResponse> {
    const f = actor.frameRecord(frameId);
    if (!f || f.status !== "READY" || !f.objectKey) throw new RoomError("FRAME_NOT_FOUND");
    const ttl = FRAME_LIMITS.URL_TTL_SEC;
    return { url: await this.storage.presignGet(f.objectKey, ttl), expiresAtMs: Date.now() + ttl * 1000 };
  }

  /** Sweeper: hapus objek upload PENDING yang kedaluwarsa. */
  async sweep(actor: RoomActor) {
    const keys = await actor.expireFrameUploads();
    if (keys.length) await this.storage.deleteMany(keys).catch(() => log.warn("frame.sweep_delete_failed", { roomId: actor.roomId }));
  }
}
