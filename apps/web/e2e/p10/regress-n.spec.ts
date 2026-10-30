import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, openPerson, shutterName } from "./kit";
import type { Person } from "./kit";
import { editorShot, finishAndExport, luma, tool } from "./phase3kit";

/**
 * Regresi alur penuh untuk 2, 3, dan 4 peserta (build produksi, kamera palsu): Vote → Capture → Review → Edit → Export.
 * Di editor satu peserta menambah stiker, peserta lain memakai preset + penyesuaian; semua melihat hasil yang sama, dan
 * PNG export sama dengan tampilan editor (satu jalur render).
 */
const NAMES = ["Nadia", "Raka", "Sasa", "Bimo"];

for (const n of [2, 3, 4]) {
  test(`Regresi · ${n} peserta: vote → capture → review → edit → export`, async ({ browser }, info) => {
    test.skip(info.project.name !== "chromium-desktop", "satu proyek cukup (kamera palsu, layar desktop)");
    test.setTimeout(600_000);
    const scratch = await (await browser.newContext()).newPage();
    const people: Person[] = [];
    for (let i = 0; i < n; i++) people.push(await openPerson(browser, info, NAMES[i]!, { fakeVideoIdx: i }));
    const [A, B] = people as [Person, Person];

    // Room + gabung.
    const code = await createRoom(A.page, NAMES[0]!);
    for (let i = 1; i < n; i++) await joinRoom(people[i]!.page, code, NAMES[i]!);
    for (const p of people) for (let i = 0; i < n; i++) await expect(p.page.getByText(NAMES[i]!).first()).toBeVisible({ timeout: 30_000 });

    // Vote: semua memilih Photo Strip.
    await A.page.getByRole("button", { name: "Mulai vote mode" }).click();
    for (const p of people) await p.page.getByRole("radio", { name: /^Photo Strip\./ }).click();
    for (const p of people) await expect(p.page.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 30_000 });

    // Capture + review sampai editor terbuka untuk semua (maks. 8 shot).
    let shots = 0;
    while (shots < 8 && !(await A.page.getByTestId("editor").isVisible().catch(() => false))) {
      await expect(A.page.getByRole("button", { name: shutterName })).toBeEnabled({ timeout: 40_000 });
      await A.page.getByRole("button", { name: shutterName }).click();
      await A.page.getByRole("button", { name: "Tetap mulai" }).click({ timeout: 2_500 }).catch(() => undefined);
      for (const p of people) {
        await expect(p.page.getByTestId("review")).toBeVisible({ timeout: 90_000 });
        await expect(p.page.getByTestId("review").getByRole("button", { name: "Pakai ini" })).toBeEnabled({ timeout: 90_000 });
      }
      for (const p of people) await p.page.getByTestId("review").getByRole("button", { name: "Pakai ini" }).click();
      shots++;
      await A.page.waitForTimeout(400);
    }
    for (const p of people) await expect(p.page.getByTestId("editor")).toBeVisible({ timeout: 90_000 });

    // Edit: A menambah stiker; semua melihat jumlah elemen yang sama.
    const count = async (p: Person) => Number(await p.page.getByTestId("editor-canvas").getAttribute("data-elements"));
    const before = await count(A);
    await tool(A, "Stiker").click();
    await A.page.getByRole("button", { name: /^Tambah stiker/ }).first().click();
    for (const p of people) await expect.poll(() => count(p), { timeout: 20_000 }).toBe(before + 1);

    // B memakai preset Hangat + eksposur; A dan peserta lain melihat perubahan (lebih terang).
    await A.page.keyboard.press("Escape");
    await A.page.waitForTimeout(700);
    const l0 = (await luma(scratch, await editorShot(A))).mean;
    await tool(B, "Atur").click();
    await B.page.getByRole("radio", { name: /^Hangat/ }).click();
    const exposure = B.page.getByLabel("Eksposur");
    await exposure.fill("50");
    await exposure.blur();
    for (const p of people) await expect.poll(async () => (await luma(scratch, await editorShot(p))).mean, { timeout: 20_000 }).toBeGreaterThan(l0 + 2);

    // Selesai → hasil untuk semua → export; PNG sama dengan tampilan editor terakhir.
    await A.page.keyboard.press("Escape");
    await A.page.waitForTimeout(700);
    const editorLuma = (await luma(scratch, await editorShot(A))).mean;
    const png = await finishAndExport(A, B, scratch);
    for (const p of people) await expect(p.page.getByTestId("result-screen")).toBeVisible({ timeout: 40_000 });
    const exportLuma = (await luma(scratch, png)).mean;
    const rel = Math.abs(editorLuma - exportLuma) / Math.max(1, editorLuma);
    console.log(`[regress-${n}] shots=${shots} luma awal=${l0.toFixed(1)} editor=${editorLuma.toFixed(1)} export=${exportLuma.toFixed(1)} selisih=${(rel * 100).toFixed(1)}%`);
    expect(rel, "export harus sama dengan tampilan editor").toBeLessThan(0.05);

    for (const p of people) expect(p.watch.pageErrors).toEqual([]);
    for (const p of people) await p.done();
    await scratch.context().close();
  });
}
