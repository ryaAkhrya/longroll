import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, openPerson } from "./kit";

/**
 * TC-XB (DEC-050) pada Firefox/WebKit tanpa perangkat: 3 peserta masuk lewat jalur "tanpa kamera" (SCR-04), presence,
 * kursor-bebas, reload memulihkan slot, keluar. WebRTC/capture/editor TIDAK diuji di sini (butuh kamera palsu/perangkat).
 */
test("lintas-browser: bikin room, 3 peserta gabung tanpa kamera, presence, reload, keluar", async ({ browser }, info) => {
  test.setTimeout(120_000);
  const names = ["Nadia", "Raka", "Sasa"];
  const people = [];
  for (const n of names) people.push(await openPerson(browser, info, n, { camera: false }));
  const [A, B, C] = people as [(typeof people)[number], (typeof people)[number], (typeof people)[number]];
  const code = await createRoom(A.page, "Nadia", false);
  await joinRoom(B.page, code, "Raka", false);
  await joinRoom(C.page, code, "Sasa", false);
  for (const p of people) await expect(p.page.getByText("3 dari 4 udah masuk")).toBeVisible({ timeout: 10_000 });
  await C.page.reload();
  await expect(C.page.getByText("3 dari 4 udah masuk")).toBeVisible({ timeout: 15_000 });
  await expect(C.page.getByRole("listitem", { name: /Kamera Sasa \(kamu\)/ })).toBeVisible();
  for (const p of people) {
    if (info.project.name.includes("mobile")) await p.page.getByRole("button", { name: "Menu room" }).click();
    await p.page.getByRole("button", { name: "Keluar dari room" }).filter({ visible: true }).first().click();
    await p.page.getByRole("button", { name: "Keluar", exact: true }).click();
    await p.page.waitForURL("http://localhost:3000/");
    expect(p.watch.csp, `CSP ${p.watch.name}`).toEqual([]);
    await p.ctx.close();
  }
});
