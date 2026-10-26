import { PROTOCOL_VERSION, RECONNECT, ROOM_DEFAULTS, WS_CLOSE } from "@longroll/shared";
import type {
  AckPayload,
  AuthOkPayload,
  CursorPayload,
  CursorSurface,
  ParticipantView,
  RoomEvent,
  RoomView,
  S2C,
  SessionResponse,
} from "@longroll/shared";
import { api, ApiError } from "./api";
import { CursorStore } from "./cursors";

export type ConnectionStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "replaced"
  | "expired"
  | "unauthorized"
  | "left";

export interface RoomClientState {
  status: ConnectionStatus;
  room: RoomView | null;
  me: string | null;
  lastSeq: number;
  /** Percobaan reconnect berturut-turut (0 saat terhubung). */
  attempt: number;
  /** Selisih jam server − klien (ms), dari time.ping/pong. */
  clockOffsetMs: number;
}

export type RoomClientEvent = { type: RoomEvent["type"]; payload: RoomEvent["payload"]; atMs: number };

interface PendingIntent {
  type: string;
  payload: unknown;
  tries: number;
  resolve: (ack: AckPayload) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const ACK_TIMEOUT_MS = 5_000;
const MAX_INTENT_TRIES = 3;

/** Backoff 0.5 → 8 s dengan jitter (07 §10). */
export function backoffDelay(attempt: number, random = Math.random): number {
  const base = Math.min(RECONNECT.maxMs, RECONNECT.baseMs * 2 ** Math.max(0, attempt - 1));
  const jitter = 1 + (random() * 2 - 1) * RECONNECT.jitter;
  return Math.round(Math.min(RECONNECT.maxMs, base * jitter));
}

/** Terapkan event server ke RoomView (murni, mudah diuji). Event seq ≤ lastSeq diabaikan pemanggil. */
export function applyEvent(room: RoomView, event: Pick<S2C, "type" | "payload" | "seq" | "roomVersion">): RoomView {
  const next: RoomView = { ...room, participants: room.participants.slice() };
  const e = event as unknown as RoomEvent;
  switch (e.type) {
    case "participant.joined": {
      const p = e.payload.participant;
      const i = next.participants.findIndex((x) => x.participantId === p.participantId);
      if (i >= 0) next.participants[i] = p;
      else next.participants.push(p);
      break;
    }
    case "participant.left":
      next.participants = next.participants.map((p) =>
        p.participantId === e.payload.participantId ? { ...p, connection: "LEFT", ready: false } : p,
      );
      break;
    case "presence.update": {
      const { participantId, ...patch } = e.payload;
      next.participants = next.participants.map((p) =>
        p.participantId === participantId ? ({ ...p, ...patch } as ParticipantView) : p,
      );
      break;
    }
    case "room.status":
      next.status = e.payload.status;
      next.emptySinceMs = e.payload.emptySinceMs;
      break;
    case "room.expiring":
      if (e.payload.reason === "GRACE") next.status = "EXPIRING";
      break;
  }
  if (event.seq !== undefined) next.lastSeq = event.seq;
  if (event.roomVersion !== undefined) next.roomVersion = event.roomVersion;
  return next;
}

/**
 * Koneksi room klien (P02 §10 `room/socket.ts` + `room/store.ts`): satu WebSocket, store read-only dari
 * server, resume dengan lastSeq, reconnect backoff + jitter, intent ber-clientEventId dengan ack & retry,
 * heartbeat, dan pembaruan kredensial berkala (cookie HttpOnly dirotasi lewat POST /session).
 */
export class RoomClient {
  readonly cursors = new CursorStore();
  private state: RoomClientState = { status: "connecting", room: null, me: null, lastSeq: 0, attempt: 0, clockOffsetMs: 0 };
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: RoomClientEvent) => void>();
  private ws: WebSocket | null = null;
  private stopped = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private pending = new Map<string, PendingIntent>();
  private resumeRequested = false;
  private leaving = false;

  constructor(
    readonly code: string,
    private session: SessionResponse | null = null,
  ) {
    if (session) this.state = { ...this.state, me: session.participantId };
  }

  // ---------------------------------------------------------------- store
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.state;

  onEvent(fn: (e: RoomClientEvent) => void) {
    this.eventListeners.add(fn);
    return () => {
      this.eventListeners.delete(fn);
    };
  }

