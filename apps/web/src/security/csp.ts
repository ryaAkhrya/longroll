/**
 * Content-Security-Policy final (15 §6, TH-03). Fungsi murni supaya bisa diuji tanpa browser.
 *
 * - script-src: TANPA 'unsafe-inline'. Skrip inline Next.js diberi nonce per-request oleh proxy.ts; `'strict-dynamic'`
 *   mempercayai skrip yang dimuat oleh skrip ber-nonce (mis. Google Identity Services yang dimuat drive.ts).
 *   `'unsafe-eval'` hanya di development (React butuh untuk stack debugging).
 * - style-src (elemen <style>/<link>): nonce. Atribut `style=""` (prop style React, 43 pemakaian) tetap memerlukan
 *   `style-src-attr 'unsafe-inline'` — risiko diterima: atribut style tidak bisa mengeksekusi skrip.
 * - base-uri 'none', object-src 'none', frame-ancestors 'none', form-action 'self'.
 */
export interface CspEnv {
  isDev: boolean;
  realtimeUrl: string;
  storageOrigin: string;
  googleEnabled: boolean;
  /** upgrade-insecure-requests. Default menyala di produksi; WebKit juga meng-upgrade http://localhost sehingga E2E lokal mematikannya. */
  upgradeInsecure: boolean;
}

export function cspEnvFromProcess(env: NodeJS.ProcessEnv = process.env): CspEnv {
  return {
    isDev: env.NODE_ENV !== "production",
    realtimeUrl: env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4000",
    storageOrigin: env.NEXT_PUBLIC_STORAGE_ORIGIN?.trim() ?? "",
    googleEnabled: !!env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim(),
    upgradeInsecure: env.NODE_ENV === "production" && env.CSP_UPGRADE_INSECURE_REQUESTS !== "false",
  };
}

/** Nonce 128-bit acak per request (base64). Web Crypto tersedia di runtime proxy. */
export function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function buildCsp(nonce: string, env: CspEnv): string {
  const ws = env.realtimeUrl.replace(/^http/, "ws");
  const storage = env.storageOrigin ? ` ${env.storageOrigin}` : "";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${env.isDev ? " 'unsafe-eval'" : ""}${env.googleEnabled ? " https://accounts.google.com/gsi/client" : ""}`,
    // Dev: overlay/HMR Next menyisipkan <style> tanpa nonce.
    `style-src 'self' ${env.isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}${env.googleEnabled ? " https://accounts.google.com/gsi/style" : ""}`,
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: blob: ${env.realtimeUrl}${storage}`,
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self' ${env.realtimeUrl} ${ws}${storage}${env.isDev ? " ws://localhost:*" : ""}${env.googleEnabled ? " https://www.googleapis.com https://accounts.google.com" : ""}`,
    ...(env.googleEnabled ? ["frame-src https://accounts.google.com"] : []),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(env.upgradeInsecure ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}
