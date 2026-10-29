import type { AttemptUrlResponse } from "@longroll/shared";
import { REALTIME_URL } from "@/room/api";

const cache = new Map<string, { url: string; expiresAtMs: number }>();
const inflight = new Map<string, Promise<string>>();

/** Signed URL baca attempt (≤ 10 menit), di-cache sampai 30 detik sebelum kedaluwarsa. */
export function attemptUrl(code: string, attemptId: string, part: "preview" | "full" | "edit"): Promise<string> {
  const key = `${code}:${attemptId}:${part}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAtMs - 30_000 > Date.now()) return Promise.resolve(hit.url);
  const running = inflight.get(key);
  if (running) return running;
  const p = fetch(`${REALTIME_URL}/api/rooms/${encodeURIComponent(code)}/attempts/${encodeURIComponent(attemptId)}/url?part=${part}`, {
    credentials: "include",
    cache: "no-store",
  })
    .then(async (res) => {
      if (!res.ok) throw new Error(`attempt url ${res.status}`);
      const body = (await res.json()) as AttemptUrlResponse;
      cache.set(key, { url: body.url, expiresAtMs: body.expiresAtMs });
      return body.url;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function forgetAttempt(code: string, attemptId: string) {
  for (const part of ["preview", "full", "edit"]) cache.delete(`${code}:${attemptId}:${part}`);
}
