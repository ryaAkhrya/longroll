import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { isCompleteRoomCode, normalizeRoomCode, PROTOCOL_VERSION, RATE_LIMITS, WS_CLOSE, WS_MAX_MESSAGE_BYTES } from "@longroll/shared";
import type { C2S, CursorPayload, CursorSurface, S2C } from "@longroll/shared";
import type { ServerConfig } from "../config";
import { clientIp, isAllowedOrigin, tokenFromCookie } from "../http/util";
import { log } from "../log";
import type { RoomActor } from "../room/RoomActor";
import type { RoomManager } from "../room/RoomManager";
import type { RoomConnection } from "../room/types";

const SURFACES: readonly CursorSurface[] = ["vote", "studio", "editor", "lobby"];
const VOLATILE = new Set(["cursor.move", "time.ping"]);
const MAX_CLIENT_EVENT_ID = 64;

class WsConnection implements RoomConnection {
  readonly id = randomUUID();
  lastSeenMs = Date.now();
  private tokens: number = RATE_LIMITS.wsEventsPerSecond;
  private refillAt = Date.now();
  violations = 0;

  constructor(readonly ws: WebSocket) {}

  send(message: S2C) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  close(code: number, reason: string) {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close(code, reason);
  }

  /** Token bucket 60 event/detik/koneksi (15 §9). */
  take(): boolean {
    const now = Date.now();
    const elapsed = now - this.refillAt;
    if (elapsed > 0) {
      this.tokens = Math.min(RATE_LIMITS.wsEventsPerSecond, this.tokens + (elapsed / 1000) * RATE_LIMITS.wsEventsPerSecond);
      this.refillAt = now;
    }
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

function reject(socket: Duplex, status: number, text: string) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function parseCursor(payload: unknown): CursorPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (!SURFACES.includes(p.surface as CursorSurface)) return null;
  const x = Number(p.x);
  const y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const out: CursorPayload = { surface: p.surface as CursorSurface, x: clamp(x), y: clamp(y) };
  if (typeof p.label === "string") out.label = p.label.slice(0, 40);
  return out;
}

/**
 * Gateway WebSocket (P02 §10): auth cookie + Origin saat upgrade (gagal → 401/403),
 * batas 64 KB/pesan, 60 event/detik, heartbeat, takeover multi-tab di actor.
 * Tidak ada mode token di query string; fallback `auth` sengaja tidak diaktifkan (lihat README).
 */
export function createGateway(config: ServerConfig, manager: RoomManager) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_MESSAGE_BYTES });
  const perIp = new Map<string, number>();
  const live = new Set<WsConnection>();

  const heartbeatTimeoutMs = config.room.heartbeatIntervalMs * config.room.heartbeatMissedLimit + 5_000;
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const conn of live) {
      if (now - conn.lastSeenMs > heartbeatTimeoutMs) {
        conn.close(WS_CLOSE.HEARTBEAT_TIMEOUT, "heartbeat");
        setTimeout(() => conn.ws.terminate(), 1_000).unref?.();
      }
    }
  }, 5_000);
  heartbeat.unref?.();

  function onMessage(conn: WsConnection, actor: RoomActor, participantId: string, raw: Buffer) {
    conn.lastSeenMs = Date.now();
    let msg: C2S;
    try {
      msg = JSON.parse(raw.toString("utf8")) as C2S;
    } catch {
      return conn.close(1003, "bad json");
    }
    if (!msg || typeof msg.type !== "string") return conn.close(1003, "bad message");
    const clientEventId =
      typeof msg.clientEventId === "string" && msg.clientEventId.length <= MAX_CLIENT_EVENT_ID ? msg.clientEventId : undefined;

    if (!conn.take()) {
      conn.violations++;
      if (conn.violations > 120) return conn.close(WS_CLOSE.RATE_LIMITED, "rate limited");
      if (!VOLATILE.has(msg.type) && clientEventId) {
        conn.send({ type: "ack", atMs: Date.now(), replyTo: clientEventId, payload: { ok: false, error: "RATE_LIMITED" } });
      }
      return;
    }

    switch (msg.type) {
      case "time.ping": {
        const t1 = Number((msg.payload as { t1?: unknown } | undefined)?.t1);
        conn.send({ type: "time.pong", atMs: Date.now(), payload: { t1: Number.isFinite(t1) ? t1 : null, ts: Date.now() } });
        return;
      }
      case "room.resume": {
        const lastSeq = Number((msg.payload as { lastSeq?: unknown } | undefined)?.lastSeq);
        actor.resume(conn, Number.isInteger(lastSeq) ? lastSeq : -1);
        return;
      }
      case "cursor.move": {
        const cursor = parseCursor(msg.payload);
        if (cursor) actor.relayCursor(participantId, cursor);
        return;
      }
      default:
        void actor.intent(participantId, msg.type, msg.payload, clientEventId).then((ack) => {
          if (clientEventId) conn.send({ type: "ack", atMs: Date.now(), replyTo: clientEventId, payload: ack });
        });
    }
  }

  async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? "/", "http://internal");
    if (url.pathname !== "/ws") return reject(socket, 404, "Not Found");
    if (!isAllowedOrigin(config, req.headers.origin)) return reject(socket, 403, "Forbidden");

    const ip = clientIp(req, config.trustProxy);
    if ((perIp.get(ip) ?? 0) >= RATE_LIMITS.wsConnectionsPerIp) return reject(socket, 429, "Too Many Requests");

    const code = normalizeRoomCode(url.searchParams.get("code") ?? "");
    if (!isCompleteRoomCode(code)) return reject(socket, 404, "Not Found");
    let found;
    try {
      found = await manager.lookup(code);
    } catch {
      return reject(socket, 503, "Service Unavailable");
    }
    if (found.kind === "missing") return reject(socket, 404, "Not Found");
    if (found.kind === "expired") return reject(socket, 410, "Gone");
    const actor = found.actor;
    const participantId = actor.authenticate(tokenFromCookie(req, actor.roomId));
    if (!participantId) return reject(socket, 401, "Unauthorized");

    const version = Number(url.searchParams.get("v"));
    const lastSeqRaw = url.searchParams.get("lastSeq");
    const lastSeq = lastSeqRaw !== null && /^\d+$/.test(lastSeqRaw) ? Number(lastSeqRaw) : null;

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (version !== PROTOCOL_VERSION) {
        ws.close(WS_CLOSE.UPGRADE_REQUIRED, "upgrade required");
        return;
      }
      const conn = new WsConnection(ws);
      live.add(conn);
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);

      ws.on("message", (data, isBinary) => {
        if (isBinary) return conn.close(1003, "binary");
        onMessage(conn, actor, participantId, data as Buffer);
      });
      ws.on("close", () => {
        live.delete(conn);
        const n = (perIp.get(ip) ?? 1) - 1;
        if (n <= 0) perIp.delete(ip);
        else perIp.set(ip, n);
        void actor.detach(conn, participantId).catch(() => undefined);
      });
      ws.on("error", () => undefined);

      actor.attach(conn, participantId, lastSeq).catch((err) => {
        log.warn("ws.attach_failed", { roomId: actor.roomId, message: err instanceof Error ? err.message : "error" });
      });
    });
  }

  return {
    handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      handleUpgrade(req, socket, head).catch(() => reject(socket, 500, "Internal Server Error"));
    },
    close() {
      clearInterval(heartbeat);
      for (const conn of live) conn.ws.terminate();
      wss.close();
    },
    get connectionCount() {
      return live.size;
    },
  };
}
