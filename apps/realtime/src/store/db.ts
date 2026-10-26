import pg from "pg";
import { log } from "../log";

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
    connectionTimeoutMillis: 5_000,
    // Neon men-suspend compute yang idle; lepas koneksi idle lebih dulu.
    idleTimeoutMillis: 30_000,
    statement_timeout: opts.statementTimeoutMs,
    query_timeout: opts.statementTimeoutMs + 1_000,
    application_name: "longroll-realtime",
    keepAlive: true,
  });
  // Error koneksi idle (mis. compute Neon di-suspend) tidak boleh menjatuhkan proses.
  pool.on("error", (err: Error & { code?: string }) => log.warn("pg.pool_error", { code: err.code ?? "unknown" }));

  return {
    query: (text, params) => pool.query(text, params as unknown[]) as never,
    async transaction(fn) {
      const client = await pool.connect();
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
