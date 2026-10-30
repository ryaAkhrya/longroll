import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectCsp, createRoom, joinRoom, openPerson, shutterName } from "./kit";

/**
 * QA visual responsif (Fase 1–2 UI). Bukan bagian suite rilis: aktif hanya dengan P10_UIQA=1.
 * Per viewport: landing, /r/new, lobby, vote, studio → screenshot + pemeriksaan otomatis
 * (scroll horizontal tak sengaja, kontrol bertabrakan, elemen keluar viewport, teks terpotong di bar studio).
 * Hasil: ${P10_UIQA_DIR}/<label>/<viewport>/*.png dan report.json. Contoh:
 *   P10_UIQA=1 P10_UIQA_LABEL=after npx playwright test -c playwright.p10.config.ts uiqa --project=chromium-desktop
 */
const LABEL = process.env.P10_UIQA_LABEL ?? "after";
const OUT = process.env.P10_UIQA_DIR ?? path.join("test-results", "uiqa");

const VIEWPORTS: { name: string; w: number; h: number; touch: boolean }[] = [
  { name: "m320x568", w: 320, h: 568, touch: true },
  { name: "m360x800", w: 360, h: 800, touch: true },
  { name: "m375x667", w: 375, h: 667, touch: true },
  { name: "m390x844", w: 390, h: 844, touch: true },
  { name: "m412x922", w: 412, h: 922, touch: true },
  { name: "m430x932", w: 430, h: 932, touch: true },
  { name: "m667x375-landscape", w: 667, h: 375, touch: true },
  { name: "m844x390-landscape", w: 844, h: 390, touch: true },
  { name: "t768x1024", w: 768, h: 1024, touch: true },
  { name: "t820x1180", w: 820, h: 1180, touch: true },
  { name: "t1024x768", w: 1024, h: 768, touch: true },
  { name: "d1280x720", w: 1280, h: 720, touch: false },
  { name: "d1366x768", w: 1366, h: 768, touch: false },
  { name: "d1440x900", w: 1440, h: 900, touch: false },
  { name: "d1920x1080", w: 1920, h: 1080, touch: false },
];
const ONLY = process.env.P10_UIQA_ONLY?.split(",");

interface Finding {
  kind: string;
  detail: string;
}

