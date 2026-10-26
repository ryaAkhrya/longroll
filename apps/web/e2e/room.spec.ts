import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, newPage, passCameraCheck } from "./helpers";

/**
 * IC-1 (P02 §16) dengan 4 konteks browser terpisah (cookie terpisah = 4 peserta):
 * join, presence, kursor, reload, takeover, keluar, peserta ke-5, grace → room bubar.
 * Server realtime memakai grace 6 s & hold 4 s (lihat playwright.config.ts).
 */

test("4 peserta: join, presence, kursor, reload, takeover, keluar, penuh, bubar", async ({ browser }) => {
  const a = await newPage(browser);
  const b = await newPage(browser);
  const c = await newPage(browser);
  const d = await newPage(browser);

  const code = await createRoom(a.page, "Nadia", false);
  await joinRoom(b.page, code, "Raka", false);
  await joinRoom(c.page, code, "Sasa", false);
  await joinRoom(d.page, code, "Bimo", false);

  // Presence ≤ 2 s di semua klien.
  for (const p of [a, b, c, d]) await expect(p.page.getByText("4 dari 4 udah masuk")).toBeVisible({ timeout: 2_000 });

  // Peserta ke-5 ditolak.
  const e = await newPage(browser);
  await e.page.goto(`/r/${code}`);
  await expect(e.page.getByText("Udah 4 orang di dalem.")).toBeVisible();
  await e.ctx.close();

  // Kursor desktop (permukaan lobby dev).
  const grid = a.page.getByRole("list", { name: "Peserta room" });
  const box = (await grid.boundingBox())!;
  await a.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await a.page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 5 });
  await expect(b.page.locator('[aria-hidden="true"]').getByText("Nadia", { exact: true })).toBeVisible({ timeout: 2_000 });

  // Reload memulihkan slot (warna & nama) ≤ 10 s.
  await d.page.reload();
  await expect(d.page.getByText("4 dari 4 udah masuk")).toBeVisible({ timeout: 10_000 });
  await expect(d.page.getByRole("listitem", { name: /Kamera Bimo \(kamu\)/ })).toBeVisible();

  // Multi-tab takeover.
  const b2 = await b.ctx.newPage();
  await b2.goto(`/r/${code}`);
  await passCameraCheck(b2, false);
  await expect(b2.getByText("4 dari 4 udah masuk")).toBeVisible();
  await expect(b.page.getByText("LONGROLL dibuka")).toBeVisible();
  await b.page.getByRole("button", { name: "Pakai di sini" }).click();
  await expect(b.page.getByText("4 dari 4 udah masuk")).toBeVisible();

  // Keluar dengan konfirmasi.
  await c.page.getByRole("button", { name: "Keluar dari room" }).click();
  await c.page.getByRole("button", { name: "Keluar", exact: true }).click();
  await c.page.waitForURL("http://localhost:3000/");
  await expect(a.page.getByText("3 dari 4 udah masuk")).toBeVisible({ timeout: 2_000 });

  // Semua pergi → grace (6 s) → room bubar (SCR-21).
  for (const p of [a, b, d]) await p.ctx.close();
  await c.page.waitForTimeout(8_000);
  await c.page.goto(`/r/${code}`);
  await expect(c.page.getByRole("heading", { name: /udah bubar/ })).toBeVisible();
  await c.ctx.close();
});

test("kode salah di landing menampilkan error inline", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Kode room").fill("zzzzz9");
  await page.getByRole("button", { name: "Gabung", exact: true }).click();
  await expect(page.getByText(/gak ketemu/)).toBeVisible();
});
