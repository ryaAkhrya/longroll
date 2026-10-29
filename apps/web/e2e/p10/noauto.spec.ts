import { expect, test } from "@playwright/test";
import { collectCsp, createRoom, joinRoom, openPerson, playingRemoteVideos, shutterName } from "./kit";
import type { Person } from "./kit";

/**
 * TC-CAP-015 (REQ-CAP): tanpa auto-accept. Setelah foto masuk review, 4 peserta DIAM selama ≥ 10 menit nyata:
 * tidak ada yang berstatus ACCEPTED, tidak ada yang tersingkir, layar review tetap, tidak ada lanjut otomatis ke shot/editor.
 * Setelah itu keputusan manual tetap bekerja. Hanya jalan bila P10_LONG=1 (memakan ±11 menit).
 */
test("TC-CAP-015: diam ≥ 10 menit di layar review → tidak ada auto-accept, semua tetap tersambung", async ({ browser }, info) => {
  test.skip(process.env.P10_LONG !== "1", "uji panjang 10 menit: set P10_LONG=1");
  test.skip(info.project.name !== "chromium-desktop", "satu proyek cukup");
  test.setTimeout(15 * 60_000);
  const people: Person[] = [];
  for (const n of ["Nadia", "Raka", "Sasa", "Bimo"]) people.push(await openPerson(browser, info, n));
  const [A, B, C, D] = people as [Person, Person, Person, Person];
  const code = await createRoom(A.page, "Nadia");
  await joinRoom(B.page, code, "Raka");
  await joinRoom(C.page, code, "Sasa");
  await joinRoom(D.page, code, "Bimo");
  for (const p of people) await expect.poll(() => playingRemoteVideos(p.page), { timeout: 45_000 }).toBe(3);
  await C.page.getByRole("button", { name: "Mulai vote mode" }).click();
  for (const p of people) await p.page.getByRole("radio", { name: /^Photo Grid\./ }).click();
  for (const p of people) await expect(p.page.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 20_000 });
  await C.page.getByRole("button", { name: shutterName }).click();
  const review = (p: Person) => p.page.getByTestId("review");
  for (const p of people) {
    await expect(review(p)).toBeVisible({ timeout: 60_000 });
    await expect(review(p).getByRole("button", { name: "Pakai ini" })).toBeEnabled({ timeout: 60_000 });
  }

  const t0 = Date.now();
  const TEN_MIN = 10 * 60_000 + 15_000;
  let checks = 0;
  while (Date.now() - t0 < TEN_MIN) {
    await A.page.waitForTimeout(60_000);
    checks++;
    for (const p of people) {
      await expect(review(p), `review hilang di ${p.watch.name} setelah ${Math.round((Date.now() - t0) / 1000)} dtk`).toBeVisible();
      expect(await review(p).getAttribute("data-my-status"), `${p.watch.name} ter-accept otomatis`).not.toBe("ACCEPTED");
      await expect(p.page.getByTestId("editor")).toHaveCount(0);
      await expect(p.page.getByRole("button", { name: "Keluar dari room" }).filter({ visible: true }).first()).toBeEnabled();
    }
    for (const p of people) {
      const others = p.page.locator('[data-testid^="other-"]');
      const statuses = await others.evaluateAll((els) => els.map((e) => e.getAttribute("data-status")));
      expect(statuses.includes("ACCEPTED"), `${p.watch.name} melihat peserta lain ter-accept otomatis: ${statuses.join(",")}`).toBe(false);
    }
  }
  console.log(`[noauto] ${checks} pemeriksaan selama ${Math.round((Date.now() - t0) / 1000)} dtk, tanpa auto-accept`);

  // Keputusan manual tetap bekerja setelah menunggu lama.
  for (const p of people) await review(p).getByRole("button", { name: "Pakai ini" }).click();
  for (const p of people) await expect(p.page.getByTestId("editor")).toBeVisible({ timeout: 60_000 });
  for (const p of people) {
    expect(await collectCsp(p)).toEqual([]);
    await p.done();
  }
});
