/**
 * Uji beban WebSocket (TC-PERF-030, P09): N room sintetis × 4 peserta, tanpa media. Server dijalankan di proses yang
 * sama (store memori atau Neon `development`), klien sintetis membuka WS sungguhan dan mengirim kursor 20 Hz
 * (DEC-071) + intent bertulis (`presence.set`) berfrekuensi rendah. Mengukur latensi relay kursor (antar-peserta
 * satu room) dan latensi ack intent, serta memori proses.
 *
 * Pakai:  npm run load:ws -w @longroll/realtime -- --rooms=25 --seconds=20
 *         LONGROLL_TEST_DATABASE_URL=... npm run load:ws -w @longroll/realtime -- --store=postgres --rooms=5
 *
 * Pengaman: store memori maks. 100 room (pengaman global create 120/menit); store Postgres (Neon Free) maks. 10 room dan 0,2 intent/detik/peserta.
 * Hanya room yang dibuat skrip ini yang dibersihkan. Hasil bersifat indikatif: klien & server berbagi CPU/clock.
 */
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { createRealtimeApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createPgDb } from "../src/store/db";
import { MemoryObjectStorage } from "../src/storage/memory";
import { MemoryRoomStore } from "../src/store/memory";
import { PostgresRoomStore } from "../src/store/postgres";
import type { RoomStore } from "../src/store/types";

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const kind = arg("store", "memory") as "memory" | "postgres";
const maxRooms = kind === "postgres" ? 10 : 100; // 100 = batas pengaman global pembuatan room (120/menit)
const rooms = Math.min(maxRooms, Math.max(1, Number(arg("rooms", "10"))));
const seconds = Math.min(120, Math.max(5, Number(arg("seconds", "20"))));
const PEERS = 4;
const CURSOR_HZ = 20;
const INTENT_EVERY_MS = kind === "postgres" ? 5_000 : 1_000;
const ORIGIN = "http://localhost:3000";

const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]! : null);

interface Peer {
  ws: WebSocket;
  room: number;
  index: number;
}

