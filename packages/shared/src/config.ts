/**
 * Konfigurasi terpusat. Nilai PROPOSED (18): jangan tersebar sebagai angka di komponen.
 * Menurunkan technical safeguard butuh persetujuan pemilik produk.
 */
export const LIMITS = {
  /** DEC-003 (CONFIRMED) */
  maxParticipants: 4,
  /** DEC-043 (PROPOSED) */
  displayNameMax: 20,
  /** DEC-042 (PROPOSED, technical safeguard) */
  maxShots: 8,
  /** DEC-053 (PROPOSED, technical safeguard) */
  maxSessionsPerRoom: 20,
} as const;

/** DEC-020 (OPEN, default PROPOSED). Server membaca env ROOM_GRACE_PERIOD_SECONDS; nilai ini hanya default. */
export const DEFAULT_ROOM_GRACE_PERIOD_SECONDS = 120;

/**
 * Default room & presence (07, 14, DEC-021/067/071/083). Server boleh menimpa lewat env;
 * klien menerima nilai efektif dari server (RoomView.config), bukan dari konstanta ini.
 */
export const ROOM_DEFAULTS = {
  /** DEC-020 */
  graceSeconds: DEFAULT_ROOM_GRACE_PERIOD_SECONDS,
  /** DEC-021: hold slot peserta yang putus */
  holdSeconds: 60,
  /** DEC-052 (OPEN): null = tanpa batas umur room */
  maxLifetimeHours: null as number | null,
  /** 07 §7.1: ping tiap 10 s, RECONNECTING setelah 2 heartbeat terlewat */
  heartbeatIntervalMs: 10_000,
  heartbeatMissedLimit: 2,
  /** Peserta yang join via HTTP tapi tidak pernah membuka WebSocket */
  connectDeadlineMs: 15_000,
  /** 14 §13 */
  eventBufferSize: 500,
  /** 14 §8.1 */
  idempotencyCacheSize: 200,
  /** Tombstone kode (DEC-084) */
  tombstoneSeconds: 24 * 60 * 60,
  /** Kredensial peserta: umur terbatas, diperbarui (rotasi) saat sesi disegarkan */
  credentialTtlSeconds: 12 * 60 * 60,
  /** Token lama tetap diterima sebentar setelah rotasi (race multi-tab) */
  credentialRotationGraceMs: 60_000,
} as const;

/** DEC-067 (PROPOSED): rate limit per hash IP. */
export const RATE_LIMITS = {
  create: { max: 10, windowSeconds: 60 * 60 },
  join: { max: 30, windowSeconds: 10 * 60 },
  wrongCode: { max: 20, windowSeconds: 10 * 60 },
  preview: { max: 120, windowSeconds: 10 * 60 },
  wsEventsPerSecond: 60,
  wsConnectionsPerIp: 20,
} as const;

/** 14 §8.2 */
export const WS_MAX_MESSAGE_BYTES = 64 * 1024;

/** 07 §8, DEC-071: kursor volatile. */
export const CURSOR = {
  sendIntervalMs: 50,
  minDeltaPx: 2,
  interpolateMs: 100,
  hideAfterMs: 5_000,
} as const;

/** 07 §10: backoff reconnect klien. */
export const RECONNECT = {
  baseMs: 500,
  maxMs: 8_000,
  /** Fraksi jitter (±) */
  jitter: 0.3,
} as const;

/** DEC-022 (PROPOSED): 32 karakter tanpa yang ambigu (0/O, 1/I). */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;
