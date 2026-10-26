import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createRoom, joinRoom, newPage, playingRemoteVideos } from "./helpers";

/**
 * Regresi terintegrasi P01–P05 (satu alur): bikin room → 4 konteks gabung (kamera palsu Chromium) →
 * preview + track remote WebRTC → semua vote → mode terkunci → studio → frame/layout/filter tersinkron →
 * kontrol kamera hanya milik sendiri → reload & pulih → semua keluar → room bubar (grace 6 s di E2E).
 * Kode room dicetak (`LR_REGRESSION_CODE`) untuk verifikasi pembersihan data di Neon development.
 */
const out = (p: Page) => p.getByRole("img", { name: /^(Hasil sementara|Pratinjau)/ }).first();

test("regresi P01–P05: room → kamera → WebRTC → vote → studio → sinkron → reload → keluar → bubar", async ({ browser }) => {
  test.setTimeout(540_000);
  const ps = await Promise.all([0, 1, 2, 3].map(() => newPage(browser, { width: 1366, height: 860 })));
  const [a, b, c, d] = ps.map((p) => p.page) as [Page, Page, Page, Page];
  const code = await createRoom(a, "Nadia");
  console.log(`LR_REGRESSION_CODE=${code}`);
  await joinRoom(b, code, "Raka");
  await joinRoom(c, code, "Sasa");
  await joinRoom(d, code, "Bimo");
  for (const p of [a, b, c, d]) await expect(p.getByText("4 dari 4 udah masuk")).toBeVisible();

  // P03: preview sendiri + 3 track remote berjalan di tiap klien.
  for (const p of [a, b, c, d]) await expect.poll(() => playingRemoteVideos(p), { timeout: 45_000 }).toBe(3);
  // Mikrofon tidak pernah diminta (DEC-076).
  const gum = (await a.evaluate(() => (window as unknown as { __gumCalls: { audio?: unknown }[] }).__gumCalls)) ?? [];
  expect(gum.length).toBeGreaterThan(0);
  expect(gum.every((g) => !g.audio)).toBe(true);

  // P04: semua vote, mode terkunci, masuk studio.
  await c.getByRole("button", { name: "Mulai vote mode" }).click();
  for (const p of [a, b, c, d]) await p.getByRole("radio", { name: /^Photo Grid\./ }).click();
  for (const p of [a, b, c, d]) await expect(p.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 10_000 });
  for (const p of [a, b, c, d]) await expect(out(p)).toHaveAttribute("data-slots", "4");

  // P05: frame bersama.
  await b.getByRole("button", { name: "Frame", exact: true }).click();
  await b.getByRole("option", { name: /^Scrapbook/ }).click();
  await b.getByRole("button", { name: "Pasang buat semua" }).click();
  for (const p of [a, c, d]) await expect(out(p)).toHaveAttribute("data-frame", "builtin/scrapbook@1");
  await b.getByRole("button", { name: "Frame", exact: true }).click();

  // Layout: 2 shot (Grid per orang = 8 cell), filter Film.
  await d.getByRole("button", { name: "Layout", exact: true }).click();
  await d.getByRole("button", { name: "Tambah shot" }).click();
  for (const p of [a, b, c]) await expect(out(p)).toHaveAttribute("data-slots", "8");
  await d.getByRole("button", { name: "Layout", exact: true }).click();
  await a.getByRole("button", { name: "Filter", exact: true }).click();
  await a.getByRole("radio", { name: "Film" }).click();
  for (const p of [b, c, d]) await expect(out(p)).toHaveAttribute("data-filter", "FILM");
  await a.getByRole("button", { name: "Filter", exact: true }).click();

  // Kamera: kontrol hanya di kartu sendiri (REQ-CAM-13).
  for (const p of [a, b, c, d]) await expect(p.getByRole("button", { name: "Buka pengaturan Kameraku" })).toHaveCount(1);
  await a.getByRole("button", { name: "Kamera", exact: true }).click();
  await expect(a.getByText("Pengaturan ini cuma ngubah kamera kamu.", { exact: false })).toBeVisible();
  await a.getByRole("button", { name: "Kamera", exact: true }).click();

  // Reload satu peserta → studio & media pulih.
  await c.reload();
  await expect(c.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 15_000 });
  await expect(out(c)).toHaveAttribute("data-frame", "builtin/scrapbook@1");
  await expect(out(c)).toHaveAttribute("data-slots", "8");
  await expect(out(c)).toHaveAttribute("data-filter", "FILM");
  await expect.poll(() => playingRemoteVideos(c), { timeout: 45_000 }).toBe(3);

  // Semua keluar → room bubar setelah grace.
  for (const p of [a, b, c, d]) {
    await p.getByRole("button", { name: "Keluar dari room" }).filter({ visible: true }).first().click();
    await p.getByRole("button", { name: "Keluar", exact: true }).click();
    await p.waitForURL("http://localhost:3000/");
  }
  const e = await newPage(browser, { camera: false });
  await e.page.waitForTimeout(8_000);
  await e.page.goto(`/r/${code}`);
  await expect(e.page.getByRole("heading", { name: /udah bubar/ })).toBeVisible();
  for (const p of [...ps, e]) await p.ctx.close();
});
