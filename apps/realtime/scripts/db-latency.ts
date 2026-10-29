/**
 * P10-A — pemisahan latensi tulis Neon: RTT jaringan vs. durasi transaksi (tanpa mock, tanpa beban).
 * Hanya memakai satu koneksi, ~150 statement kecil pada baris probe `p10-probe-*` di lr_rate_limits, lalu menghapusnya.
 * Jalankan: npm run latency:db -w @longroll/realtime   (DATABASE_URL dari .env; role longroll_app; branch development)
 * Tidak mencetak URL/kredensial.
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL kosong");
  process.exit(1);
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const stat = (xs: number[]) => ({ n: xs.length, p50: +pct(xs, 50).toFixed(1), p95: +pct(xs, 95).toFixed(1), max: +Math.max(...xs).toFixed(1) });
const ms = async (fn: () => Promise<unknown>) => {
  const t = performance.now();
  await fn();
  return performance.now() - t;
};

const N = Number(process.env.LATENCY_N ?? 40);
const probe = `p10-probe-${Date.now()}`;

const main = async () => {
  const c = new pg.Client({ connectionString: url, application_name: "longroll-p10-latency", connectionTimeoutMillis: 15_000 });
  const connect = await ms(() => c.connect());
  const out: Record<string, unknown> = { region: "aws-ap-southeast-1 (Neon)", connect_ms: +connect.toFixed(1) };
  try {
    await c.query("SELECT 1"); // hangatkan compute
    const sel: number[] = [];
    for (let i = 0; i < N; i++) sel.push(await ms(() => c.query("SELECT 1")));
    out.select1_rtt = stat(sel);

    // Satu statement tulis (autocommit): 1 RTT + commit durable.
    const single: number[] = [];
    for (let i = 0; i < N; i++) {
      single.push(
        await ms(() =>
          c.query(
            `INSERT INTO lr_rate_limits (bucket, window_start, hits, expires_at) VALUES ($1, now() + ($2 || ' ms')::interval, 1, now() + interval '5 minutes')
             ON CONFLICT (bucket, window_start) DO UPDATE SET hits = lr_rate_limits.hits + 1`,
            [probe, String(i)],
          ),
        ),
      );
    }
    out.write_1_statement_autocommit = stat(single);

    // Pola saveRoom: BEGIN + 3 statement + COMMIT, masing-masing round-trip sendiri (seperti db.transaction()).
    const tx: number[] = [];
    for (let i = 0; i < N; i++) {
      tx.push(
        await ms(async () => {
          await c.query("BEGIN");
          await c.query("UPDATE lr_rate_limits SET hits = hits + 1 WHERE bucket = $1", [probe]);
          await c.query("INSERT INTO lr_rate_limits (bucket, window_start, hits, expires_at) VALUES ($1, now() + ($2 || ' ms')::interval, 1, now() + interval '5 minutes') ON CONFLICT DO NOTHING", [probe, String(1000 + i)]);
          await c.query("DELETE FROM lr_rate_limits WHERE bucket = $1 AND hits > 1000000", [probe]);
          await c.query("COMMIT");
        }),
      );
    }
    out.write_tx_5_roundtrips = stat(tx);

    // Alternatif: seluruh unit kerja dalam SATU statement (CTE) = 1 RTT + commit.
    const cte: number[] = [];
    for (let i = 0; i < N; i++) {
      cte.push(
        await ms(() =>
          c.query(
            `WITH u AS (UPDATE lr_rate_limits SET hits = hits + 1 WHERE bucket = $1 RETURNING 1),
                  i AS (INSERT INTO lr_rate_limits (bucket, window_start, hits, expires_at) VALUES ($1, now() + ($2 || ' ms')::interval, 1, now() + interval '5 minutes') ON CONFLICT DO NOTHING RETURNING 1),
                  d AS (DELETE FROM lr_rate_limits WHERE bucket = $1 AND hits > 1000000 RETURNING 1)
             SELECT (SELECT count(*) FROM u) + (SELECT count(*) FROM i) + (SELECT count(*) FROM d) AS n`,
            [probe, String(5000 + i)],
          ),
        ),
      );
    }
    out.write_same_work_1_statement_cte = stat(cte);

    const rtt = (out.select1_rtt as { p50: number }).p50;
    out.derived = {
      tx_roundtrips: 5,
      expected_tx_ms_if_network_bound: +(rtt * 5).toFixed(1),
      note: "Jika write_tx ≈ 5 × select1_rtt, latensi didominasi jumlah round-trip × jarak jaringan, bukan eksekusi SQL.",
    };
  } finally {
    await c.query("DELETE FROM lr_rate_limits WHERE bucket = $1", [probe]).catch(() => undefined);
    await c.end();
  }
  console.log(JSON.stringify(out, null, 2));
};

main().catch((e: Error) => {
  console.error("gagal:", e.message.replace(/postgres(ql)?:\/\/\S+/g, "[dsn]"));
  process.exit(1);
});
