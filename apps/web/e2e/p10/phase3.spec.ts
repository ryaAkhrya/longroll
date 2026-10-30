import { expect, test } from "@playwright/test";
import { axeScan, collectCsp } from "./kit";
import type { Person } from "./kit";
import { editorShot, finishAndExport, luma, pixelAt, toEditor, tool } from "./phase3kit";

/**
 * Phase 3 — studio kreatif di browser nyata (build produksi, kamera palsu): penyesuaian foto non-destruktif tersinkron antar
 * peserta, reset, keyboard, bertahan setelah reload, dan HASIL EXPORT sama dengan yang terlihat di editor; frame baru
 * benar-benar masuk ke export; susunan layout baru; stiker baru tersinkron.
 */

test("Phase 3 · atur foto: sinkron antar peserta, reset, keyboard, tahan reload, dan export = tampilan editor", async ({ browser }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "satu proyek cukup (kamera palsu, layar desktop)");
  test.setTimeout(420_000);
  const scratch = await (await browser.newContext()).newPage();
  const { A, B } = await toEditor(browser, info, /^Photo Strip\./, 4);

  // Panel "Atur" tersedia dan rapi (tanpa overflow horizontal).
  await tool(A, "Atur").click();
  await expect(A.page.getByRole("tab", { name: "Dasar" })).toBeVisible();
  for (const name of ["Dasar", "Cahaya", "Warna", "Efek"]) await expect(A.page.getByRole("tab", { name })).toBeVisible();
  const overflow = await A.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Navigasi keyboard tab (panah/Home/End) + tab hanya satu yang tabbable (roving tabindex).
  await A.page.getByRole("tab", { name: "Dasar" }).focus();
  await A.page.keyboard.press("ArrowRight");
  await expect(A.page.getByRole("tab", { name: "Cahaya" })).toBeFocused();
  await expect(A.page.getByRole("tab", { name: "Cahaya" })).toHaveAttribute("aria-selected", "true");
  await A.page.keyboard.press("End");
  await expect(A.page.getByRole("tab", { name: "Efek" })).toBeFocused();
  await A.page.keyboard.press("Home");
  await expect(A.page.getByRole("tab", { name: "Dasar" })).toHaveAttribute("aria-selected", "true");
  expect(await A.page.getByRole("tab", { selected: false }).evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex >= 0).length)).toBe(0);
  // Axe (WCAG A/AA) pada editor dengan panel Atur terbuka: 0 pelanggaran serius/kritis.
  expect(await axeScan(A.page, "editor+atur")).toEqual([]);

  // Luminans awal (netral) di kedua peserta.
  await A.page.waitForTimeout(800);
  const base = await luma(scratch, await editorShot(A));
  const baseB = await luma(scratch, await editorShot(B));

  // Eksposur +60 lewat input (fill + blur = komit) → A dan B sama-sama lebih terang.
  const exposure = A.page.getByLabel("Eksposur");
  await exposure.fill("60");
  await exposure.blur();
  await expect.poll(async () => (await luma(scratch, await editorShot(A))).mean, { timeout: 15_000 }).toBeGreaterThan(base.mean + 2);
  await expect.poll(async () => (await luma(scratch, await editorShot(B))).mean, { timeout: 15_000 }).toBeGreaterThan(baseB.mean + 2);

  // Suhu warna lewat tab "Warna" dan keyboard (End = nilai maksimum, komit saat tombol dilepas).
  await A.page.getByRole("tab", { name: "Warna" }).click();
  const temp = A.page.getByLabel("Suhu warna");
  await temp.focus();
  await A.page.keyboard.press("End");
  await expect(temp).toHaveValue("100");
  await expect(temp).toHaveAttribute("aria-valuetext", "+100");
  await expect.poll(() => A.page.getByRole("tab", { name: "Warna" }).locator("[aria-label='ada perubahan']").count()).toBe(1);

  // B melihat nilai tersimpan setelah reload (state dari server, bukan hanya memori).
  await B.page.reload();
  await expect(B.page.getByTestId("editor")).toBeVisible({ timeout: 40_000 });
  await tool(B, "Atur").click();
  await expect(B.page.getByLabel("Eksposur")).toHaveValue("60");
  await B.page.getByRole("tab", { name: "Warna" }).click();
  await expect(B.page.getByLabel("Suhu warna")).toHaveValue("100");

  // Konsistensi pratinjau ↔ export: ambil tampilan editor TERAKHIR (sebelum selesai), lalu export PNG dan bandingkan.
  await A.page.keyboard.press("Escape"); // pastikan tak ada seleksi/handle di atas foto
  await A.page.waitForTimeout(600);
  const editorLuma = (await luma(scratch, await editorShot(A))).mean;
  const png = await finishAndExport(A, B, scratch);
  const exportLuma = (await luma(scratch, png)).mean;
  const rel = Math.abs(editorLuma - exportLuma) / Math.max(1, editorLuma);
  console.log(`[p3] luma awal=${base.mean.toFixed(1)} editor=${editorLuma.toFixed(1)} export=${exportLuma.toFixed(1)} selisih=${(rel * 100).toFixed(1)}%`);
  expect(editorLuma).toBeGreaterThan(base.mean + 2); // adjustment memang terlihat
  expect(rel, "export harus sama dengan tampilan editor").toBeLessThan(0.05);

  // Tidak ada pelanggaran CSP / error halaman dari jalur baru.
  expect(await collectCsp(A)).toEqual([]);
  expect(A.watch.pageErrors).toEqual([]);
  expect(B.watch.pageErrors).toEqual([]);
  await A.done();
  await B.done();
  await scratch.context().close();
});

