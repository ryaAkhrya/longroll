import type { Browser, BrowserContext, Page, TestInfo } from "@playwright/test";
import { RECORD_GUM } from "../helpers";

export { createRoom, joinRoom, playingRemoteVideos, passCameraCheck } from "../helpers";

/** Mengumpulkan pelanggaran CSP + error konsol/halaman per peserta. Tes gagal bila ada yang tidak diizinkan. */
export interface Watch {
  name: string;
  csp: string[];
  errors: string[];
  pageErrors: string[];
}

const CSP_INIT = () => {
  const w = window as unknown as { __csp: string[] };
  w.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => {
    w.__csp.push(`${e.violatedDirective} blocked=${e.blockedURI || "inline"} src=${e.sourceFile || ""}:${e.lineNumber}`);
  });
};

export interface Person {
  ctx: BrowserContext;
  page: Page;
  watch: Watch;
}

export async function openPerson(browser: Browser, info: TestInfo, name: string, opts: { camera?: boolean } = {}): Promise<Person> {
  const mobile = info.project.name.includes("mobile");
  const vp = info.project.use.viewport ?? { width: 1366, height: 860 };
  const ctx = await browser.newContext({
    viewport: vp,
    isMobile: mobile,
    hasTouch: mobile,
    permissions: opts.camera === false || browser.browserType().name() !== "chromium" ? [] : ["camera"],
    acceptDownloads: true,
  });
  await ctx.addInitScript(RECORD_GUM);
  await ctx.addInitScript(CSP_INIT);
  const page = await ctx.newPage();
  const watch: Watch = { name, csp: [], errors: [], pageErrors: [] };
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const t = m.text();
    // Pelanggaran CSP juga muncul sebagai pesan konsol: tangkap keduanya.
    if (/Content Security Policy|Refused to/i.test(t)) watch.csp.push(`console: ${t.slice(0, 240)}`);
    else if (m.type() === "error") watch.errors.push(`${t.slice(0, 200)} @${m.location().url.replace(/\?.*/, "").slice(0, 80)}`);
  });
  page.on("pageerror", (e) => watch.pageErrors.push(String(e.message).slice(0, 240)));
  return { ctx, page, watch };
}

/** Pelanggaran dari event DOM (lengkap dengan direktif) digabung dengan yang dari konsol. */
export async function collectCsp(p: Person): Promise<string[]> {
  const dom = await p.page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => [] as string[]);
  return [...new Set([...dom, ...p.watch.csp])];
}

/** Kesalahan konsol yang diharapkan/tidak relevan (bukan CSP): ditulis eksplisit supaya tak menyembunyikan bug. */
const IGNORABLE = [
  /Failed to load resource: the server responded with a status of (404|409|410|429)/, // negatif yang disengaja
  /favicon/i,
  // Probe resume sebelum gabung (belum punya cookie) → 401 yang dirancang; hanya endpoint ini, hanya 401.
  /status of 401 \(Unauthorized\) @http:\/\/localhost:4000\/api\/rooms\/[A-HJ-NP-Z2-9]{6}\/session$/,
];
export function unexpectedErrors(p: Person): string[] {
  return [...p.watch.errors, ...p.watch.pageErrors].filter((e) => !IGNORABLE.some((r) => r.test(e)));
}

export const shutterName = /^Ambil foto, hitung mundur/;

type AxeResult = { violations: { id: string; impact: string; nodes: { target: unknown[]; html?: string; any?: { message?: string }[] }[] }[] };

/** axe-core disuntik lewat CDP evaluate (tidak tunduk pada CSP halaman). Mengembalikan pelanggaran serious/critical. */
export async function axeScan(page: Page, label: string): Promise<string[]> {
  const { createRequire } = await import("node:module");
  const fs = await import("node:fs");
  const src = fs.readFileSync(createRequire(process.cwd() + "/").resolve("axe-core/axe.min.js"), "utf8");
  await page.evaluate(src);
  // Transisi masuk (opacity) membuat kontras terhitung di tengah animasi; tunggu animasi terbatas selesai dulu.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
  const res = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<AxeResult> } }).axe;
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}(${v.impact}) x${v.nodes.length} ${JSON.stringify(v.nodes[0]?.target)} ${(v.nodes[0]?.html ?? '').slice(0, 120)} :: ${v.nodes[0]?.any?.[0]?.message ?? ''}`);
  });
  return res.map((r) => `[${label}] ${r}`);
}