/** Pemeriksaan tata letak di browser. Mengembalikan temuan; tidak melempar. */
async function inspect(page: Page, scope: string | null): Promise<Finding[]> {
  return page.evaluate((scopeSel) => {
    const out: { kind: string; detail: string }[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const root = document.documentElement;
    if (root.scrollWidth > vw + 1) out.push({ kind: "h-scroll", detail: `scrollWidth ${root.scrollWidth} > ${vw}` });

    const name = (el: Element) => {
      const t = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28);
      return `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""}«${t}»`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
    };
    // Ilustrasi dekoratif (aria-hidden / role=img) sengaja menumpuk elemen; tidak dihitung.
    const decorative = (el: Element) => !!el.closest("[aria-hidden='true'], [role='img']");
    // Elemen yang tertutup lapisan lain (mis. sheet di atas dock) bukan "bertabrakan": hanya yang benar-benar tampil di atas dihitung.
    const onTop = (el: Element) => {
      const r = el.getBoundingClientRect();
      const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
      const y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
      const t = document.elementFromPoint(x, y);
      return !t || el.contains(t) || t.contains(el);
    };
    const rootEl: Element = scopeSel ? (document.querySelector(scopeSel) ?? document.body) : document.body;
    // Dialog modal terbuka (sheet + scrim): kontrol di belakangnya tidak interaktif, jadi bukan tumpang tindih yang dilihat pengguna.
    const modal = Array.from(document.querySelectorAll("[role=dialog]")).find(visible);
    const items = Array.from(rootEl.querySelectorAll("button, a[href], input, select, textarea, [role=button], [role=radio], [role=tab]")).filter((e) => visible(e) && !decorative(e) && (!modal || modal.contains(e)));
    const inHScroller = (el: Element) => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;
      }
      return false;
    };
    for (const el of items) {
      const r = el.getBoundingClientRect();
      if ((r.right > vw + 1 || r.left < -1) && !inHScroller(el)) out.push({ kind: "outside-x", detail: `${name(el)} [${Math.round(r.left)}..${Math.round(r.right)}] vw=${vw}` });
    }
    const hit = (a: DOMRect, b: DOMRect, minV = 2) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > minV;
    // Header sticky sengaja menutupi konten yang digulir di bawahnya; itu bukan tabrakan kontrol.
    const stickyPair = (a: Element, b: Element) => !!a.closest("header") !== !!b.closest("header");
    // Dalam wadah yang bisa digulir sendiri (overflow auto/scroll), elemen di bawah lipatan tetap terjangkau.
    const inScroller = (el: Element) => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (/(auto|scroll)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) return true;
      }
      return false;
    };
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i]!;
        const b = items[j]!;
        if (a.contains(b) || b.contains(a)) continue;
        if (!stickyPair(a, b) && hit(a.getBoundingClientRect(), b.getBoundingClientRect()) && onTop(a) && onTop(b)) out.push({ kind: "controls-overlap", detail: `${name(a)} × ${name(b)}` });
      }
    }
    // Teks bertabrakan (hanya elemen dengan teks langsung) di dalam scope bar/header.
    const texts = Array.from(rootEl.querySelectorAll("*")).filter(
      (el) => visible(el) && !decorative(el) && (!modal || modal.contains(el)) && Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0),
    );
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i]!;
        const b = texts[j]!;
        if (a.contains(b) || b.contains(a)) continue;
        if (!stickyPair(a, b) && hit(a.getBoundingClientRect(), b.getBoundingClientRect(), 6) && onTop(a) && onTop(b)) out.push({ kind: "text-overlap", detail: `${name(a)} × ${name(b)}` });
      }
      const el = texts[i]!;
      const cs = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(cs.overflowX) && cs.textOverflow !== "ellipsis" && el.clientWidth > 0) {
        out.push({ kind: "text-clipped", detail: `${name(el)} ${el.scrollWidth}>${el.clientWidth}` });
      }
    }
    // Aksi utama keluar layar bawah pada layar tanpa scroll.
    if (root.scrollHeight <= vh + 1) {
      for (const el of items) {
        const r = el.getBoundingClientRect();
        if (r.bottom > vh + 1 && !inScroller(el)) out.push({ kind: "outside-y", detail: `${name(el)} bottom=${Math.round(r.bottom)} vh=${vh}` });
      }
    }
    return out;
  }, scope);
}

