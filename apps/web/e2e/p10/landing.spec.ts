import { expect, test } from "@playwright/test";
import { axeScan, openPerson } from "./kit";

/** P10-A — P01 (landing/responsif/routing) + aksesibilitas halaman publik + reduced motion + keyboard dasar. */
const VIEWPORTS = [
  { w: 320, h: 640 },
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 1366, h: 860 },
  { w: 1920, h: 1080 },
];

for (const vp of VIEWPORTS) {
  test(`landing ${vp.w}x${vp.h}: tanpa scroll horizontal, CTA terlihat`, async ({ browser }, info) => {
    const p = await openPerson(browser, info, "Uji", { camera: false });
    await p.page.setViewportSize({ width: vp.w, height: vp.h });
    await p.page.goto("/");
    await expect(p.page.getByRole("heading", { level: 1 })).toBeVisible();
    const over = await p.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(over, "overflow horizontal (px)").toBeLessThanOrEqual(0);
    await expect(p.page.getByRole("link", { name: /Bikin room/ }).first()).toBeVisible();
    expect(p.watch.pageErrors).toEqual([]);
    await p.ctx.close();
  });
}

test("routing: CTA → /r/new, kode tak ada → layar tidak ketemu, 404 aplikasi", async ({ browser }, info) => {
  const p = await openPerson(browser, info, "Uji", { camera: false });
  await p.page.goto("/");
  await p.page.getByRole("link", { name: /Bikin room/ }).first().click();
  await expect(p.page).toHaveURL(/\/r\/new$/);
  await p.page.goto("/r/ZZZZZZ");
  await expect(p.page.getByRole("heading", { level: 1 })).toBeVisible();
  await p.page.goto("/halaman-tidak-ada");
  await expect(p.page.getByRole("heading", { level: 1 })).toBeVisible();
  await p.ctx.close();
});

test("a11y axe (WCAG A/AA): landing, bikin room, kode tak ada, 404 — 0 serious/critical", async ({ browser }, info) => {
  const p = await openPerson(browser, info, "Uji", { camera: false });
  const all: string[] = [];
  for (const path of ["/", "/r/new", "/r/ZZZZZZ", "/halaman-tidak-ada"]) {
    await p.page.goto(path);
    await expect(p.page.getByRole("heading", { level: 1 })).toBeVisible();
    all.push(...(await axeScan(p.page, path)));
  }
  expect(all).toEqual([]);
  await p.ctx.close();
});

test("TC-A11Y-004: prefers-reduced-motion mematikan animasi tak terbatas di landing", async ({ browser }, info) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: info.project.use.viewport ?? { width: 1366, height: 860 } });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const infinite = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running" && a.effect?.getTiming().iterations === Infinity)
      .map((a) => String((a.effect as KeyframeEffect).target?.className ?? "").slice(0, 40)),
  );
  expect(infinite).toEqual([]);
  await ctx.close();
});

test("keyboard: Tab menjangkau CTA dan Enter membuka form bikin room", async ({ browser }, info) => {
  test.skip(info.project.name.includes("mobile"), "keyboard fisik tidak relevan di mobile");
  test.skip(info.project.name.includes("webkit"), "Safari/WebKit tidak memfokuskan tautan dengan Tab secara default (pengaturan sistem)");
  const p = await openPerson(browser, info, "Uji", { camera: false });
  await p.page.goto("/");
  let hit = false;
  for (let i = 0; i < 25 && !hit; i++) {
    await p.page.keyboard.press("Tab");
    hit = await p.page.evaluate(() => /bikin room/i.test(document.activeElement?.textContent ?? "") && document.activeElement?.tagName === "A");
  }
  expect(hit).toBe(true);
  await p.page.keyboard.press("Enter");
  await expect(p.page).toHaveURL(/\/r\/new$/);
  await p.ctx.close();
});
