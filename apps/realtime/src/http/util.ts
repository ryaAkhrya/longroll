import type { IncomingMessage, ServerResponse } from "node:http";
import { cookieNameFor } from "@longroll/shared";
import type { ErrorCode, ErrorResponse } from "@longroll/shared";
import type { ServerConfig } from "../config";

export const MAX_BODY_BYTES = 4 * 1024;

export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !out.has(k)) out.set(k, v);
  }
  return out;
}

export function tokenFromCookie(req: IncomingMessage, roomId: string): string | null {
  return parseCookies(req.headers.cookie).get(cookieNameFor(roomId)) ?? null;
}

/** Cookie kredensial (DEC-082): HttpOnly, SameSite=Strict, Secure (default), umur terbatas & diperbarui. */
export function tokenCookie(config: ServerConfig, roomId: string, token: string, maxAgeSec: number): string {
  const parts = [
    `${cookieNameFor(roomId)}=${token}`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
  ];
  if (config.cookie.secure) parts.push("Secure");
  if (config.cookie.domain) parts.push(`Domain=${config.cookie.domain}`);
  return parts.join("; ");
}

export function clearTokenCookie(config: ServerConfig, roomId: string): string {
  return tokenCookie(config, roomId, "", 0);
}

/** IP klien. X-Forwarded-For hanya dipercaya bila TRUST_PROXY=true (di belakang proxy milik sendiri). */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

export function isAllowedOrigin(config: ServerConfig, origin: string | undefined): origin is string {
  return !!origin && config.allowedOrigins.includes(origin);
}

export function applyCors(config: ServerConfig, req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(config, origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

const STATUS: Record<ErrorCode, number> = {
  AUTH_REQUIRED: 401,
  AUTH_INVALID: 401,
  ORIGIN_FORBIDDEN: 403,
  ROOM_NOT_FOUND: 404,
  ROOM_EXPIRED: 410,
  ROOM_FULL: 409,
  NAME_INVALID: 400,
  RATE_LIMITED: 429,
  BAD_REQUEST: 400,
  UNKNOWN_EVENT: 400,
  NOT_CONNECTED: 409,
  SERVICE_UNAVAILABLE: 503,
};

export function sendError(res: ServerResponse, body: ErrorResponse, headers: Record<string, string | string[]> = {}) {
  const extra = body.retryAfterSec ? { "Retry-After": String(body.retryAfterSec), ...headers } : headers;
  sendJson(res, STATUS[body.error], body, extra);
}

export class BodyError extends Error {}

/** Body JSON kecil (≤ 4 KB) dengan Content-Type application/json. */
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const type = req.headers["content-type"] ?? "";
  if (!type.toLowerCase().startsWith("application/json")) throw new BodyError("content-type");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new BodyError("too large");
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new BodyError("shape");
  return parsed as Record<string, unknown>;
}
