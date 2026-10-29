/**
 * Pemeriksaan build deployment untuk NEXT_PUBLIC_REALTIME_URL (di-bake ke bundle klien saat build, dan dibaca proxy.ts
 * untuk connect-src CSP). Placeholder seperti https://realtime.longroll.invalid membuat pembuatan room gagal tanpa
 * pesan jelas, jadi di produksi Vercel (VERCEL_ENV=production) build GAGAL; di preview/lokal hanya peringatan.
 */
export interface RealtimeUrlCheck {
  level: "ok" | "warn" | "error";
  message: string;
}

const PLACEHOLDER_HOST = /\.invalid$|\.example$|\.test$/i;

export function checkRealtimeUrl(env: Record<string, string | undefined>): RealtimeUrlCheck {
  const raw = env.NEXT_PUBLIC_REALTIME_URL?.trim();
  const strict = env.VERCEL_ENV === "production";
  const fail = (message: string): RealtimeUrlCheck => ({ level: strict ? "error" : "warn", message });
  if (!raw) return fail("NEXT_PUBLIC_REALTIME_URL kosong: klien akan memakai http://localhost:4000 dan tidak bisa membuat room.");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return fail(`NEXT_PUBLIC_REALTIME_URL bukan URL valid ("${raw}").`);
  }
  if (PLACEHOLDER_HOST.test(u.hostname)) return fail(`NEXT_PUBLIC_REALTIME_URL masih placeholder ("${u.hostname}"): isi dengan origin service realtime yang sebenarnya.`);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (local) return fail("NEXT_PUBLIC_REALTIME_URL menunjuk localhost: tidak bisa dijangkau dari browser pengguna.");
  if (u.protocol !== "https:") return fail("NEXT_PUBLIC_REALTIME_URL wajib https:// di produksi (cookie Secure + WSS).");
  if (u.pathname !== "/" || u.search || u.hash) return fail("NEXT_PUBLIC_REALTIME_URL harus origin murni (tanpa path/query).");
  return { level: "ok", message: "ok" };
}
