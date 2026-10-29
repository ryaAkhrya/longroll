import { createServer } from "node:http";
import type { Server } from "node:http";
import type { ServerConfig } from "./config";
import { FrameService } from "./frames/service";
import { createApiHandler } from "./http/api";
import { RateLimiter } from "./http/rateLimit";
import { log } from "./log";
import { RoomManager } from "./room/RoomManager";
import type { ObjectStorage } from "./storage/types";
import type { RoomStore } from "./store/types";
import { createGateway } from "./ws/gateway";

export interface RealtimeApp {
  server: Server;
  manager: RoomManager;
  close(): Promise<void>;
}

/** Rakit service realtime dari konfigurasi + adapter (dipakai index.ts dan tes integrasi). */
export function createRealtimeApp(config: ServerConfig, store: RoomStore, storage: ObjectStorage): RealtimeApp {
  const manager = new RoomManager(store, storage, {
    graceSeconds: config.room.graceSeconds,
    holdSeconds: config.room.holdSeconds,
    maxLifetimeHours: config.room.maxLifetimeHours,
    connectDeadlineMs: config.room.connectDeadlineMs,
    credentialTtlSeconds: config.credential.ttlSeconds,
    credentialRotationGraceMs: config.credential.rotationGraceMs,
    cleanupRetrySeconds: config.cleanupRetrySeconds,
    maxActiveRooms: config.maxActiveRooms,
  });
  const frames = new FrameService(storage, store);
  manager.onSweep((actor) => frames.sweep(actor));
  manager.onSweep((actor) => actor.purgeRejected());
  const limiter = new RateLimiter(store, config.rateLimitSalt);
  const api = createApiHandler({ config, manager, store, storage, frames, limiter });
  const gateway = createGateway(config, manager, limiter);

  // Batas koneksi: header lambat / body lambat (slowloris) diputus; ukuran header dibatasi. Upload foto ≤ 10 MB di HP lambat tetap muat.
  const server = createServer({ maxHeaderSize: 16 * 1024, headersTimeout: 15_000, requestTimeout: 120_000, keepAliveTimeout: 5_000 }, (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    if (config.isProduction) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    void api(req, res).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "BAD_REQUEST" }));
      }
    });
  });
  server.on("upgrade", gateway.handleUpgrade);
  server.on("clientError", (_err, socket) => socket.destroy());

  return {
    server,
    manager,
    async close() {
      gateway.close();
      manager.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      log.info("server.closed");
    },
  };
}