/** Alur penuh sampai editor dan hasil (viewport kunci saja; ±90 dtk per viewport). Aktif dengan P10_UIQA_DEEP=1. */
const DEEP = ["m320x568", "m390x844", "m844x390-landscape", "t820x1180", "d1366x768"];
test.describe("UI QA alur penuh", () => {
  test.skip(process.env.P10_UIQA !== "1" || process.env.P10_UIQA_DEEP !== "1", "set P10_UIQA=1 P10_UIQA_DEEP=1");
  for (const vp of VIEWPORTS.filter((v) => DEEP.includes(v.name))) {
    test(`deep ${vp.name}`, async ({ browser }, info) => {
      test.skip(info.project.name !== "chromium-desktop", "satu proyek");
      test.setTimeout(300_000);
      const dir = path.join(OUT, LABEL, vp.name);
      fs.mkdirSync(dir, { recursive: true });
      const report: Record<string, Finding[]> = {};
      const shot = async (page: Page, id: string, full = false) => {
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(dir, `${id}.png`), fullPage: full });
        report[id] = await inspect(page, null);
      };
      const A = await openPerson(browser, info, "Alfa", { fakeVideoIdx: 0 });
      await A.page.setViewportSize({ width: vp.w, height: vp.h });
      const B = await openPerson(browser, info, "Beta", { fakeVideoIdx: 1 });
      try {
        const code = await createRoom(A.page, "Alfa");
        await joinRoom(B.page, code, "Beta");
        await expect(A.page.getByText("Beta").first()).toBeVisible({ timeout: 20_000 });
        await A.page.getByRole("button", { name: "Mulai vote mode" }).click();
        for (const p of [A, B]) await p.page.getByRole("radio", { name: /^Photo Strip\./ }).click();
        await expect(A.page.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 20_000 });
        for (let i = 0; i < 4; i++) {
          await expect(A.page.getByRole("button", { name: shutterName })).toBeEnabled({ timeout: 30_000 });
          await A.page.getByRole("button", { name: shutterName }).click();
          // DEC-026: bila ada peserta yang belum menandai "Siap", produk meminta konfirmasi "tetap mulai?".
          await A.page.getByRole("button", { name: "Tetap mulai" }).click({ timeout: 2_500 }).catch(() => undefined);
          for (const p of [A, B]) {
            await expect(p.page.getByTestId("review")).toBeVisible({ timeout: 60_000 });
            await expect(p.page.getByTestId("review").getByRole("button", { name: "Pakai ini" })).toBeEnabled({ timeout: 60_000 });
          }
          if (i === 0) await shot(A.page, "10-review-shot1-others");
          for (const p of [A, B]) await p.page.getByTestId("review").getByRole("button", { name: "Pakai ini" }).click();
        }
        await expect(A.page.getByTestId("editor")).toBeVisible({ timeout: 60_000 });
        await shot(A.page, "11-editor");
        await editorTool(A.page, "Atur");
        await expect(A.page.getByRole("tab", { name: "Dasar" })).toBeVisible();
        await shot(A.page, "12a-editor-atur");
        await editorTool(A.page, "Frame");
        await expect(A.page.getByRole("group", { name: "Kategori frame" })).toBeVisible();
        await shot(A.page, "12b-editor-frame");
        await editorTool(A.page, "Stiker");
        await shot(A.page, "12-editor-stiker");
        await A.page.getByRole("button", { name: /^Selesai( edit)?$/ }).first().click();
        await expect(A.page.getByRole("dialog", { name: /Selesai buat semua/ })).toBeVisible();
        await shot(A.page, "13-editor-confirm");
        await A.page.getByRole("dialog").getByRole("button", { name: /^Selesai$/ }).click();
        await expect(A.page.getByTestId("result-screen")).toBeVisible({ timeout: 30_000 });
        await expect(A.page.getByTestId("result-preview")).toBeVisible({ timeout: 30_000 });
        await shot(A.page, "14-result");
        await shot(A.page, "15-result-full", true);
      } finally {
        fs.writeFileSync(path.join(dir, "report-deep.json"), JSON.stringify(report, null, 2));
        await A.done();
        await B.done();
      }
    });
  }
});

/** Buka alat studio (Frame/Layout/…): rail di desktop, sheet "Alat" di mobile. */
async function studioTool(page: Page, label: string) {
  const sheet = page.getByRole("dialog", { name: /Alat|Frame|Layout|Filter|Kameraku/ });
  if (await page.getByRole("button", { name: "Alat", exact: true }).isVisible().catch(() => false)) {
    if (!(await sheet.isVisible().catch(() => false))) await page.getByRole("button", { name: "Alat", exact: true }).click();
    const back = page.getByRole("button", { name: "Semua alat" });
    if (await back.isVisible().catch(() => false)) await back.click();
    await page.getByRole("button", { name: new RegExp(`^${label}`) }).filter({ visible: true }).first().click();
    return;
  }
  await page.getByRole("button", { name: label, exact: true }).filter({ visible: true }).first().click();
}
/** Buka alat editor: navigation (desktop) atau toolbar (mobile). */
async function editorTool(page: Page, label: string) {
  // Mobile: sheet panel yang terbuka menutupi dock; tutup dulu seperti yang dilakukan pengguna.
  const sheet = page.getByRole("dialog").getByRole("button", { name: "Tutup" });
  if (await sheet.isVisible().catch(() => false)) await sheet.click();
  const bar = page.getByRole("navigation", { name: "Alat editor" }).or(page.getByRole("toolbar", { name: "Alat editor" }));
  await bar.getByRole("button", { name: new RegExp(`^${label}`) }).filter({ visible: true }).first().click();
}

