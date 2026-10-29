#!/usr/bin/env node
/**
 * Smoke test deployment PUBLIK (tanpa dependensi). Membuktikan topologi cookie/CORS/CSP/WS pada URL sebenarnya.
 *
 *   node infra/deployment/smoke.mjs https://app.<domain> https://rt.<domain>
 *
 * Membuat SATU room uji sekali pakai lalu langsung keluar (POST /leave); room bubar sendiri setelah masa tunggu.
 * Tidak mencetak nilai cookie/token. Exit code 1 bila ada pemeriksaan gagal. Lulus script ini BUKAN bukti kamera/WebRTC/
 * storage berfungsi — itu butuh browser nyata (lihat PRODUCTION_CHECKLIST.md, bagian "Verifikasi publik").
 */
import http from "node:http";
import https from "node:https";

const [web, rt] = process.argv.slice(2).map((u) => u?.replace(/\/$/, ""));
if (!web || !rt) {
  console.error("Pakai: node smoke.mjs <WEB_ORIGIN> <REALTIME_ORIGIN>");
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "LULUS" : "GAGAL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const site = (h) => h.split(".").slice(-2).join(".");

async function main() {
  const wu = new URL(web);
  const ru = new URL(rt);
  check("web & realtime https", wu.protocol === "https:" && ru.protocol === "https:");
  check("web & realtime satu site (heuristik 2 label; cek PSL manual)", site(wu.hostname) === site(ru.hostname), `${wu.hostname} / ${ru.hostname}`);

  // 1. Web: halaman + CSP bernonce tanpa unsafe-inline/eval.
  const page = await fetch(web + "/");
  const csp = page.headers.get("content-security-policy") ?? "";
  const script = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";
  check("web: 200", page.status === 200, String(page.status));
  check("web: CSP nonce + strict-dynamic, tanpa unsafe-inline/eval", /'nonce-/.test(script) && script.includes("'strict-dynamic'") && !/unsafe-(inline|eval)/.test(script));
  check("web: connect-src memuat origin realtime", csp.includes(rt) || csp.includes(rt.replace(/^https/, "wss")));
  const html = await page.text();
  check("web: bundel tidak memuat placeholder/localhost realtime", !/realtime\.longroll\.invalid|localhost:4000/.test(html));
  check("web: HSTS + X-Frame-Options", /max-age=\d+/.test(page.headers.get("strict-transport-security") ?? "") && page.headers.get("x-frame-options") === "DENY");
  const dev = await fetch(web + "/dev/components");
  check("web: /dev/components 404", dev.status === 404, String(dev.status));

  // 2. Realtime: health, CORS.
  const health = await fetch(rt + "/api/health");
  const hj = await health.json().catch(() => ({}));
  check("realtime: /api/health 200 dan store Postgres sehat", health.status === 200 && hj.store === "postgres" && hj.storeOk === true, JSON.stringify({ store: hj.store, storeOk: hj.storeOk }));
  const pre = await fetch(rt + "/api/rooms", { method: "OPTIONS", headers: { Origin: web, "Access-Control-Request-Method": "POST" } });
  check("realtime: preflight origin web → ACAO tepat + credentials", pre.headers.get("access-control-allow-origin") === web && pre.headers.get("access-control-allow-credentials") === "true");
  const bad = await fetch(rt + "/api/rooms", { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
  check("realtime: preflight origin asing ditolak, tanpa ACAO", !bad.headers.get("access-control-allow-origin"));
  const badPost = await fetch(rt + "/api/rooms", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "x" }) });
  check("realtime: POST dari origin asing → 403", badPost.status === 403, String(badPost.status));

  // 3. Buat room dari origin web: atribut cookie.
  const created = await fetch(rt + "/api/rooms", { method: "POST", headers: { Origin: web, "Content-Type": "application/json" }, body: JSON.stringify({ displayName: "Smoke" }) });
  check("realtime: buat room 201", created.status === 201, String(created.status));
  const cookies = created.headers.getSetCookie?.() ?? [];
  const sc = cookies[0] ?? "";
  check("cookie: HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age", /HttpOnly/i.test(sc) && /;\s*Secure/i.test(sc) && /SameSite=Strict/i.test(sc) && /Path=\//.test(sc) && /Max-Age=\d+/.test(sc));
  check("cookie: host-only (tanpa atribut Domain)", !/;\s*Domain=/i.test(sc));
  const body = await created.json().catch(() => ({}));
  check("respons sesi: wsUrl wss:// pada host realtime", typeof body.wsUrl === "string" && body.wsUrl.startsWith("wss://" + ru.host + "/"), typeof body.wsUrl === "string" ? new URL(body.wsUrl).origin : "");
  const code = body.roomCode;
  const wsTarget = typeof body.wsUrl === "string" ? new URL(body.wsUrl) : null;

  // 4. WebSocket upgrade: tanpa cookie ditolak; dengan Origin asing ditolak.
  const upgrade = (origin, cookie) =>
    new Promise((resolve) => {
      const lib = ru.protocol === "https:" ? https : http;
      const req = lib.request({ host: ru.hostname, port: ru.port || (ru.protocol === "https:" ? 443 : 80), path: wsTarget ? `${wsTarget.pathname}${wsTarget.search}${wsTarget.search ? "&" : "?"}v=1` : "/ws?v=1", headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) } });
      req.on("upgrade", (_r, s) => (s.destroy(), resolve(101)));
      req.on("response", (r) => (r.resume(), resolve(r.statusCode ?? 0)));
      req.on("error", () => resolve(-1));
      req.setTimeout(10000, () => (req.destroy(), resolve(-2)));
      req.end();
    });
  check("ws: tanpa cookie ditolak (401/403)", [401, 403].includes(await upgrade(web)), "");
  const pair = sc.split(";")[0];
  check("ws: Origin asing + cookie sah ditolak", [401, 403].includes(await upgrade("https://evil.example", pair)));
  check("ws: Origin web + cookie sah → 101 Switching Protocols", (await upgrade(web, pair)) === 101);

  // 5. Bersih-bersih: keluar dari room uji.
  if (code) {
    const left = await fetch(`${rt}/api/rooms/${code}/leave`, { method: "POST", headers: { Origin: web, Cookie: pair, "Content-Type": "application/json" }, body: "{}" });
    check("bersih-bersih: leave 200", left.status === 200, String(left.status));
  }

  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} lulus${failed ? `, ${failed} GAGAL` : ""}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("smoke gagal:", String(e?.message ?? e).replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]"));
  process.exit(1);
});
