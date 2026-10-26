/**
 * Log terstruktur (13 §12, NFR-09). DILARANG mencatat: display name, token, cookie, IP mentah,
 * isi pesan. Pakai roomId (UUID internal) dan kode hasil.
 */
type Fields = Record<string, string | number | boolean | null | undefined>;

let silent = process.env.NODE_ENV === "test";

export function setLogSilent(value: boolean) {
  silent = value;
}

function write(level: "info" | "warn" | "error", event: string, fields: Fields = {}) {
  if (silent) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};

/** Counter sederhana di memori (metrik 13 §12); diekspor lewat log, bukan endpoint publik. */
export const metrics = {
  counters: new Map<string, number>(),
  inc(name: string, by = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  },
  get(name: string) {
    return this.counters.get(name) ?? 0;
  },
};
