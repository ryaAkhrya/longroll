import pg from "pg";
import { log, metrics } from "../log";

export interface QueryResultLike<R> {
  rows: R[];
  rowCount: number | null;
}

/** Permukaan query minimal; memudahkan adapter diuji dengan fake tanpa database. */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResultLike<R>>;
}

export interface Db extends Queryable {
  /** BEGIN … COMMIT; ROLLBACK bila fn melempar. Koneksi yang rusak dibuang dari pool. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface PgOptions {
  poolMax: number;
  statementTimeoutMs: number;
  /** Batas menunggu koneksi baru (cold start compute Neon yang di-suspend bisa beberapa detik). Default 8000. */
  connectTimeoutMs?: number;
  /** Antrean menunggu koneksi maksimum; di atasnya langsung ditolak (gagal cepat) alih-alih menumpuk tanpa batas. Default 4 × poolMax. */
  maxWaiting?: number;
}

/**
 * Gagal SEBELUM statement terkirim (pool tak berhasil membuka koneksi): aman diulang untuk statement apa pun,
 * termasuk tulis. Ini yang terjadi saat compute Neon baru bangun dari suspend.
 */
export function isConnectPhaseError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  if (e.code && ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "57P03"].includes(e.code)) return true;
  return /timeout exceeded when trying to connect/i.test(e.message ?? "");
}

const CONNECT_RETRIES = 2;
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Error transien koneksi (cold start Neon / compute di-suspend / koneksi diputus pooler). Aman diulang HANYA untuk SELECT. */
export function isTransientConnectError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  if (e.code && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "57P01", "57P03", "08006", "08001", "08004"].includes(e.code)) return true;
  return /timeout exceeded when trying to connect|Connection terminated|server closed the connection unexpectedly/i.test(e.message ?? "");
}

/**
 * Pool node-postgres untuk Neon (string koneksi dari DATABASE_URL, `sslmode=verify-full`).
 * Kompatibel dengan endpoint pooled Neon (PgBouncer mode transaksi): tanpa LISTEN/NOTIFY,
 * tanpa advisory lock sesi, tanpa prepared statement bernama.
 */
export function createPgDb(connectionString: string, opts: PgOptions): Db {
  const pool = new pg.Pool({
    connectionString,
    max: opts.poolMax,
    connectionTimeoutMillis: opts.connectTimeoutMs ?? 8_000,
    // Neon men-suspend compute yang idle; lepas koneksi idle lebih dulu.
    idleTimeoutMillis: 30_000,
    statement_timeout: opts.statementTimeoutMs,
    query_timeout: opts.statementTimeoutMs + 1_000,
    application_name: "longroll-realtime",
    keepAlive: true,
  });
  // Error koneksi idle (mis. compute Neon di-suspend) tidak boleh menjatuhkan proses.
  pool.on("error", (err: Error & { code?: string }) => log.warn("pg.pool_error", { code: err.code ?? "unknown" }));

  const maxWaiting = opts.maxWaiting ?? Math.max(4, opts.poolMax * 4);
  const guard = () => {
    if (pool.waitingCount >= maxWaiting) {
      metrics.inc("pg_pool_rejected_total");
      throw new Error("pg pool exhausted");
    }
  };

  return {
    async query(text, params) {
      for (let attempt = 0; ; attempt++) {
        guard();
        try {
          return (await pool.query(text, params as unknown[])) as never;
        } catch (err) {
          // Cold start: gagal membuka koneksi → ulangi (statement belum terkirim). Koneksi putus di tengah jalan:
          // hanya SELECT idempoten yang diulang; tulis tidak pernah diulang di sini (saveRoom memakai revisi optimistik).
          const retriable = isConnectPhaseError(err) || (/^\s*select\s/i.test(text) && isTransientConnectError(err));
          if (!retriable || attempt >= CONNECT_RETRIES) throw err;
          metrics.inc("pg_retry_total");
          await sleepMs(300 * (attempt + 1));
        }
      }
    },
    async transaction(fn) {
      let client: pg.PoolClient | undefined;
      for (let attempt = 0; !client; attempt++) {
        guard();
        try {
          client = await pool.connect();
        } catch (err) {
          if (!isConnectPhaseError(err) || attempt >= CONNECT_RETRIES) throw err;
          metrics.inc("pg_retry_total");
          await sleepMs(300 * (attempt + 1));
        }
      }
      let broken: Error | undefined;
      try {
        await client.query("BEGIN");
        const result = await fn(client as unknown as Queryable);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch((rollbackErr: Error) => {
          broken = rollbackErr;
        });
        throw err;
      } finally {
        client.release(broken);
      }
    },
    close: () => pool.end(),
  };
}
