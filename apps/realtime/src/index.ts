import { createRealtimeApp } from "./app";
import { loadConfig } from "./config";
import { log } from "./log";
import { FsObjectStorage } from "./storage/fs";
import { MemoryObjectStorage } from "./storage/memory";
import { S3ObjectStorage } from "./storage/s3";
import { LocalUrlSigner } from "./storage/signer";
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
  if (config.s3) {
    const s3 = config.s3;
    if (!s3.bucket || !s3.accessKeyId || !s3.secretAccessKey) {
      log.error("config.s3_incomplete", { hint: "S3_ENDPOINT diset tapi S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY kosong." });
      process.exit(1);
    }
    return new S3ObjectStorage(s3);
  }
  if (config.isProduction && !config.allowMemoryStore) {
    // Storage lokal tidak tahan multi-instance & disk ephemeral: produksi wajib S3-compatible.
    log.error("config.storage_required", { hint: "Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY." });
    process.exit(1);
  }
  const signer = new LocalUrlSigner(config.publicHttpUrl, config.storageSigningSecret);
  if (config.storageLocalDir) return new FsObjectStorage(config.storageLocalDir, signer);
  log.warn("storage.memory", { hint: "STORAGE_LOCAL_DIR & S3_ENDPOINT kosong: frame custom disimpan di memori proses (dev saja)." });
  return new MemoryObjectStorage(signer);
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
