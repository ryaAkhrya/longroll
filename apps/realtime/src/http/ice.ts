import { createHmac } from "node:crypto";
import type { IceServersResponse } from "@longroll/shared";
import type { ServerConfig } from "../config";
import { log, metrics } from "../log";

type IceServer = IceServersResponse["iceServers"][number];
type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const URL_RE = /^(stun|stuns|turn|turns):[^\s]{1,300}$/i;
const MAX_SERVERS = 12;
const FETCH_TIMEOUT_MS = 4_000;
/** Kredensial penyedia di-cache: satu panggilan API per jendela ini untuk SEMUA peserta, bukan satu per klien. */
const PROVIDER_TTL_MS = 10 * 60_000;
/** Bila penyedia gagal, kredensial lama masih dipakai selama ini (kredensial penyedia biasanya hidup lebih lama dari cache). */
const PROVIDER_STALE_MS = 60 * 60_000;
const WARN_EVERY_MS = 60_000;

export const isTurnUrl = (u: string) => /^turns?:/i.test(u);

/**
 * Normalisasi respons penyedia ke daftar ICE yang aman diteruskan ke klien: skema stun/stuns/turn/turns saja, panjang dibatasi,
 * jumlah dibatasi. Menerima array `RTCIceServer[]` (Metered) atau `{ iceServers: [...] }` (Twilio/Cloudflare/Xirsys-style).
 * Entri TURN tanpa username/credential dibuang (tidak akan bisa dipakai dan hanya memperlambat ICE).
 */
export function normalizeIceServers(raw: unknown): IceServer[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { iceServers?: unknown }).iceServers) ? (raw as { iceServers: unknown[] }).iceServers : [];
  const out: IceServer[] = [];
  for (const e of list.slice(0, MAX_SERVERS)) {
    if (!e || typeof e !== "object") continue;
    const o = e as { urls?: unknown; url?: unknown; username?: unknown; credential?: unknown };
    const urlsRaw = o.urls ?? o.url;
    const urls = (Array.isArray(urlsRaw) ? urlsRaw : [urlsRaw]).filter((u): u is string => typeof u === "string" && URL_RE.test(u)).slice(0, 8);
    if (urls.length === 0) continue;
    const entry: IceServer = { urls };
    if (typeof o.username === "string" && typeof o.credential === "string" && o.username.length <= 512 && o.credential.length <= 512) {
      entry.username = o.username;
      entry.credential = o.credential;
    }
    if (urls.some(isTurnUrl) && !entry.username) continue;
    out.push(entry);
  }
  return out;
}

/**
 * Daftar ICE untuk peserta sah (DEC-073, provider-netral). Sumber TURN, berurutan:
 *  1. `TURN_CREDENTIALS_URL` — endpoint REST penyedia terkelola (mis. Metered `…/api/v1/turn/credentials?apiKey=…`) yang
 *     mengembalikan daftar ICE sementara. Kunci API tetap di server; hasil di-cache dan dipakai bersama.
 *  2. `TURN_URLS` + `TURN_SHARED_SECRET` — skema REST "use-auth-secret" (coturn): kredensial HMAC per peserta, TTL pendek.
 *  3. `TURN_URLS` + `TURN_USERNAME`/`TURN_CREDENTIAL` — kredensial statis penyedia (diteruskan apa adanya ke peserta sah).
 * Kegagalan penyedia tidak pernah menggagalkan endpoint: STUN tetap dikirim dan kegagalan dicatat tanpa URL/kunci.
 */
export class IceProvider {
  private cache: { servers: IceServer[]; at: number } | null = null;
  private inflight: Promise<IceServer[]> | null = null;
  private lastWarnAt = 0;

  constructor(
    private readonly config: ServerConfig["ice"],
    private readonly now: () => number = Date.now,
    private readonly fetcher: FetchLike = (url, init) => fetch(url, { signal: init.signal, headers: { Accept: "application/json" } }),
  ) {}

  /** true bila ada sumber TURN yang dikonfigurasi (untuk /api/health & log start). */
  get turnConfigured() {
    return !!this.config.turnCredentialsUrl || this.config.turnUrls.length > 0;
  }

  async build(participantId: string): Promise<IceServersResponse> {
    const { stunUrls, turnUrls, turnSharedSecret, turnUsername, turnCredential, turnTtlSeconds, turnCredentialsUrl } = this.config;
    const servers: IceServer[] = [];
    if (stunUrls.length) servers.push({ urls: stunUrls });
    let ttlSec = turnTtlSeconds;

    if (turnCredentialsUrl) {
      const provided = await this.provider(turnCredentialsUrl);
      servers.push(...provided);
      ttlSec = Math.min(ttlSec, PROVIDER_TTL_MS / 1000);
    }
    if (turnUrls.length && turnSharedSecret) {
      const username = `${Math.floor(this.now() / 1000) + turnTtlSeconds}:${participantId}`;
      servers.push({ urls: turnUrls, username, credential: createHmac("sha1", turnSharedSecret).update(username).digest("base64") });
    } else if (turnUrls.length && turnUsername && turnCredential) {
      servers.push({ urls: turnUrls, username: turnUsername, credential: turnCredential });
    }
    return { iceServers: servers, ttlSec, turn: servers.some((s) => s.urls.some(isTurnUrl)) };
  }

  private async provider(url: string): Promise<IceServer[]> {
    const t = this.now();
    if (this.cache && t - this.cache.at < PROVIDER_TTL_MS) return this.cache.servers;
    // Single-flight: banyak peserta serentak = satu panggilan ke penyedia.
    this.inflight ??= this.fetchProvider(url).finally(() => {
      this.inflight = null;
    });
    try {
      const servers = await this.inflight;
      this.cache = { servers, at: this.now() };
      return servers;
    } catch (err) {
      metrics.inc("ice_provider_failures_total");
      const stale = this.cache && this.now() - this.cache.at < PROVIDER_STALE_MS ? this.cache.servers : [];
      if (this.now() - this.lastWarnAt > WARN_EVERY_MS) {
        this.lastWarnAt = this.now();
        // Tanpa URL (memuat kunci API) dan tanpa isi respons.
        log.warn("ice.provider_failed", { reason: err instanceof Error ? err.message.slice(0, 60) : "error", stale: stale.length > 0 });
      }
      return stale;
    }
  }

  private async fetchProvider(url: string): Promise<IceServer[]> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await this.fetcher(url, { signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const servers = normalizeIceServers(await res.json());
      if (servers.length === 0) throw new Error("respons tanpa server ICE yang valid");
      return servers;
    } finally {
      clearTimeout(timer);
    }
  }
}
