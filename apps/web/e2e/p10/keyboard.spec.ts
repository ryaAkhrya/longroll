import fs from "node:fs";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { collectCsp, joinRoom, openPerson, playingRemoteVideos, shutterName } from "./kit";
import type { Person } from "./kit";

/**
 * TC-A11Y-002 — keyboard-only: satu peserta (Nadia) menyelesaikan seluruh alur HANYA dengan Tab/Shift+Tab/Enter/Space/panah:
 * landing → bikin room → cek kamera → lobby → mulai vote → pilih mode (panah + Spasi) → shutter → "Pakai ini" → editor (panel
 * Stiker) → "Selesai edit" → unduh. Tiga peserta lain memakai mouse hanya sebagai lawan main. Fokus harus terlihat (outline) di
 * setiap berhenti. Tidak ada `click()`/`focus()` programatik pada Nadia.
 */
const label = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "";
    const labels = (el as HTMLInputElement).labels;
    return (el.getAttribute("aria-label") || (labels && labels[0]?.textContent) || el.textContent || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ");
  });

/** Tab sampai elemen aktif cocok; gagal bila lebih dari `max` langkah (berarti tidak terjangkau keyboard). */
async function tabTo(page: Page, match: RegExp, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (match.test(await label(page))) {
      const visible = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (cs.outlineStyle !== "none" || cs.boxShadow !== "none" || el.matches(":focus-visible"));
      });
      expect(visible, `fokus tidak terlihat pada "${await label(page)}"`).toBe(true);
      return;
    }
  }
  throw new Error(`"${match}" tidak terjangkau dengan Tab dalam ${max} langkah (terakhir: "${await label(page)}")`);
}

test("TC-A11Y-002: satu peserta menyelesaikan alur penuh hanya dengan keyboard", async ({ browser }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "keyboard fisik: desktop saja");
  test.setTimeout(300_000);
  const kb = await openPerson(browser, info, "Nadia");
  const others: Person[] = [];
  for (const [i, n] of ["Raka", "Sasa", "Bimo"].entries()) others.push(await openPerson(browser, info, n, { fakeVideoIdx: i + 1 }));
  const page = kb.page;

  // Landing → bikin room.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await tabTo(page, /bikin room/i);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/r\/new$/);
  // Nama (autofocus) → submit dengan Enter.
  await expect.poll(() => label(page), { timeout: 10_000 }).toMatch(/Nama panggilan/i);
  await page.keyboard.type("Nadia");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/r\/[A-HJ-NP-Z2-9]{6}$/);
  const code = page.url().split("/r/")[1]!;

  // Cek kamera → lobby.
  await expect(page.getByRole("heading", { name: /Cek kamera/ })).toBeVisible({ timeout: 15_000 });
  await tabTo(page, /Nyalain kamera/);
  await page.keyboard.press("Enter");
  await tabTo(page, /Masuk ke lobby/);
  await expect(page.getByRole("button", { name: "Masuk ke lobby" })).toBeEnabled({ timeout: 15_000 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /geng/i })).toBeVisible();

  for (const [p, n] of [[others[0]!, "Raka"], [others[1]!, "Sasa"], [others[2]!, "Bimo"]] as const) await joinRoom(p.page, code, n);
  for (const p of [kb, ...others]) await expect.poll(() => playingRemoteVideos(p.page), { timeout: 45_000 }).toBe(3);

  // Vote: mulai (keyboard) → panah ke Photo Grid → Spasi.
  await tabTo(page, /Mulai vote mode/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("radiogroup", { name: "Mode foto" })).toBeVisible();
  await tabTo(page, /^(Photo Strip|Group Shot|Photo Grid|Freeform Collage)\./);
  for (let i = 0; i < 5 && !/^Photo Grid\./.test(await label(page)); i++) await page.keyboard.press("ArrowRight");
  expect(await label(page)).toMatch(/^Photo Grid\./);
  await page.keyboard.press("Space");
  for (const p of others) await p.page.getByRole("radio", { name: /^Photo Grid\./ }).click();
  await expect(page.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 20_000 });

  // Capture: shutter (keyboard), lalu "Pakai ini" (keyboard). Lawan main menerima dengan mouse.
  await tabTo(page, shutterName);
  await page.keyboard.press("Enter");
  const review = (p: Person) => p.page.getByTestId("review");
  for (const p of [kb, ...others]) {
    await expect(review(p)).toBeVisible({ timeout: 60_000 });
    await expect(review(p).getByRole("button", { name: "Pakai ini" })).toBeEnabled({ timeout: 60_000 });
  }
  await tabTo(page, /^Pakai ini/);
  await page.keyboard.press("Enter");
  for (const p of others) await review(p).getByRole("button", { name: "Pakai ini" }).click();

  // Editor: panel Stiker, tambah stiker, selesai.
  await expect(page.getByTestId("editor")).toBeVisible({ timeout: 60_000 });
  const count = async () => Number(await page.getByTestId("editor-canvas").getAttribute("data-elements"));
  const before = await count();
  await tabTo(page, /^Stiker/);
  await page.keyboard.press("Enter");
  await tabTo(page, /^Tambah stiker /);
  await page.keyboard.press("Enter");
  await expect.poll(count, { timeout: 10_000 }).toBe(before + 1);
  await tabTo(page, /^Selesai edit/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: /Selesai buat semua/ })).toBeVisible();
  await tabTo(page, /^Selesai$/);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("result-screen")).toBeVisible({ timeout: 30_000 });

  // Hasil: Unduh dengan keyboard.
  await expect(page.getByTestId("result-preview")).toBeVisible({ timeout: 30_000 });
  await tabTo(page, /^Unduh$/);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.keyboard.press("Enter")]);
  expect(fs.readFileSync(await dl.path()).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

  expect(await collectCsp(kb)).toEqual([]);
  for (const p of [kb, ...others]) await p.done();
});
