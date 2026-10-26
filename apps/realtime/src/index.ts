import { createRealtimeApp } from "./app";
import { loadConfig } from "./config";
import { log } from "./log";
import { FsObjectStorage } from "./storage/fs";
import { MemoryObjectStorage } from "./storage/memory";
import type { ObjectStorage } from "./storage/types";
import { createPgDb } from "./store/db";
import { MemoryRoomStore } from "./store/memory";
import { PostgresRoomStore, REQUIRED_SCHEMA_VERSION } from "./store/postgres";
import type { RoomStore } from "./store/types";

const config = loadConfig();

function pickStore(): RoomStore {
  if (config.databaseUrl) return new PostgresRoomStore(createPgDb(config.databaseUrl, config.database));
  if (config.isProduction && !config.allowMemoryStore) {
    log.error("config.database_required", { hint: "Set DATABASE_URL. Store memori tidak tahan restart." });
    process.exit(1);
  }
  log.warn("store.memory", { hint: "DATABASE_URL kosong: state room hanya di memori proses dan hilang saat restart (dev saja)." });
  return new MemoryRoomStore();
}

function pickStorage(): ObjectStorage {
  if (config.storageLocalDir) return new FsObjectStorage(config.storageLocalDir);
  log.warn("storage.memory", { hint: "STORAGE_LOCAL_DIR kosong: object storage di memori (P02 belum mengunggah apa pun)." });
  return new MemoryObjectStorage();
}

const store = pickStore();
const storage = pickStorage();
const app = createRealtimeApp(config, store, storage);

async function start() {
  if (store instanceof PostgresRoomStore) {
    // Service TIDAK pernah menjalankan migrasi. Skema harus diterapkan manual (db/migrations).
    if (!(await store.ping())) {
      log.warn("store.unreachable", { kind: store.kind, hint: "Database belum bisa dihubungi; request akan dibalas SERVICE_UNAVAILABLE." });
    } else if (!(await store.hasSchema())) {
      log.error("store.schema_missing", { required: REQUIRED_SCHEMA_VERSION, hint: "Jalankan db/migrations secara manual, lalu start ulang." });
      await store.close();
      process.exit(1);
    }
  }
  try {
    const recovered = await app.manager.recover();
    if (recovered) log.info("rooms.recovered", { count: recovered });
  } catch {
    log.warn("rooms.recover_skipped", { reason: "store unavailable" });
  }
  app.manager.startSweeper(config.sweepIntervalMs);
  app.server.listen(config.port, () => {
    log.info("server.listening", {
      port: config.port,
      store: store.kind,
      storage: storage.kind,
      graceSeconds: config.room.graceSeconds,
      holdSeconds: config.room.holdSeconds,
      maxLifetimeHours: config.room.maxLifetimeHours,
    });
  });
}

async function shutdown() {
  await app.close();
  await store.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

void start();
