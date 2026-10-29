import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
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

let ipCounter = Math.floor(Math.random() * 200_000);
/** IP palsu unik (rentang 10.0.0.0/8) untuk X-Forwarded-For; server E2E memakai TRUST_PROXY=1 (entri paling kanan dipercaya). */
export function fakeIp(): string {
  const n = ++ipCounter;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

export interface Person {
  ctx: BrowserContext;
  page: Page;
  watch: Watch;
  /** Menutup konteks (dan browser milik sendiri bila memakai kamera palsu per-peserta). */
  done: () => Promise<void>;
}

/**
 * Video kamera palsu DETERMINISTIK per peserta (y4m 320×240, 300 frame / 10 dtk, loop): warna latar, pita bergerak, dan
 * tint kroma berbeda untuk tiap indeks, sehingga foto 4 peserta berbeda dan bisa dibedakan byte-nya. Dibuat sekali di tmp.
 */
const NL = String.fromCharCode(10);
export function fakeCameraFile(idx: number, w = 320, h = 240, frames = 300): string {
  const dir = path.join(os.tmpdir(), "longroll-fake-cam-v1");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `cam-${idx}-${w}x${h}-${frames}.y4m`);
  if (fs.existsSync(file)) return file;
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  fs.writeSync(fd, `YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg${NL}`);
  const U = [60, 110, 170, 200][idx % 4]!;
  const V = [200, 70, 160, 90][idx % 4]!;
  const ySize = w * h;
  const cSize = (w / 2) * (h / 2);
  const frame = Buffer.alloc(6 + ySize + 2 * cSize);
  frame.write(`FRAME${NL}`, 0, "latin1");
  for (let f = 0; f < frames; f++) {
    let o = 6;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) frame[o++] = 50 + (((x + f * 2 + idx * 41) % 80 < 40 ? 110 : 0) + ((y + idx * 37) >> 1)) % 200;
    }
    frame.fill(U, o, o + cSize);
    frame.fill(V, o + cSize, o + 2 * cSize);
    fs.writeSync(fd, frame);
  }
  fs.closeSync(fd);
  fs.renameSync(tmp, file);
  return file;
}

export async function openPerson(browser: Browser, info: TestInfo, name: string, opts: { camera?: boolean; fakeVideoIdx?: number } = {}): Promise<Person> {
  let own: Browser | null = null;
  if (opts.fakeVideoIdx !== undefined) {
    own = await chromium.launch({ channel: "chrome", args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${fakeCameraFile(opts.fakeVideoIdx)}`] });
    browser = own;
  }
  const mobile = info.project.name.includes("mobile");
  const vp = info.project.use.viewport ?? { width: 1366, height: 860 };
  const ctx = await browser.newContext({
    viewport: vp,
    isMobile: mobile,
    hasTouch: mobile,
    permissions: opts.camera === false || browser.browserType().name() !== "chromium" ? [] : ["camera"],
    acceptDownloads: true,
  });
  // X-Forwarded-For unik per peserta HANYA ke service realtime, ditambahkan di lapisan jaringan (route) — bukan extraHTTPHeaders,
  // karena header kustom lintas-origin memicu preflight CORS yang (benar) tidak mengizinkannya.
  const ip = fakeIp();
  // Hanya Chromium: di Firefox, route() aktif membuat page.reload() sering menggantung (>30 dtk menunggu "load"); suite Firefox/WebKit membuat <10 room.
  if (browser.browserType().name() === "chromium") {
  await ctx.route("http://localhost:4000/**", (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }));
  }
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
  return {
    ctx,
    page,
    watch,
    done: async () => {
      await ctx.close();
      await own?.close();
    },
  };
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
