/**
 * Log terstruktur (13 §12, NFR-09). DILARANG mencatat: display name, token, cookie, IP mentah,
 * signed URL, DSN database, isi pesan. Pakai roomId (UUID internal) dan kode hasil.
 *
 * Pertahanan berlapis: selain disiplin di tiap pemanggil, SEMUA field melewati `scrub()` sebelum ditulis
 * (kunci sensitif → "[redacted]", URL/DSN/string mirip rahasia di nilai → disamarkan, panjang dibatasi).
 */
type Fields = Record<string, string | number | boolean | null | undefined>;

let silent = process.env.NODE_ENV === "test";
let sink: ((line: string) => void) | null = null;

export function setLogSilent(value: boolean) {
  silent = value;
}

/** Tangkap baris log (tes TC-SEC-041). null = kembali ke console. */
export function setLogSink(fn: ((line: string) => void) | null) {
  sink = fn;
}

const SENSITIVE_KEY = /(token|cookie|authorization|secret|password|passwd|displayname|display_name|^name$|^ip$|ipaddr|url|dsn|credential|signature|sdp|candidate)/i;
const MAX_FIELD = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATTERNS: [RegExp, string | ((m: string) => string)][] = [
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "[url]"], // http(s)/ws/postgres… lengkap dengan query & kredensial
  [/\b(?:nak|nsk|nt)_(?:live|test)_[A-Za-z0-9_]+/g, "[redacted]"], // kredensial storage/API
  [/[A-Za-z0-9_-]{32,}/g, (m) => (UUID.test(m) ? m : "[redacted]")], // token base64url/hex panjang (UUID roomId tetap)
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]"], // IPv4 mentah
];

/** Samarkan rahasia pada satu string. Dipakai juga untuk pesan error pihak ketiga (pg, S3). */
export function scrubText(value: string): string {
  let out = value;
  for (const [re, to] of PATTERNS) out = out.replace(re, to as string);
  return out.length > MAX_FIELD ? `${out.slice(0, MAX_FIELD)}…` : out;
}

export function scrub(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (SENSITIVE_KEY.test(k)) out[k] = v === null ? null : "[redacted]";
    else out[k] = typeof v === "string" ? scrubText(v) : v;
  }
  return out;
}

/** Ringkasan aman dari error tak dikenal (tanpa stack, tanpa isi mentah). */
export function errText(err: unknown): string {
  if (err instanceof Error) return scrubText(`${err.name}: ${err.message}`);
  return scrubText(String(err));
}

function write(level: "info" | "warn" | "error", event: string, fields: Fields = {}) {
  if (silent && !sink) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...scrub(fields) });
  if (sink) return sink(line);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};

const SAMPLES = 512;

/**
 * Metrik sederhana di memori (13 §12): counter, gauge, dan observasi (p50/p95 dari ≤ 512 sampel terakhir).
 * Diekspor lewat log berkala (`metrics.snapshot`), BUKAN lewat endpoint publik.
 */
export const metrics = {
  counters: new Map<string, number>(),
  gauges: new Map<string, number>(),
  samples: new Map<string, number[]>(),
  inc(name: string, by = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  },
  get(name: string) {
    return this.counters.get(name) ?? 0;
  },
  gauge(name: string, value: number) {
    this.gauges.set(name, value);
  },
  observe(name: string, value: number) {
    let s = this.samples.get(name);
    if (!s) this.samples.set(name, (s = []));
    s.push(value);
    if (s.length > SAMPLES) s.shift();
  },
  percentile(name: string, p: number): number | null {
    const s = this.samples.get(name);
    if (!s?.length) return null;
    const sorted = [...s].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
  },
  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.counters) out[k] = v;
    for (const [k, v] of this.gauges) out[k] = v;
    for (const k of this.samples.keys()) {
      out[`${k}_p50`] = this.percentile(k, 50)!;
      out[`${k}_p95`] = this.percentile(k, 95)!;
    }
    return out;
  },
  reset() {
    this.counters.clear();
    this.gauges.clear();
    this.samples.clear();
  },
};