async function main() {
  let store: RoomStore;
  if (kind === "postgres") {
    const url = process.env.LONGROLL_TEST_DATABASE_URL;
    if (!url) throw new Error("LONGROLL_TEST_DATABASE_URL belum diset (store=postgres)");
    store = new PostgresRoomStore(createPgDb(url, { poolMax: 5, statementTimeoutMs: 8_000 }));
  } else store = new MemoryRoomStore();

  const config = loadConfig({
    NODE_ENV: "production",
    ALLOW_MEMORY_STORE: "1",
    ALLOWED_ORIGINS: ORIGIN,
    COOKIE_SECURE: "false",
    TRUST_PROXY: "true",
    RATE_LIMIT_SALT: "load-test",
    ROOM_GRACE_PERIOD_SECONDS: "2",
    PARTICIPANT_HOLD_SECONDS: "2",
    CLEANUP_RETRY_SECONDS: "1",
    MAX_ACTIVE_ROOMS: "1000",
    METRICS_INTERVAL_SECONDS: "0",
  });
  const app = createRealtimeApp(config, store, new MemoryObjectStorage());
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", () => r()));
  const port = (app.server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;
  const created: { roomId: string; code: string }[] = [];
  const peers: Peer[] = [];
  const relay: number[] = [];
  const ack: number[] = [];
  let sent = 0;
  let received = 0;
  let unexpectedClose = 0;
  let acksFailed = 0;
  const cookieOf = (res: Response) => res.headers.getSetCookie().map((l) => l.split(";")[0]!).join("; ");
  const post = async (path: string, ip: string, body: unknown, cookie?: string) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "X-Forwarded-For": ip, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });

  console.log(`[load] store=${kind} rooms=${rooms} peers/room=${PEERS} seconds=${seconds} cursor=${CURSOR_HZ}Hz`);
  const setupStart = Date.now();
  for (let r = 0; r < rooms; r++) {
    const cookies: string[] = [];
    const ip = (n: number) => `10.${r % 250}.${Math.floor(r / 250)}.${n + 1}`;
    const first = await post("/api/rooms", ip(0), { displayName: `L${r}a` });
    if (first.status !== 201) throw new Error(`create gagal: ${first.status}`);
    const body = (await first.json()) as { roomCode: string; roomId: string };
    created.push({ roomId: body.roomId, code: body.roomCode });
    cookies.push(cookieOf(first));
    for (let p = 1; p < PEERS; p++) {
      const j = await post(`/api/rooms/${body.roomCode}/join`, ip(p), { displayName: `L${r}${"bcd"[p - 1]}` });
      if (j.status !== 200) throw new Error(`join gagal: ${j.status}`);
      cookies.push(cookieOf(j));
    }
    await Promise.all(
      cookies.map(
        (cookie, p) =>
          new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?code=${body.roomCode}&v=1`, { headers: { Origin: ORIGIN, Cookie: cookie, "X-Forwarded-For": ip(p) } });
            const peer: Peer = { ws, room: r, index: p };
            const pending = new Map<string, number>();
            (ws as unknown as { pending: Map<string, number> }).pending = pending;
            ws.on("message", (raw) => {
              const m = JSON.parse(String(raw)) as { type: string; payload?: { label?: string; ok?: boolean }; replyTo?: string };
              if (m.type === "auth.ok") resolve();
              else if (m.type === "cursor.move" && m.payload?.label) {
                received++;
                relay.push(Date.now() - Number(m.payload.label));
              } else if (m.type === "ack" && m.replyTo && pending.has(m.replyTo)) {
                ack.push(Date.now() - pending.get(m.replyTo)!);
                pending.delete(m.replyTo);
                if (m.payload?.ok === false) acksFailed++;
              }
            });
            ws.on("close", () => {
              if (!closing) unexpectedClose++;
            });
            ws.on("error", reject);
            peers.push(peer);
          }),
      ),
    );
  }
  let closing = false;
  console.log(`[load] ${rooms * PEERS} koneksi siap dalam ${Date.now() - setupStart} ms`);

  const heap0 = process.memoryUsage();
  const timers: ReturnType<typeof setInterval>[] = [];
  let n = 0;
  for (const peer of peers) {
    timers.push(
      setInterval(() => {
        if (peer.ws.readyState !== WebSocket.OPEN) return;
        peer.ws.send(JSON.stringify({ type: "cursor.move", payload: { surface: "lobby", x: Math.random(), y: Math.random(), label: String(Date.now()) } }));
        sent += PEERS - 1;
      }, 1000 / CURSOR_HZ),
    );
    timers.push(
      setInterval(() => {
        if (peer.ws.readyState !== WebSocket.OPEN) return;
        const id = `e${++n}`;
        (peer.ws as unknown as { pending: Map<string, number> }).pending.set(id, Date.now());
        peer.ws.send(JSON.stringify({ type: "presence.set", payload: { ready: n % 2 === 0 }, clientEventId: id }));
      }, INTENT_EVERY_MS + peer.index * 37),
    );
  }
  await new Promise((r) => setTimeout(r, seconds * 1000));
  for (const t of timers) clearInterval(t);
  await new Promise((r) => setTimeout(r, 1500)); // biarkan relay terakhir tiba
  const mem = process.memoryUsage();

  const result = {
    store: kind,
    rooms,
    connections: peers.length,
    seconds,
    cursorSentPerSec: Math.round(sent / seconds),
    cursorDeliveredPct: sent ? Math.round((received / sent) * 1000) / 10 : null,
    relayLatencyMs: { p50: pct(relay, 50), p95: pct(relay, 95), p99: pct(relay, 99) },
    ackLatencyMs: { count: ack.length, p50: pct(ack, 50), p95: pct(ack, 95), p99: pct(ack, 99) },
    acksFailed,
    unexpectedClose,
    heapMB: { start: Math.round(heap0.heapUsed / 1048576), end: Math.round(mem.heapUsed / 1048576) },
    rssMB: Math.round(mem.rss / 1048576),
    note: "klien & server berbagi proses/CPU/clock; tanpa jaringan nyata",
  };
  console.log(`[load] RESULT ${JSON.stringify(result)}`);

  // Bersih-bersih: hanya room buatan skrip ini.
  closing = true;
  for (const p of peers) p.ws.close();
  await new Promise((r) => setTimeout(r, 6_000)); // hold 2 dtk → LEFT → grace 2 dtk → cleanup
  for (const c of created) {
    if ((await store.countRoomData(c.roomId).catch(() => 0)) > 0) await store.finalizeExpiredRoom(c.roomId, c.code, 1).catch(() => undefined);
  }
  await app.close();
  await store.close();
  const failed = unexpectedClose > 0 || acksFailed > 0 || (result.relayLatencyMs.p95 ?? 0) > 150;
  console.log(`[load] ${failed ? "GAGAL" : "OK"} (kriteria: tanpa putus tak terduga, tanpa ack gagal, relay p95 ≤ 150 ms)`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("[load] error:", err instanceof Error ? err.message : err);
  process.exit(2);
});