test("Phase 3 · reset penyesuaian mengembalikan tampilan netral di semua peserta", async ({ browser }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "satu proyek cukup");
  test.setTimeout(420_000);
  const scratch = await (await browser.newContext()).newPage();
  const { A, B } = await toEditor(browser, info, /^Photo Strip\./, 4);
  await tool(A, "Atur").click();
  await A.page.waitForTimeout(800);
  const base = (await luma(scratch, await editorShot(B))).mean;
  const sat = A.page.getByLabel("Saturasi");
  await sat.fill("-100");
  await sat.blur();
  const exp = A.page.getByLabel("Eksposur");
  await exp.fill("-70");
  await exp.blur();
  await expect.poll(async () => (await luma(scratch, await editorShot(B))).mean, { timeout: 15_000 }).toBeLessThan(base - 3);
  await A.page.getByRole("button", { name: "Reset penyesuaian" }).click();
  await expect.poll(async () => Math.abs((await luma(scratch, await editorShot(B))).mean - base), { timeout: 15_000 }).toBeLessThan(base * 0.02);
  await expect(A.page.getByLabel("Eksposur")).toHaveValue("0");
  await A.done();
  await B.done();
  await scratch.context().close();
});

test("Phase 3 · frame baru benar-benar masuk ke export; kategori & stiker baru tersinkron", async ({ browser }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "satu proyek cukup");
  test.setTimeout(420_000);
  const scratch = await (await browser.newContext()).newPage();
  const { A, B } = await toEditor(browser, info, /^Photo Strip\./, 4);

  // Frame: kategori Retro → Super 8 (latar cokelat tua #2A1A12).
  await tool(A, "Frame").click();
  const cats = A.page.getByRole("group", { name: "Kategori frame" });
  for (const c of ["Semua", "Monokrom", "Retro", "Polaroid", "Editorial", "Pastel", "Date night", "Sahabat", "Musiman"]) await expect(cats.getByRole("button", { name: c })).toBeVisible();
  const list = A.page.getByRole("list", { name: "Daftar frame" });
  const total = await list.getByRole("button").count();
  console.log(`[p3] frame untuk Photo Strip: ${total}`);
  expect(total).toBeGreaterThanOrEqual(18);
  await cats.getByRole("button", { name: "Retro" }).click();
  expect(await list.getByRole("button").count()).toBeLessThan(total);
  expect(await axeScan(A.page, "editor+frame")).toEqual([]);
  await list.getByRole("button", { name: /Super 8/ }).click();
  await expect(list.getByRole("button", { name: /Super 8/ })).toHaveAttribute("aria-pressed", "true");
  await tool(B, "Frame").click();
  await expect(B.page.getByRole("list", { name: "Daftar frame" }).getByRole("button", { name: /Super 8/ })).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });

  // Stiker baru (Kamera) tersinkron ke B.
  await tool(A, "Stiker").click();
  const count = async (p: Person) => Number(await p.page.getByTestId("editor-canvas").getAttribute("data-elements"));
  const before = await count(B);
  await A.page.getByRole("button", { name: "Tambah stiker Kamera" }).click();
  await expect.poll(() => count(B), { timeout: 15_000 }).toBe(before + 1);

  const png = await finishAndExport(A, B, scratch);
  // Pojok kiri-atas export = latar frame Super 8 (di luar foto/sprocket): #2A1A12.
  const [r, g, b] = await pixelAt(scratch, png, 2, 2);
  console.log(`[p3] piksel pojok export = rgb(${r},${g},${b})`);
  expect(Math.abs(r! - 0x2a) + Math.abs(g! - 0x1a) + Math.abs(b! - 0x12)).toBeLessThan(24);
  await A.done();
  await B.done();
  await scratch.context().close();
});

test("Phase 3 · layout baru (Majalah) di studio → editor memuat foto sesuai susunan; export berukuran sama dengan rencana", async ({ browser }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "satu proyek cukup");
  test.setTimeout(420_000);
  const scratch = await (await browser.newContext()).newPage();
  const { A, B } = await toEditor(browser, info, /^Photo Grid\./, 1, async (A, B) => {
    await A.page.getByRole("button", { name: "Layout", exact: true }).filter({ visible: true }).first().click();
    await expect(A.page.getByText(/Majalah/).first()).toBeVisible({ timeout: 10_000 });
    await A.page.getByRole("radio", { name: /Majalah/ }).click();
    await expect(A.page.getByRole("img", { name: /Hasil sementara|Pratinjau/ }).first()).toHaveAttribute("data-slots", "2", { timeout: 15_000 });
    await expect(B.page.getByRole("img", { name: /Hasil sementara|Pratinjau/ }).first()).toHaveAttribute("data-slots", "2", { timeout: 15_000 });
  });
  const canvas = A.page.getByTestId("editor-canvas");
  const [, , dw, dh] = (await canvas.getAttribute("data-doc"))!.split(",").map(Number) as [number, number, number, number];
  expect(Number(await canvas.getAttribute("data-elements"))).toBe(2);
  const png = await finishAndExport(A, B, scratch);
  const { w, h } = await luma(scratch, png);
  console.log(`[p3] Majalah 2 foto: dokumen layar ${dw}×${dh}, export ${w}×${h}`);
  // Rasio dokumen di editor = rasio export (tidak ada distorsi / potongan).
  expect(Math.abs(w / h - dw / dh)).toBeLessThan(0.02);
  await A.done();
  await B.done();
  await scratch.context().close();
});
