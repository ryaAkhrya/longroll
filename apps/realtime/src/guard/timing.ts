/** Waktu respons minimum untuk jalur "kode tidak ada / tidak berhak" supaya ada/tidaknya room tidak bocor lewat timing (15 §3). */
export const LOOKUP_PAD_MS = 120;

export async function padTo(startedMs: number, minMs = LOOKUP_PAD_MS): Promise<void> {
  const left = minMs - (Date.now() - startedMs);
  if (left > 0) await new Promise((r) => setTimeout(r, left));
}
