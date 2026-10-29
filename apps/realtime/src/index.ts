import { createRealtimeApp } from "./app";
import { loadConfig } from "./config";
import { evaluateAlarms } from "./guard/alarms";
import { errText, log, metrics } from "./log";
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

if (config.isProduction && config.trustProxy === 0) {
  log.warn("config.trust_proxy_off", { hint: "TRUST_PROXY=0: di belakang proxy/CDN semua klien akan berbagi satu batas IP. Set TRUST_PROXY=<jumlah proxy tepercaya>." });
}

const store = pickStore();
const storage = pickStorage();
const app = createRealtimeApp(config, store, storage);
let metricsTimer: ReturnType<typeof setInterval> | null = null;

async function start() {
  if (store instanceof PostgresRoomStore) {
    // Service TIDAK pernah menjalankan migrasi. Skema harus diterapkan manual (db/migrations).
    // Pemanasan: compute Neon yang di-suspend butuh beberapa detik untuk bangun; coba beberapa kali sebelum menyerah.
    let reachable = false;
    for (let i = 0; i < 5 && !reachable; i++) {
      reachable = await store.ping();
      if (!reachable) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
    if (!reachable) {
      log.warn("store.unreachable", { kind: store.kind, hint: "Database belum bisa dihubungi; request akan dibalas SERVICE_UNAVAILABLE." });
    } else if (!(await store.hasSchema())) {
      log.error("store.schema_missing", { required: REQUIRED_SCHEMA_VERSION, hint: "Jalankan db/migrations secara manual, lalu start ulang." });
      await store.close();
      process.exit(1);
    }
  }
  const recoverStarted = Date.now();
  try {
    const recovered = await app.manager.recover();
    if (recovered) log.info("rooms.recovered", { count: recovered, ms: Date.now() - recoverStarted });
  } catch {
    log.warn("rooms.recover_skipped", { reason: "store unavailable" });
  }
  app.manager.startSweeper(config.sweepIntervalMs, config.orphanSweepIntervalMs);
  if (config.metricsIntervalMs > 0) {
    let prev = metrics.snapshot();
    metricsTimer = setInterval(() => {
      const cur = metrics.snapshot();
      log.info("metrics", cur);
      for (const alarm of evaluateAlarms(prev, cur)) log.error(alarm.name, alarm.detail);
      prev = cur;
    }, config.metricsIntervalMs);
    metricsTimer.unref?.();
  }
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

let shuttingDown = false;
/**
 * Shutdown rapi (SIGTERM saat deploy/restart): berhenti menerima koneksi, TULIS snapshot editor yang belum
 * tersimpan (maks. 5 detik perubahan terakhir), lalu tutup pool. Batas 10 detik supaya tidak menggantung.
 */
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (metricsTimer) clearInterval(metricsTimer);
  const hard = setTimeout(() => process.exit(code || 1), 10_000);
  hard.unref?.();
  try {
    await app.manager.flushAll();
    await app.close();
    await store.close();
  } catch (err) {
    log.error("shutdown.failed", { message: errText(err) });
  }
  process.exit(code);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
// Kegagalan tak tertangani tidak boleh membunuh semua room secara diam-diam: catat (tersamar) lalu matikan rapi
// supaya supervisor me-restart dan room dipulihkan dari snapshot (DEC-088).
process.on("unhandledRejection", (reason) => {
  metrics.inc("unhandled_rejection_total");
  log.error("process.unhandled_rejection", { message: errText(reason) });
});
process.on("uncaughtException", (err) => {
  log.error("process.uncaught_exception", { message: errText(err) });
  void shutdown(1);
});

void start();
