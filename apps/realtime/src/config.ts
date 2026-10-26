import { randomBytes } from "node:crypto";
import { ROOM_DEFAULTS } from "@longroll/shared";

export interface ServerConfig {
  port: number;
  isProduction: boolean;
  allowedOrigins: string[];
  /** URL WebSocket publik yang dikirim ke klien (tanpa query). */
  publicWsUrl: string;
  /** Connection string PostgreSQL (Neon, `sslmode=verify-full`). Rahasia: jangan dicatat/di-commit. */
  databaseUrl: string | null;
  database: { poolMax: number; statementTimeoutMs: number };
  /** Izinkan store memori di produksi (TIDAK disarankan; tidak tahan restart). */
  allowMemoryStore: boolean;
  storageLocalDir: string | null;
  cookie: { secure: boolean; domain: string | null };
  room: {
    graceSeconds: number;
    holdSeconds: number;
    /** DEC-052 OPEN: null = nonaktif (default). */
    maxLifetimeHours: number | null;
    connectDeadlineMs: number;
    heartbeatIntervalMs: number;
    heartbeatMissedLimit: number;
  };
  credential: { ttlSeconds: number; rotationGraceMs: number };
  rateLimitSalt: string;
  trustProxy: boolean;
  cleanupRetrySeconds: number[];
  sweepIntervalMs: number;
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Konfigurasi angka tidak valid: "${value}"`);
  return n;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = num(env.PORT, 4000);
  const isProduction = env.NODE_ENV === "production";
  const maxLifetimeRaw = env.ROOM_MAX_LIFETIME_HOURS?.trim();
  return {
    port,
    isProduction,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "http://localhost:3000")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    publicWsUrl: env.PUBLIC_WS_URL?.trim() || `ws://localhost:${port}/ws`,
    databaseUrl: env.DATABASE_URL?.trim() || null,
    database: {
      poolMax: num(env.DATABASE_POOL_MAX, 5),
      statementTimeoutMs: num(env.DATABASE_STATEMENT_TIMEOUT_MS, 5_000),
    },
    allowMemoryStore: bool(env.ALLOW_MEMORY_STORE, false),
    storageLocalDir: env.STORAGE_LOCAL_DIR?.trim() || null,
    cookie: {
      // Default Secure. Chrome/Firefox menerima cookie Secure di http://localhost.
      secure: bool(env.COOKIE_SECURE, true),
      domain: env.COOKIE_DOMAIN?.trim() || null,
    },
    room: {
      graceSeconds: num(env.ROOM_GRACE_PERIOD_SECONDS, ROOM_DEFAULTS.graceSeconds),
      holdSeconds: num(env.PARTICIPANT_HOLD_SECONDS, ROOM_DEFAULTS.holdSeconds),
      maxLifetimeHours: maxLifetimeRaw ? num(maxLifetimeRaw, 0) || null : ROOM_DEFAULTS.maxLifetimeHours,
      connectDeadlineMs: ROOM_DEFAULTS.connectDeadlineMs,
      heartbeatIntervalMs: ROOM_DEFAULTS.heartbeatIntervalMs,
      heartbeatMissedLimit: ROOM_DEFAULTS.heartbeatMissedLimit,
    },
    credential: {
      ttlSeconds: num(env.CREDENTIAL_TTL_SECONDS, ROOM_DEFAULTS.credentialTtlSeconds),
      rotationGraceMs: ROOM_DEFAULTS.credentialRotationGraceMs,
    },
    // Salt acak per proses bila tidak diset: hash IP berganti saat restart (rotasi alami).
    rateLimitSalt: env.RATE_LIMIT_SALT?.trim() || randomBytes(32).toString("base64url"),
    trustProxy: bool(env.TRUST_PROXY, false),
    cleanupRetrySeconds: (env.CLEANUP_RETRY_SECONDS ?? "60,300,900,3600")
      .split(",")
      .map((s) => num(s, 60)),
    sweepIntervalMs: num(env.SWEEP_INTERVAL_SECONDS, 60) * 1000,
  };
}