  private set(patch: Partial<RoomClientState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  // ---------------------------------------------------------------- siklus hidup
  start() {
    this.stopped = false;
    this.pruneTimer = setInterval(() => this.cursors.prune(), 1_000);
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.reconnectNow);
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    void this.connect();
  }

  stop() {
    this.stopped = true;
    this.clearTimers();
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.reconnectNow);
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    for (const p of this.pending.values()) if (p.timer) clearTimeout(p.timer);
    this.pending.clear();
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, "bye");
  }

  /** "Pakai di sini" setelah tab lain mengambil alih (DEC-083). */
  takeOver() {
    if (this.state.status !== "replaced") return;
    this.set({ status: "connecting", attempt: 0 });
    void this.connect();
  }

  private onVisibility = () => {
    if (document.visibilityState === "visible" && this.state.status === "reconnecting") this.reconnectNow();
  };

  private reconnectNow = () => {
    if (this.stopped || this.state.status !== "reconnecting") return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.connect();
  };

  private clearTimers() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.retryTimer = this.heartbeat = this.refreshTimer = null;
  }

  private terminal(status: Extract<ConnectionStatus, "replaced" | "expired" | "unauthorized" | "left">) {
    this.clearTimers();
    this.cursors.clear();
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, status);
    this.set({ status });
  }

  private scheduleRetry() {
    if (this.stopped) return;
    const attempt = this.state.attempt + 1;
    this.set({ status: this.state.room ? "reconnecting" : "connecting", attempt });
    this.retryTimer = setTimeout(() => void this.connect(), backoffDelay(attempt));
  }

  private async connect() {
    if (this.stopped) return;
    this.retryTimer = null;
    let session = this.session;
    this.session = null;
    if (!session) {
      try {
        session = await api.session(this.code);
      } catch (err) {
        if (this.stopped) return;
        if (err instanceof ApiError && (err.code === "AUTH_INVALID" || err.code === "AUTH_REQUIRED")) return this.terminal("unauthorized");
        if (err instanceof ApiError && (err.code === "ROOM_EXPIRED" || err.code === "ROOM_NOT_FOUND")) return this.terminal("expired");
        return this.scheduleRetry();
      }
    }
    if (this.stopped) return;
    this.set({ me: session.participantId });
    this.scheduleRefresh(session.credentialTtlSec);

    const url = new URL(session.wsUrl);
    url.searchParams.set("v", String(PROTOCOL_VERSION));
    if (this.state.room) url.searchParams.set("lastSeq", String(this.state.lastSeq));
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (ev) => {
      if (this.ws === ws) this.handle(JSON.parse(String(ev.data)) as S2C);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.onClose(ev.code);
    };
  }

  private onClose(code: number) {
    if (this.stopped) return;
    switch (code) {
      case WS_CLOSE.REPLACED:
        return this.terminal("replaced");
      case WS_CLOSE.LEFT:
        return this.terminal("left");
      case WS_CLOSE.EXPIRED:
        return this.terminal("expired");
      case WS_CLOSE.UPGRADE_REQUIRED:
        window.location.reload();
        return;
      default:
        // Termasuk AUTH_INVALID & upgrade 401: POST /session berikutnya yang memutuskan.
        this.cursors.clear();
        this.scheduleRetry();
    }
  }

  /** Perbarui kredensial sebelum habis (umur terbatas, bisa diperbarui) selama tab hidup. */
  private scheduleRefresh(ttlSec: number) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const ms = Math.max(30_000, (ttlSec * 1000) / 2);
    this.refreshTimer = setTimeout(async () => {
      try {
        const s = await api.session(this.code);
        this.scheduleRefresh(s.credentialTtlSec);
      } catch (err) {
        if (err instanceof ApiError && err.code === "AUTH_INVALID") this.terminal("unauthorized");
        else this.scheduleRefresh(60);
      }
    }, ms);
  }

  // ---------------------------------------------------------------- pesan masuk
  private handle(msg: S2C) {
    switch (msg.type) {
      case "auth.ok": {
        const p = msg.payload as AuthOkPayload;
        const room = p.room ?? this.state.room;
        this.set({
          status: "open",
          attempt: 0,
          me: p.participantId,
          room,
          lastSeq: p.room ? p.room.lastSeq : this.state.lastSeq,
          clockOffsetMs: p.serverTimeMs - Date.now(),
        });
        this.resumeRequested = false;
        this.startHeartbeat();
        for (const [id, intent] of this.pending) this.transmit(id, intent);
        return;
      }
      case "room.snapshot": {
        const { room } = msg.payload as { room: RoomView };
        this.resumeRequested = false;
        this.set({ room, lastSeq: room.lastSeq });
        return;
      }
      case "session.replaced":
        return this.terminal("replaced");
      case "room.expired":
        return this.terminal("expired");
      case "time.pong": {
        const { t1, ts } = msg.payload as { t1: number | null; ts: number };
        if (typeof t1 === "number") this.set({ clockOffsetMs: Math.round(ts - (t1 + Date.now()) / 2) });
        return;
      }
      case "cursor.move": {
        const c = msg.payload as CursorPayload & { participantId: string };
        this.cursors.upsert({ ...c, atMs: Date.now() });
        return;
      }
      case "ack": {
        const id = msg.replyTo;
        const p = id ? this.pending.get(id) : undefined;
        if (!p || !id) return;
        const ack = msg.payload as AckPayload;
        if (!ack.ok && ack.error === "SERVICE_UNAVAILABLE" && p.tries < MAX_INTENT_TRIES) {
          if (p.timer) clearTimeout(p.timer);
          p.timer = setTimeout(() => this.transmit(id, p), backoffDelay(p.tries));
          return;
        }
        if (p.timer) clearTimeout(p.timer);
        this.pending.delete(id);
        p.resolve(ack);
        return;
      }
    }
    if (msg.seq !== undefined) this.applySeq(msg);
  }

  private applySeq(msg: S2C) {
    const room = this.state.room;
    if (!room || msg.seq === undefined) return;
    if (msg.seq <= this.state.lastSeq) return; // duplikat (14 §13)
    if (msg.seq > this.state.lastSeq + 1) {
      // Lompatan seq: minta replay; event berikutnya ikut dikirim ulang server.
      if (!this.resumeRequested) {
        this.resumeRequested = true;
        this.ws?.send(JSON.stringify({ type: "room.resume", payload: { lastSeq: this.state.lastSeq } }));
      }
      return;
    }
    const next = applyEvent(room, msg);
    this.set({ room: next, lastSeq: msg.seq });
    const e = msg as unknown as RoomEvent;
    if (e.type === "participant.left") {
      this.cursors.remove(e.payload.participantId);
      if (e.payload.participantId === this.state.me) return this.terminal(this.leaving ? "left" : "unauthorized");
    }
    for (const fn of this.eventListeners) fn({ type: e.type, payload: e.payload, atMs: msg.atMs });
  }

  private startHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    const ping = () => this.ws?.readyState === WebSocket.OPEN && this.ws.send(JSON.stringify({ type: "time.ping", payload: { t1: Date.now() } }));
    ping();
    this.heartbeat = setInterval(ping, ROOM_DEFAULTS.heartbeatIntervalMs);
  }

  // ---------------------------------------------------------------- intent keluar
  private transmit(id: string, intent: PendingIntent) {
    if (intent.timer) clearTimeout(intent.timer);
    if (this.ws?.readyState !== WebSocket.OPEN) return; // dikirim ulang saat auth.ok berikutnya
    intent.tries += 1;
    this.ws.send(JSON.stringify({ type: intent.type, clientEventId: id, payload: intent.payload }));
    intent.timer = setTimeout(() => {
      if (intent.tries >= MAX_INTENT_TRIES) {
        this.pending.delete(id);
        intent.resolve({ ok: false, error: "SERVICE_UNAVAILABLE" });
      } else this.transmit(id, intent);
    }, ACK_TIMEOUT_MS);
  }

  /** Kirim intent dengan clientEventId; retry maks. 3× dengan id sama (14 §8.1). */
  sendIntent(type: string, payload: unknown): Promise<AckPayload> {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      const intent: PendingIntent = { type, payload, tries: 0, resolve, timer: null };
      this.pending.set(id, intent);
      this.transmit(id, intent);
    });
  }

  sendCursor(surface: CursorSurface, x: number, y: number) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "cursor.move", payload: { surface, x, y } }));
  }

  /** Keluar (F-18): HTTP agar server bisa menghapus cookie HttpOnly; token dicabut di server. */
  async leave(): Promise<void> {
    this.leaving = true;
    try {
      await api.leave(this.code);
    } catch (err) {
      this.leaving = false;
      throw err;
    }
    this.stop();
    this.set({ status: "left" });
  }
}
