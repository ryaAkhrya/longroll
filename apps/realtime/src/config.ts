import { randomBytes } from "node:crypto";
import { ROOM_DEFAULTS } from "@longroll/shared";

export interface ServerConfig {
  port: number;
  /** Alamat bind. Kosong = bawaan Node (dual-stack `::`, menerima IPv4 & IPv6 — cocok untuk Railway/Fly). */
  host: string | null;
  isProduction: boolean;
  allowedOrigins: string[];
  /** URL WebSocket publik yang dikirim ke klien (tanpa query). */
  publicWsUrl: string;
  /** Origin HTTP publik service realtime (URL bertanda tangan storage lokal). */
  publicHttpUrl: string;
  /** Connection string PostgreSQL (Neon, `sslmode=verify-full`). Rahasia: jangan dicatat/di-commit. */
  databaseUrl: string | null;
  database: { poolMax: number; statementTimeoutMs: number };
  /** Izinkan store memori di produksi (TIDAK disarankan; tidak tahan restart). */
  allowMemoryStore: boolean;
  storageLocalDir: string | null;
  /** Rahasia HMAC URL storage lokal. Kosong = acak per proses. */
  storageSigningSecret: string | null;
  /**
   * Object storage S3-compatible (Neon Object Storage / R2 / MinIO). Semua field wajib bila dipakai.
   * Rahasia: jangan dicatat / di-commit.
   */
  s3: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean } | null;
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
  /**
   * ICE (DEC-073 OPEN, provider-neutral). STUN saja bila TURN tidak dikonfigurasi.
   * TURN memakai skema REST "use-auth-secret" (coturn & banyak penyedia terkelola):
   * username = `expiry:participantId`, credential = base64(HMAC-SHA1(secret, username)).
   */
  ice: { stunUrls: string[]; turnUrls: string[]; turnSharedSecret: string | null; turnTtlSeconds: number };
  rateLimitSalt: string;
  /** Jumlah proxy tepercaya di depan service (0 = tidak ada; XFF diabaikan). Hanya entri XFF ke-N dari KANAN yang dipercaya. */
  trustProxy: number;
  cleanupRetrySeconds: number[];
  sweepIntervalMs: number;
  /** Batas room aktif di memori satu instance (pengaman memori; di atasnya create → SERVICE_UNAVAILABLE). */
  maxActiveRooms: number;
  /** Sweeper objek yatim (15 §8.3): interval; 0 = nonaktif. */
  orphanSweepIntervalMs: number;
  /** Ekspor snapshot metrik ke log; 0 = nonaktif. */
  metricsIntervalMs: number;
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Konfigurasi angka tidak valid: "${value}"`);
  return n;
}

/** Kosong = default; "none" = daftar kosong (mis. menonaktifkan STUN). */
function list(value: string | undefined, fallback: string): string[] {
  if (value?.trim().toLowerCase() === "none") return [];
  return (value === undefined || value.trim() === "" ? fallback : value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

/** TRUST_PROXY: "true"/"1" = 1 proxy tepercaya; angka N = N proxy; kosong/false = 0. */
function proxyHops(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 0;
  const v = value.trim().toLowerCase();
  if (v === "false" || v === "0") return 0;
  if (v === "true") return 1;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 5) throw new Error(`TRUST_PROXY tidak valid: "${value}"`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = num(env.PORT, 4000);
  const isProduction = env.NODE_ENV === "production";
  const maxLifetimeRaw = env.ROOM_MAX_LIFETIME_HOURS?.trim();
  const publicWsUrl = env.PUBLIC_WS_URL?.trim() || `ws://localhost:${port}/ws`;
  const s3Endpoint = env.S3_ENDPOINT?.trim();
  return {
    port,
    host: env.HOST?.trim() || null,
    isProduction,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "http://localhost:3000")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
    publicWsUrl,
    publicHttpUrl: env.PUBLIC_HTTP_URL?.trim() || publicWsUrl.replace(/^ws/, "http").replace(/\/ws$/, ""),
    databaseUrl: env.DATABASE_URL?.trim() || null,
    database: {
      poolMax: num(env.DATABASE_POOL_MAX, 5),
      statementTimeoutMs: num(env.DATABASE_STATEMENT_TIMEOUT_MS, 5_000),
    },
    allowMemoryStore: bool(env.ALLOW_MEMORY_STORE, false),
    storageLocalDir: env.STORAGE_LOCAL_DIR?.trim() || null,
    storageSigningSecret: env.STORAGE_SIGNING_SECRET?.trim() || null,
    s3: s3Endpoint
      ? {
          endpoint: s3Endpoint,
          region: env.S3_REGION?.trim() || "auto",
          bucket: env.S3_BUCKET?.trim() || "",
          accessKeyId: env.S3_ACCESS_KEY_ID?.trim() || "",
          secretAccessKey: env.S3_SECRET_ACCESS_KEY?.trim() || "",
          forcePathStyle: bool(env.S3_FORCE_PATH_STYLE, true),
        }
      : null,
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
    ice: {
      stunUrls: list(env.STUN_URLS, "stun:stun.l.google.com:19302"),
      turnUrls: list(env.TURN_URLS, ""),
      turnSharedSecret: env.TURN_SHARED_SECRET?.trim() || null,
      turnTtlSeconds: num(env.TURN_TTL_SECONDS, 3600),
    },
    // Salt acak per proses bila tidak diset: hash IP berganti saat restart (rotasi alami).
    rateLimitSalt: env.RATE_LIMIT_SALT?.trim() || randomBytes(32).toString("base64url"),
    trustProxy: proxyHops(env.TRUST_PROXY),
    cleanupRetrySeconds: (env.CLEANUP_RETRY_SECONDS ?? "60,300,900,3600")
      .split(",")
      .map((s) => num(s, 60)),
    sweepIntervalMs: num(env.SWEEP_INTERVAL_SECONDS, 60) * 1000,
    maxActiveRooms: num(env.MAX_ACTIVE_ROOMS, 500),
    orphanSweepIntervalMs: num(env.ORPHAN_SWEEP_INTERVAL_SECONDS, 24 * 60 * 60) * 1000,
    metricsIntervalMs: num(env.METRICS_INTERVAL_SECONDS, 300) * 1000,
  };
}
