import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import type { S2C } from "@longroll/shared";
import { createRealtimeApp } from "../../src/app";
import type { RealtimeApp } from "../../src/app";
import { loadConfig } from "../../src/config";
import { MemoryObjectStorage } from "../../src/storage/memory";
import type { RoomStore } from "../../src/store/types";
import { MemoryRoomStore } from "../../src/store/memory";

export const ORIGIN = "http://localhost:3000";

export interface TestServer {
  app: RealtimeApp;
  base: string;
  wsBase: string;
  store: RoomStore;
  storage: MemoryObjectStorage;
  close(): Promise<void>;
}

export async function startServer(env: Record<string, string> = {}, store: RoomStore = new MemoryRoomStore(), sharedStorage?: MemoryObjectStorage): Promise<TestServer> {
  const config = loadConfig({
    NODE_ENV: "test",
    ALLOWED_ORIGINS: ORIGIN,
    COOKIE_SECURE: "false",
    RATE_LIMIT_SALT: "test-salt",
    CLEANUP_RETRY_SECONDS: "1",
    ...env,
  });
  const storage = sharedStorage ?? new MemoryObjectStorage();
  const app = createRealtimeApp(config, store, storage);
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", () => r()));
  const { port } = app.server.address() as AddressInfo;
  storage.signer.publicBaseUrl = `http://127.0.0.1:${port}`;
  return {
    app,
    base: `http://127.0.0.1:${port}`,
    wsBase: `ws://127.0.0.1:${port}/ws`,
    store,
    storage,
    close: () => app.close(),
  };
}

/** "Browser" minimal: menyimpan cookie dari Set-Cookie dan mengirim Origin. */
export class Client {
  cookies = new Map<string, string>();
  constructor(
    private srv: TestServer,
    private readonly ip?: string,
  ) {}

  /** Arahkan klien ke instance server baru (simulasi restart; cookie dipertahankan seperti browser). */
  rebind(srv: TestServer) {
    this.srv = srv;
  }

  private cookieHeader() {
    return Array.from(this.cookies, ([k, v]) => `${k}=${v}`).join("; ");
  }

  private absorb(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const i = pair!.indexOf("=");
      const k = pair!.slice(0, i);
      const v = pair!.slice(i + 1);
      if (/Max-Age=0/i.test(line) || v === "") this.cookies.delete(k);
      else this.cookies.set(k, v);
    }
  }

  async request(method: string, path: string, body?: unknown, opts: { origin?: string | null } = {}) {
    const headers: Record<string, string> = {};
    if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN;
    if (this.cookies.size) headers.Cookie = this.cookieHeader();
    if (this.ip) headers["X-Forwarded-For"] = this.ip;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(this.srv.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    this.absorb(res);
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null, res };
  }

  create(name: string) {
    return this.request("POST", "/api/rooms", { displayName: name });
  }
  join(code: string, name: string) {
    return this.request("POST", `/api/rooms/${code}/join`, { displayName: name });
  }

  /** Buka WS dengan cookie & Origin; resolve setelah auth.ok. */
  connect(code: string, lastSeq?: number): Promise<Socket> {
    const qs = new URLSearchParams({ code, v: "1" });
    if (lastSeq !== undefined) qs.set("lastSeq", String(lastSeq));
    const ws = new WebSocket(`${this.srv.wsBase}?${qs}`, { headers: { Origin: ORIGIN, Cookie: this.cookieHeader() } });
    const sock = new Socket(ws);
    return new Promise((resolve, reject) => {
      ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.once("error", reject);
      sock.waitFor("auth.ok").then(() => resolve(sock), reject);
    });
  }
}

export class Socket {
  messages: S2C[] = [];
  closeCode: number | null = null;
  private waiters: { pred: (m: S2C) => boolean; resolve: (m: S2C) => void }[] = [];

  constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => {
      const m = JSON.parse(String(data)) as S2C;
      this.messages.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
    ws.on("close", (code) => (this.closeCode = code));
  }

  waitFor(type: string, pred: (m: S2C) => boolean = () => true, timeoutMs = 5_000): Promise<S2C> {
    const existing = this.messages.find((m) => m.type === type && pred(m));
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout menunggu ${type}`)), timeoutMs);
      this.waiters.push({
        pred: (m) => m.type === type && pred(m),
        resolve: (m) => {
          clearTimeout(t);
          resolve(m);
        },
      });
    });
  }

  waitClose(timeoutMs = 5_000): Promise<number> {
    if (this.closeCode !== null) return Promise.resolve(this.closeCode);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout menunggu close")), timeoutMs);
      this.ws.once("close", (code) => {
        clearTimeout(t);
        resolve(code);
      });
    });
  }

  send(type: string, payload: unknown = {}, clientEventId?: string) {
    this.ws.send(JSON.stringify({ type, payload, clientEventId }));
  }

  close() {
    this.ws.close();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
