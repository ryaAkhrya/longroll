import { createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { CAPTURE_CONFIG, FRAME_LIMITS, isCompleteRoomCode, LIMITS, normalizeRoomCode } from "@longroll/shared";
import type { ErrorResponse, IceServersResponse, ParticipantView, PreviewResponse, SessionResponse } from "@longroll/shared";
import type { ServerConfig } from "../config";
import type { FrameService } from "../frames/service";
import { RESULT_PREVIEW_MAX_BYTES } from "../room/results";
import type { LocalUrlSigner } from "../storage/signer";
import type { ObjectStorage } from "../storage/types";
import { padTo } from "../guard/timing";
import { errText, log, metrics } from "../log";
import type { RoomActor } from "../room/RoomActor";
import type { RoomManager } from "../room/RoomManager";
import { RoomError } from "../room/types";
import { initialOf } from "../room/views";
import { StoreUnavailableError } from "../store/types";
import type { RoomStore } from "../store/types";
import { RateLimiter } from "./rateLimit";
import {
  applyCors,
  BodyError,
  clearTokenCookie,
  clientIp,
  isAllowedOrigin,
  readJson,
  sendError,
  sendJson,
  tokenCookie,
  tokenFromCookie,
} from "./util";


interface ApiDeps {
  config: ServerConfig;
  manager: RoomManager;
  store: RoomStore;
  storage: ObjectStorage;
  frames: FrameService;
  /** Dibagi dengan gateway WS supaya kode salah lewat WS ikut dihitung (anti enumerasi). */
  limiter?: RateLimiter;
}

const ROUTE = /^\/api\/rooms\/([^/]+)\/(preview|join|session|leave|turn-credentials)$/;
const FRAME_ROUTE = /^\/api\/rooms\/([^/]+)\/frames(?:\/([0-9a-f-]{36})\/(complete|url))?$/;
const ATTEMPT_ROUTE = /^\/api\/rooms\/([^/]+)\/attempts\/([0-9a-f-]{36})\/url$/;
const ATTEMPT_KEY = /^rooms\/[^/]+\/attempts\/[^/]+\/(preview|full)\.jpg$/;
const RESULT_KEY = /^rooms\/[^/]+\/sessions\/[^/]+\/preview\.webp$/;
const STORAGE_ROUTE = /^\/api\/storage\/([A-Za-z0-9_\-.]{1,2048})$/;

/** Storage lokal (memori/folder) menyajikan URL bertanda tangan lewat service ini. */
type LocalStorage = ObjectStorage & { signer: LocalUrlSigner; contentTypeOf(key: string): string | null };
function isLocal(s: ObjectStorage): s is LocalStorage {
  return "signer" in s && "contentTypeOf" in s;
}

export function createApiHandler({ config, manager, store, storage, frames, limiter: sharedLimiter }: ApiDeps) {
  const limiter = sharedLimiter ?? new RateLimiter(store, config.rateLimitSalt);

  const wsUrlFor = (code: string) => `${config.publicWsUrl}?code=${encodeURIComponent(code)}`;

  function sessionBody(actor: RoomActor, participant: ParticipantView): SessionResponse {
    return {
      roomId: actor.roomId,
      roomCode: actor.code,
      participantId: participant.participantId,
      color: participant.color,
      wsUrl: wsUrlFor(actor.code),
      credentialTtlSec: config.credential.ttlSeconds,
    };
  }

  function issueCookie(actor: RoomActor, token: string) {
    return tokenCookie(config, actor.roomId, token, config.credential.ttlSeconds);
  }

  const pad = (started: number) => padTo(started);

  function fail(res: ServerResponse, err: unknown, extra: Partial<ErrorResponse> = {}) {
    if (err instanceof RoomError) {
      return sendError(res, {
        error: err.code,
        reason: err.reason,
        ...(err.code === "ROOM_EXPIRED" ? { graceSeconds: config.room.graceSeconds } : {}),
        ...(err.code === "SERVICE_UNAVAILABLE" ? { retryAfterSec: 5 } : {}),
        ...extra,
      });
    }
    if (err instanceof StoreUnavailableError) metrics.inc("store_unavailable_total");
    if (err instanceof StoreUnavailableError) return sendError(res, { error: "SERVICE_UNAVAILABLE", retryAfterSec: 2 });
    if (err instanceof BodyError || err instanceof SyntaxError || err instanceof URIError) return sendError(res, { error: "BAD_REQUEST" });
    log.error("api.unhandled", { message: errText(err) });
    return sendError(res, { error: "SERVICE_UNAVAILABLE" });
  }

  /** Endpoint yang mengubah state wajib Origin yang diizinkan (CSRF/TH-13). */
  function requireOrigin(req: IncomingMessage, res: ServerResponse): boolean {
    if (isAllowedOrigin(config, req.headers.origin)) return true;
    sendError(res, { error: "ORIGIN_FORBIDDEN" });
    return false;
  }

  /** Kode salah dihitung & diblokir (DEC-067). */
  async function resolveOpen(code: string, ip: string, res: ServerResponse, started: number): Promise<RoomActor | null> {
    const block = await limiter.blocked("wrongCode", ip);
    if (block.blocked) {
      await pad(started);
      sendError(res, { error: "RATE_LIMITED", retryAfterSec: block.retryAfterSec });
      return null;
    }
    const found = isCompleteRoomCode(code) ? await manager.lookup(code) : ({ kind: "missing" } as const);
    if (found.kind === "open") return found.actor;
    await pad(started);
    if (found.kind === "expired") {
      sendError(res, { error: "ROOM_EXPIRED", graceSeconds: config.room.graceSeconds });
    } else {
      await limiter.consume("wrongCode", ip);
      sendError(res, { error: "ROOM_NOT_FOUND" });
    }
    return null;
  }

  async function createRoom(req: IncomingMessage, res: ServerResponse) {
    if (!requireOrigin(req, res)) return;
    const ip = clientIp(req, config.trustProxy);
    const body = await readJson(req);
    const rl = await limiter.consume("create", ip);
    if (!rl.ok) return sendError(res, { error: "RATE_LIMITED", retryAfterSec: rl.retryAfterSec });
    // Pengaman global (bukan per IP): botnet dengan banyak IP tetap tidak bisa membanjiri Neon/memori.
    const global = limiter.globalCreate();
    if (!global.ok) return sendError(res, { error: "RATE_LIMITED", retryAfterSec: global.retryAfterSec });
    const { actor, participant, token } = await manager.create(body.displayName);
    sendJson(res, 201, sessionBody(actor, participant), { "Set-Cookie": issueCookie(actor, token) });
  }

  async function preview(req: IncomingMessage, res: ServerResponse, code: string) {
    const started = Date.now();
    const ip = clientIp(req, config.trustProxy);
    const rl = await limiter.consume("preview", ip);
    if (!rl.ok) return sendError(res, { error: "RATE_LIMITED", retryAfterSec: rl.retryAfterSec });
    const actor = await resolveOpen(code, ip, res, started);
    if (!actor) return;
    const view = actor.view();
    const active = view.participants.filter((p) => p.connection !== "LEFT");
    const body: PreviewResponse = {
      exists: true,
      status: view.status as PreviewResponse["status"],
      participantCount: active.length,
      capacity: LIMITS.maxParticipants,
      initials: active.map((p) => initialOf(p.displayName)),
      colors: active.map((p) => p.color),
      holding: active.filter((p) => p.connection === "RECONNECTING").length,
    };
    await pad(started);
    sendJson(res, 200, body);
  }

  async function join(req: IncomingMessage, res: ServerResponse, code: string) {
    if (!requireOrigin(req, res)) return;
    const started = Date.now();
    const ip = clientIp(req, config.trustProxy);
    const body = await readJson(req);
    const rl = await limiter.consume("join", ip);
    if (!rl.ok) return sendError(res, { error: "RATE_LIMITED", retryAfterSec: rl.retryAfterSec });
    const actor = await resolveOpen(code, ip, res, started);
    if (!actor) return;
    // Browser yang sudah punya kredensial valid untuk room ini tidak membuat peserta kedua.
    const existing = actor.authenticate(tokenFromCookie(req, actor.roomId));
    const result = existing ? await actor.refreshSession(tokenFromCookie(req, actor.roomId)) : await actor.join(body.displayName);
    sendJson(res, 200, sessionBody(actor, result.participant), { "Set-Cookie": issueCookie(actor, result.token) });
  }

  /** Validasi cookie + rotasi token + perpanjang umur cookie (dipanggil sebelum tiap koneksi WS). */
  async function session(req: IncomingMessage, res: ServerResponse, code: string) {
    if (!requireOrigin(req, res)) return;
    const found = isCompleteRoomCode(code) ? await manager.lookup(code) : ({ kind: "missing" } as const);
    if (found.kind === "missing") return sendError(res, { error: "ROOM_NOT_FOUND" });
    if (found.kind === "expired") return sendError(res, { error: "ROOM_EXPIRED", graceSeconds: config.room.graceSeconds });
    const actor = found.actor;
    const token = tokenFromCookie(req, actor.roomId);
    if (!token) return sendError(res, { error: "AUTH_REQUIRED" });
    try {
      const result = await actor.refreshSession(token);
      sendJson(res, 200, sessionBody(actor, result.participant), { "Set-Cookie": issueCookie(actor, result.token) });
    } catch (err) {
      if (err instanceof RoomError && err.code === "AUTH_INVALID") {
        return sendError(res, { error: "AUTH_INVALID" }, { "Set-Cookie": clearTokenCookie(config, actor.roomId) });
      }
      throw err;
    }
  }

  /** Keluar (F-18): cabut token di server + hapus cookie HttpOnly (JS tidak bisa menghapusnya). */
  /**
   * ICE servers (14 §4, 13 §5): hanya untuk pemegang token room. Kredensial TURN sementara (HMAC, TTL
   * default 1 jam) bila TURN_SHARED_SECRET + TURN_URLS diset; selain itu STUN saja (`turn: false`).
   */
  async function turnCredentials(req: IncomingMessage, res: ServerResponse, code: string) {
    if (req.headers.origin !== undefined && !isAllowedOrigin(config, req.headers.origin)) return sendError(res, { error: "ORIGIN_FORBIDDEN" });
    const found = isCompleteRoomCode(code) ? await manager.lookup(code) : ({ kind: "missing" } as const);
    if (found.kind !== "open") return sendError(res, { error: found.kind === "expired" ? "ROOM_EXPIRED" : "ROOM_NOT_FOUND" });
    const pid = found.actor.authenticate(tokenFromCookie(req, found.actor.roomId));
    if (!pid) return sendError(res, { error: "AUTH_INVALID" });
    const { stunUrls, turnUrls, turnSharedSecret, turnTtlSeconds } = config.ice;
    const body: IceServersResponse = { iceServers: [], ttlSec: turnTtlSeconds, turn: false };
    if (stunUrls.length) body.iceServers.push({ urls: stunUrls });
    if (turnSharedSecret && turnUrls.length) {
      const username = `${Math.floor(Date.now() / 1000) + turnTtlSeconds}:${pid}`;
      const credential = createHmac("sha1", turnSharedSecret).update(username).digest("base64");
      body.iceServers.push({ urls: turnUrls, username, credential });
      body.turn = true;
    }
    sendJson(res, 200, body);
  }

  /** Pemegang cookie room ini (bukan LEFT). Mengirim error & null bila gagal. */
  async function authed(req: IncomingMessage, res: ServerResponse, code: string): Promise<{ actor: RoomActor; pid: string } | null> {
    const found = isCompleteRoomCode(code) ? await manager.lookup(code) : ({ kind: "missing" } as const);
    if (found.kind !== "open") {
      sendError(res, { error: found.kind === "expired" ? "ROOM_EXPIRED" : "ROOM_NOT_FOUND" });
      return null;
    }
    const pid = found.actor.authenticate(tokenFromCookie(req, found.actor.roomId));
    if (!pid) {
      sendError(res, { error: "AUTH_INVALID" });
      return null;
    }
    return { actor: found.actor, pid };
  }

  /** Frame custom (14 §4): presign, complete (validasi server), signed URL baca ≤ 10 menit. */
  async function frameRoute(req: IncomingMessage, res: ServerResponse, code: string, frameId: string | undefined, action: string | undefined) {
    if (req.method === "POST" && !requireOrigin(req, res)) return;
    if (req.method === "GET" && req.headers.origin !== undefined && !isAllowedOrigin(config, req.headers.origin)) return sendError(res, { error: "ORIGIN_FORBIDDEN" });
    const who = await authed(req, res, code);
    if (!who) return;
    if (!frameId && req.method === "POST") return sendJson(res, 200, await frames.prepare(who.actor, who.pid, await readJson(req)));
    if (frameId && action === "complete" && req.method === "POST") return sendJson(res, 200, await frames.complete(who.actor, who.pid, frameId));
    if (frameId && action === "url" && req.method === "GET") return sendJson(res, 200, await frames.url(who.actor, frameId));
    sendJson(res, 405, { error: "BAD_REQUEST" });
  }

  /**
   * Signed URL baca foto attempt (≤ 10 menit). Hanya pemegang cookie room INI; attempt dicari di state room
   * itu sendiri, jadi attempt room lain / yang sudah dihapus = 404. Preview: semua peserta (saling melihat
   * hasil & retake, 09 §9.3). Full: pemiliknya atau bila sudah dipilih (accepted) di shot DONE.
   */
  async function attemptUrl(req: IncomingMessage, res: ServerResponse, code: string, attemptId: string, url: URL) {
    if (req.headers.origin !== undefined && !isAllowedOrigin(config, req.headers.origin)) return sendError(res, { error: "ORIGIN_FORBIDDEN" });
    const who = await authed(req, res, code);
    if (!who) return;
    const q = url.searchParams.get("part");
    const part = q === "full" ? "full" : q === "edit" ? "edit" : "preview";
    const a = who.actor.attemptRecord(attemptId);
    if (!a || a.purged || a.status === "FAILED") return sendError(res, { error: "FRAME_NOT_FOUND" });
    if (part === "full" && !a.full) return sendError(res, { error: "FRAME_NOT_FOUND" });
    if (part === "edit" && !a.edit) return sendError(res, { error: "FRAME_NOT_FOUND" });
    if (part === "preview" && !a.preview) return sendError(res, { error: "FRAME_NOT_FOUND" });
    if (part !== "preview" && a.ownerId !== who.pid && !who.actor.isAcceptedAttempt(attemptId)) return sendError(res, { error: "FORBIDDEN_NOT_OWNER" });
    const key = part === "full" ? a.fullKey : part === "edit" ? a.editKey : a.previewKey;
    if (!key || !storage) return sendError(res, { error: "FRAME_NOT_FOUND" });
    const ttl = CAPTURE_CONFIG.viewUrlTtlSec;
    sendJson(res, 200, { url: await storage.presignGet(key, ttl), expiresAtMs: Date.now() + ttl * 1000 });
  }

  /**
   * URL bertanda tangan untuk storage LOKAL (meniru presigned S3). PUT hanya ke key upload mentah,
   * Content-Type wajib sama dengan yang ditandatangani, body dibatasi ukuran deklarasi (≤ 10 MB).
   */
  async function storageRoute(req: IncomingMessage, res: ServerResponse, token: string) {
    if (!isLocal(storage)) return sendJson(res, 404, { error: "BAD_REQUEST" });
    const claims = storage.signer.verify(token);
    if (!claims || claims.m !== req.method) return sendJson(res, 403, { error: "AUTH_INVALID" });
    if (!claims.k.startsWith("rooms/") || claims.k.includes("..")) return sendJson(res, 403, { error: "AUTH_INVALID" });
    if (req.method === "GET") {
      const bytes = await storage.get(claims.k, FRAME_LIMITS.MAX_BYTES * 4);
      if (!bytes) return sendJson(res, 404, { error: "FRAME_NOT_FOUND" });
      res.statusCode = 200;
      res.setHeader("Content-Type", storage.contentTypeOf(claims.k) ?? "application/octet-stream");
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.end(Buffer.from(bytes));
      return;
    }
    // PUT sekali pakai: objek yang sudah diverifikasi server tidak bisa ditimpa dengan URL yang sama. Token "habis"
    // hanya bila objek benar-benar tertulis; kegagalan melepasnya supaya retry jaringan boleh memakai URL yang sama.
    if (!storage.signer.consume(token)) return sendJson(res, 403, { error: "AUTH_INVALID" });
    let stored = false;
    try {
      if ((!claims.k.endsWith(".upload") && !ATTEMPT_KEY.test(claims.k) && !RESULT_KEY.test(claims.k)) || !claims.ct || !claims.max) return sendJson(res, 403, { error: "AUTH_INVALID" });
      const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      if (type !== claims.ct) return sendJson(res, 403, { error: "FRAME_UNSUPPORTED" });
      const max = Math.min(claims.max, claims.k.endsWith(".upload") ? FRAME_LIMITS.MAX_BYTES : RESULT_KEY.test(claims.k) ? RESULT_PREVIEW_MAX_BYTES : CAPTURE_CONFIG.maxFullBytes);
      const declared = Number(req.headers["content-length"] ?? "NaN");
      if (Number.isFinite(declared) && declared > max) {
        req.resume();
        return sendError(res, { error: "FRAME_TOO_LARGE" });
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > max) {
          req.destroy();
          return sendError(res, { error: "FRAME_TOO_LARGE" });
        }
        chunks.push(chunk as Buffer);
      }
      await storage.put(claims.k, Buffer.concat(chunks), claims.ct);
      stored = true;
      sendJson(res, 200, { ok: true });
    } finally {
      if (!stored) storage.signer.release(token);
    }
  }

  async function leave(req: IncomingMessage, res: ServerResponse, code: string) {
    if (!requireOrigin(req, res)) return;
    const found = isCompleteRoomCode(code) ? await manager.lookup(code) : ({ kind: "missing" } as const);
    if (found.kind !== "open") return sendJson(res, 200, { ok: true });
    const actor = found.actor;
    const pid = actor.authenticate(tokenFromCookie(req, actor.roomId));
    if (pid) await actor.leave(pid);
    sendJson(res, 200, { ok: true }, { "Set-Cookie": clearTokenCookie(config, actor.roomId) });
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://internal");
    if (!url.pathname.startsWith("/api/")) return false;
    applyCors(config, req, res);
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      if (req.method !== "OPTIONS") {
        // Lalu lintas umum per IP di memori (tanpa menyentuh Neon). Storage lokal punya jatah lebih besar.
        const ip = clientIp(req, config.trustProxy);
        const g = limiter.general(url.pathname.startsWith("/api/storage/") ? "storage" : "api", ip);
        if (!g.ok) {
          sendError(res, { error: "RATE_LIMITED", retryAfterSec: g.retryAfterSec });
          return true;
        }
      }
      if (req.method === "OPTIONS") {
        if (!isAllowedOrigin(config, req.headers.origin)) {
          sendError(res, { error: "ORIGIN_FORBIDDEN" });
          return true;
        }
        res.statusCode = 204;
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.setHeader("Access-Control-Max-Age", "600");
        res.end();
        return true;
      }
      if (url.pathname === "/api/health" && req.method === "GET") {
        sendJson(res, 200, { ok: true, store: store.kind, storeOk: await store.ping() });
        return true;
      }
      if (url.pathname === "/api/rooms" && req.method === "POST") {
        await createRoom(req, res);
        return true;
      }
      const am = ATTEMPT_ROUTE.exec(url.pathname);
      if (am && req.method === "GET") {
        await attemptUrl(req, res, normalizeRoomCode(decodeURIComponent(am[1]!)), am[2]!, url);
        return true;
      }
      const fm = FRAME_ROUTE.exec(url.pathname);
      if (fm) {
        await frameRoute(req, res, normalizeRoomCode(decodeURIComponent(fm[1]!)), fm[2], fm[3]);
        return true;
      }
      const sm = STORAGE_ROUTE.exec(url.pathname);
      if (sm) {
        await storageRoute(req, res, sm[1]!);
        return true;
      }
      const m = ROUTE.exec(url.pathname);
      if (m) {
        const code = normalizeRoomCode(decodeURIComponent(m[1]!));
        const action = m[2];
        if (action === "preview" && req.method === "GET") await preview(req, res, code);
        else if (action === "join" && req.method === "POST") await join(req, res, code);
        else if (action === "session" && req.method === "POST") await session(req, res, code);
        else if (action === "leave" && req.method === "POST") await leave(req, res, code);
        else if (action === "turn-credentials" && req.method === "GET") await turnCredentials(req, res, code);
        else sendJson(res, 405, { error: "BAD_REQUEST" });
        return true;
      }
      sendJson(res, 404, { error: "BAD_REQUEST" });
    } catch (err) {
      fail(res, err);
    }
    return true;
  };
}