test.describe("UI QA responsif", () => {
  test.skip(process.env.P10_UIQA !== "1", "set P10_UIQA=1");

  for (const vp of VIEWPORTS) {
    test(`viewport ${vp.name}`, async ({ browser }, info) => {
      test.skip(info.project.name !== "chromium-desktop", "satu proyek: viewport diatur per konteks");
      test.skip(!!ONLY && !ONLY.includes(vp.name), "difilter P10_UIQA_ONLY");
      test.setTimeout(180_000);
      const dir = path.join(OUT, LABEL, vp.name);
      fs.mkdirSync(dir, { recursive: true });
      const report: Record<string, Finding[]> = {};
      const shot = async (page: Page, id: string, full = false, scope: string | null = null) => {
        await page.waitForTimeout(350);
        await page.screenshot({ path: path.join(dir, `${id}.png`), fullPage: full });
        report[id] = await inspect(page, scope);
      };

      const A = await openPerson(browser, info, "Alfa", { fakeVideoIdx: 0 });
      await A.page.setViewportSize({ width: vp.w, height: vp.h });
      const B = await openPerson(browser, info, "Beta", { fakeVideoIdx: 1 });
      try {
        await A.page.goto("/");
        await expect(A.page.getByRole("heading", { level: 1 })).toBeVisible();
        await shot(A.page, "01-landing-fold");
        await shot(A.page, "02-landing-full", true);

        await A.page.goto("/r/new");
        await expect(A.page.getByLabel("Nama panggilan")).toBeVisible();
        await shot(A.page, "03-create");

        // Alur room memakai helper yang sama dengan E2E (A dibuat via /r/new).
        const code = await createRoom(A.page, "Alfa");
        await shot(A.page, "04-lobby-1");
        await joinRoom(B.page, code, "Beta");
        await expect(A.page.getByText("Beta").first()).toBeVisible({ timeout: 20_000 });
        await shot(A.page, "05-lobby-2");

        await A.page.getByRole("button", { name: "Mulai vote mode" }).click();
        await expect(A.page.getByRole("radiogroup", { name: "Mode foto" })).toBeVisible();
        await shot(A.page, "06-vote");
        for (const p of [A, B]) await p.page.getByRole("radio", { name: /^Photo Strip\./ }).click();
        await expect(A.page.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 20_000 });
        await shot(A.page, "07-studio");

        // Panel studio Frame & Layout (galeri kategori, susunan baru).
        await studioTool(A.page, "Frame");
        await expect(A.page.getByRole("group", { name: "Kategori frame" })).toBeVisible();
        await shot(A.page, "07b-studio-frame");
        await studioTool(A.page, "Layout");
        await expect(A.page.getByRole("radiogroup", { name: "Susunan" })).toBeVisible();
        await shot(A.page, "07c-studio-layout");
        const closeSheet = A.page.getByRole("dialog").getByRole("button", { name: "Tutup" });
        if (await closeSheet.isVisible().catch(() => false)) await closeSheet.click();
        else await studioTool(A.page, "Layout");
        // Mobile: buka sheet alat.
        const tools = A.page.getByRole("button", { name: "Alat", exact: true });
        if (await tools.isVisible().catch(() => false)) {
          await tools.click();
          await shot(A.page, "08-studio-tools-sheet");
          await A.page.keyboard.press("Escape");
        }

        // Ambil foto → countdown → review.
        await A.page.getByRole("button", { name: shutterName }).click();
        await expect(A.page.getByTestId("review")).toBeVisible({ timeout: 60_000 });
        await shot(A.page, "09-review");
      } finally {
        fs.writeFileSync(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
        const csp = await collectCsp(A).catch(() => []);
        if (csp.length) fs.writeFileSync(path.join(dir, "csp.json"), JSON.stringify(csp, null, 2));
        await A.done();
        await B.done();
      }
    });
  }
});
