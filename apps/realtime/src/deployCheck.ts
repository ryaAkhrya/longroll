import type { ServerConfig } from "./config";

/**
 * Validasi topologi produksi (DEC-082, 15 §3). Cookie kredensial HttpOnly + Secure + SameSite=Strict hanya terkirim bila
 * web dan realtime berada di SITE yang sama (registrable domain yang sama). `*.vercel.app` dan `*.up.railway.app` adalah
 * public suffix: tiap subdomain adalah site tersendiri, jadi kombinasi itu membuat cookie tidak pernah terkirim.
 * Fungsi murni; dipanggil index.ts saat start dan membuat service menolak start (tidak ada pelonggaran diam-diam).
 */

/** Sufiks multi-tenant (subset Public Suffix List yang relevan untuk hosting). Tiap sub-label di bawahnya = site berbeda. */
const SHARED_SUFFIXES = [
  "vercel.app",
  "up.railway.app",
  "railway.app",
  "onrender.com",
  "fly.dev",
  "herokuapp.com",
  "netlify.app",
  "pages.dev",
  "workers.dev",
  "github.io",
  "web.app",
  "firebaseapp.com",
  "azurewebsites.net",
  "ngrok-free.app",
  "trycloudflare.com",
  "loca.lt",
];

/** ccTLD dua-label yang umum (subset PSL) — registrable domain = 3 label terakhir. */
const TWO_LABEL_TLDS = new Set(["co.id", "or.id", "web.id", "ac.id", "go.id", "sch.id", "my.id", "biz.id", "co.uk", "org.uk", "com.au", "co.jp", "com.sg", "co.nz", "com.my"]);

/** Perkiraan "site" (eTLD+1) sebuah host. Heuristik berdaftar-pendek; verifikasi domain nyata terhadap PSL sebelum rilis. */
export function siteOf(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(":") || !h.includes(".")) return h; // IP / localhost
  for (const suffix of SHARED_SUFFIXES) {
    if (h === suffix) return h;
    if (h.endsWith(`.${suffix}`)) {
      const label = h.slice(0, -(suffix.length + 1)).split(".").pop()!;
      return `${label}.${suffix}`;
    }
  }
  const labels = h.split(".");
  const last2 = labels.slice(-2).join(".");
  return TWO_LABEL_TLDS.has(last2) && labels.length >= 3 ? labels.slice(-3).join(".") : last2;
}

export interface DeployCheck {
  errors: string[];
  warnings: string[];
}

const PLACEHOLDER = /\.invalid$|\.example$|\.test$|\.localhost$|^localhost$|^127\.|^0\.0\.0\.0$/i;

export function checkProductionConfig(config: ServerConfig): DeployCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!config.isProduction) return { errors, warnings };

  if (config.allowedOrigins.length === 0) errors.push("ALLOWED_ORIGINS kosong: tidak ada origin web yang diizinkan.");
  const originSites = new Set<string>();
  for (const o of config.allowedOrigins) {
    let u: URL;
    try {
      u = new URL(o);
    } catch {
      errors.push(`ALLOWED_ORIGINS memuat nilai bukan URL: "${o}".`);
      continue;
    }
    if (u.protocol !== "https:") errors.push(`ALLOWED_ORIGINS wajib https:// di produksi ("${o}").`);
    if (o !== u.origin) errors.push(`ALLOWED_ORIGINS harus berupa origin murni tanpa path/slash akhir ("${o}" -> "${u.origin}").`);
    if (PLACEHOLDER.test(u.hostname)) errors.push(`ALLOWED_ORIGINS memuat host placeholder/lokal ("${u.hostname}").`);
    originSites.add(siteOf(u.hostname));
  }

  let wsHost: string | null = null;
  try {
    const ws = new URL(config.publicWsUrl);
    wsHost = ws.hostname;
    if (ws.protocol !== "wss:") errors.push("PUBLIC_WS_URL wajib wss:// di produksi.");
    if (ws.pathname !== "/ws") errors.push('PUBLIC_WS_URL harus berakhir di path "/ws".');
    if (PLACEHOLDER.test(ws.hostname)) errors.push(`PUBLIC_WS_URL memuat host placeholder/lokal ("${ws.hostname}").`);
  } catch {
    errors.push("PUBLIC_WS_URL bukan URL yang valid.");
  }
  try {
    if (new URL(config.publicHttpUrl).protocol !== "https:") errors.push("PUBLIC_HTTP_URL wajib https:// di produksi.");
  } catch {
    errors.push("PUBLIC_HTTP_URL bukan URL yang valid.");
  }

  if (!config.cookie.secure) errors.push("COOKIE_SECURE=false ditolak di produksi (cookie kredensial wajib Secure).");

  if (wsHost) {
    const wsSite = siteOf(wsHost);
    for (const s of originSites) {
      if (s !== wsSite) {
        errors.push(
          `Topologi cookie (DEC-082): web "${s}" dan realtime "${wsSite}" bukan site yang sama, sehingga cookie SameSite=Strict tidak akan pernah terkirim. ` +
            "Pakai satu registrable domain (mis. app.<domain> dan rt.<domain>), lihat infra/deployment/DOMAIN_COOKIES.md.",
        );
      }
    }
    if (config.cookie.domain) {
      const d = config.cookie.domain.replace(/^\./, "").toLowerCase();
      if (!(wsHost === d || wsHost.endsWith(`.${d}`))) errors.push(`COOKIE_DOMAIN "${d}" bukan induk host realtime "${wsHost}".`);
      if (siteOf(d) !== d && !d.endsWith(`.${siteOf(d)}`)) errors.push(`COOKIE_DOMAIN "${d}" terlalu luas / public suffix.`);
      warnings.push("COOKIE_DOMAIN diset: cookie ikut terkirim ke seluruh subdomain. Kosongkan (host-only) kecuali ada alasan kuat.");
    }
  }

  if (config.s3 && !/^https:\/\//i.test(config.s3.endpoint)) errors.push("S3_ENDPOINT wajib https:// di produksi.");
  const ice = config.ice;
  const staticCred = !!ice.turnUsername && !!ice.turnCredential;
  if (ice.turnUrls.length > 0 && !ice.turnSharedSecret && !staticCred) errors.push("TURN_URLS diset tanpa kredensial: isi TURN_SHARED_SECRET atau TURN_USERNAME + TURN_CREDENTIAL.");
  if ((ice.turnUsername || ice.turnCredential) && !staticCred) errors.push("TURN_USERNAME dan TURN_CREDENTIAL harus diisi berpasangan.");
  if (ice.turnCredentialsUrl && !/^https:\/\//i.test(ice.turnCredentialsUrl)) errors.push("TURN_CREDENTIALS_URL wajib https://.");
  if (ice.turnUrls.length === 0 && !ice.turnCredentialsUrl) warnings.push("TURN belum dikonfigurasi: peserta di balik NAT ketat/CGNAT/UDP terblokir tidak bisa terhubung (hanya STUN). Lihat infra/turn/README.md.");
  else if (![...ice.turnUrls].some((u) => /^turns:/i.test(u) || /transport=tcp/i.test(u)) && ice.turnUrls.length > 0 && !ice.turnCredentialsUrl) warnings.push("TURN_URLS tanpa turns:/transport=tcp: jaringan yang memblokir UDP tetap gagal. Tambahkan turns:<host>:443.");
  if (config.trustProxy === 0) warnings.push("TRUST_PROXY=0 di belakang proxy hosting: semua klien akan berbagi satu batas IP. Set jumlah proxy tepercaya (Railway: 1).");
  return { errors, warnings };
}
