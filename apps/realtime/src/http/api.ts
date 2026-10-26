import type { IncomingMessage, ServerResponse } from "node:http";
import { isCompleteRoomCode, LIMITS, normalizeRoomCode } from "@longroll/shared";
import type { ErrorResponse, ParticipantView, PreviewResponse, SessionResponse } from "@longroll/shared";
import type { ServerConfig } from "../config";
import { log } from "../log";
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

/** Waktu respons minimum preview/join-not-found supaya ada/tidaknya kode tidak bocor lewat timing (15 §3). */
const MIN_LOOKUP_MS = 120;

interface ApiDeps {
  config: ServerConfig;
  manager: RoomManager;
  store: RoomStore;
}

const ROUTE = /^\/api\/rooms\/([^/]+)\/(preview|join|session|leave)$/;

export function createApiHandler({ config, manager, store }: ApiDeps) {
  const limiter = new RateLimiter(store, config.rateLimitSalt);

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

  async function pad(started: number) {
    const left = MIN_LOOKUP_MS - (Date.now() - started);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
  }

  function fail(res: ServerResponse, err: unknown, extra: Partial<ErrorResponse> = {}) {
    if (err instanceof RoomError) {
      return sendError(res, {
        error: err.code,
        reason: err.reason,
        ...(err.code === "ROOM_EXPIRED" ? { graceSeconds: config.room.graceSeconds } : {}),
        ...extra,
      });
    }
    if (err instanceof StoreUnavailableError) return sendError(res, { error: "SERVICE_UNAVAILABLE", retryAfterSec: 2 });
    if (err instanceof BodyError || err instanceof SyntaxError || err instanceof URIError) return sendError(res, { error: "BAD_REQUEST" });
    log.error("api.unhandled", { message: err instanceof Error ? err.message : "error" });
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
    try {
      if (req.method === "OPTIONS") {
        if (!isAllowedOrigin(config, req.headers.origin)) {
          sendError(res, { error: "ORIGIN_FORBIDDEN" });
          return true;
        }
        res.statusCode = 204;
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
      const m = ROUTE.exec(url.pathname);
      if (m) {
        const code = normalizeRoomCode(decodeURIComponent(m[1]!));
        const action = m[2];
        if (action === "preview" && req.method === "GET") await preview(req, res, code);
        else if (action === "join" && req.method === "POST") await join(req, res, code);
        else if (action === "session" && req.method === "POST") await session(req, res, code);
        else if (action === "leave" && req.method === "POST") await leave(req, res, code);
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
