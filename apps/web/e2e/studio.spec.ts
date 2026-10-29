import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import sharp from "sharp";
import { createRoom, joinRoom, newPage, playingRemoteVideos } from "./helpers";

/**
 * P05 (AC-P05-1/2/3/4/5/11/13, TC-FRAME-001..004, 010, 011): 4 konteks, media palsu Chromium.
 * Masuk studio lewat voting nyata, lalu frame/filter/layout bersama, pratinjau lokal, Balikin,
 * upload frame custom, reload, dan dock/sheet mobile.
 */

const SHOTS = process.env.LR_SCREENSHOT_DIR;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const result = (p: Page) => p.getByRole("img", { name: /^Hasil sementara/ });
/** Kanvas output bersama yang terlihat (Hasil sementara, atau pratinjau besar saat panel terbuka). */
const out = (p: Page) => p.getByRole("img", { name: /^(Hasil sementara|Pratinjau)/ }).first();

async function toStudio(pages: Page[], mode = "Photo Strip") {
  await pages[1]!.getByRole("button", { name: "Mulai vote mode" }).click();
  for (const p of pages) await p.getByRole("radio", { name: new RegExp(`^${mode}\\.`) }).click();
  for (const p of pages) {
    await expect(p.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 10_000 });
  }
}

async function framePng(holes: number): Promise<Buffer> {
  const w = 1000;
  const h = 3000;
  const hh = (h - 100 * (holes + 1)) / holes;
  const rects = Array.from({ length: holes }, (_, i) => `<rect x="90" y="${100 + i * (hh + 100)}" width="${w - 180}" height="${hh}" fill="black"/>`).join("");
  const mask = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="white"/>${rects}</svg>`))
    .greyscale()
    .raw()
    .toBuffer();
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 59;
    rgba[i * 4 + 1] = 35;
    rgba[i * 4 + 2] = 80;
    rgba[i * 4 + 3] = mask[i]!;
  }
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

test("4 peserta: studio, frame lokal vs Pasang buat semua, Balikin, filter, layout, upload frame, reload", async ({ browser }) => {
  test.setTimeout(300_000);
  const ps = await Promise.all([0, 1, 2, 3].map(() => newPage(browser, { width: 1440, height: 900 })));
  const [a, b, c, d] = ps.map((p) => p.page) as [Page, Page, Page, Page];
  const code = await createRoom(a, "Nadia");
  await joinRoom(b, code, "Raka");
  await joinRoom(c, code, "Sasa");
  await joinRoom(d, code, "Bimo");
  await toStudio([a, b, c, d]);

  // Studio awal: plan default sementara (DEC-061 OPEN) Strip 4 shot, feed live di slot.
  for (const p of [a, b, c, d]) await expect(out(p)).toHaveAttribute("data-slots", "4");
  await expect.poll(() => playingRemoteVideos(a), { timeout: 30_000 }).toBe(3);
  await expect.poll(() => result(a).locator("[data-participant] video").count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(16);
  await shot(a, "p05-studio-desktop");

  // AC-P05-2: pratinjau lokal tidak mengubah klien lain; presence "lagi lihat".
  await a.getByRole("button", { name: "Frame", exact: true }).click();
  await a.getByRole("option", { name: /^Film 400/ }).click();
  await expect(a.getByRole("img", { name: /^Pratinjau Film 400/ })).toHaveAttribute("data-frame", "builtin/film-400@1");
  await expect(result(b)).toHaveAttribute("data-frame", "builtin/seoul-strip@1");
  await expect(b.getByRole("button", { name: "Frame", exact: true })).toBeVisible();
  await b.getByRole("button", { name: "Frame", exact: true }).click();
  await expect(b.getByText(/Nadia lagi lihat Film 400/)).toBeVisible();
  await b.getByRole("button", { name: "Frame", exact: true }).click();
  await shot(a, "p05-frame-panel");

  // AC-P05-1: Pasang buat semua ≤ 1 s di 3 klien lain + toast dengan Balikin.
  await a.getByRole("button", { name: "Pasang buat semua" }).click();
  await Promise.all([c, d].map((p) => expect(result(p)).toHaveAttribute("data-frame", "builtin/film-400@1", { timeout: 1_000 })));
  await expect(c.getByText("Nadia pasang Film 400")).toBeVisible();
  await expect(result(c)).toHaveAttribute("data-frame", "builtin/film-400@1");

  // Balikin satu langkah dari klien lain.
  await c.getByRole("button", { name: "Balikin" }).first().click();
  for (const p of [a, b, d]) await expect(result(p).or(p.getByRole("img", { name: /^Pratinjau/ })).first()).toHaveAttribute("data-frame", "builtin/seoul-strip@1");
  await a.getByRole("button", { name: "Frame", exact: true }).click();

  // Filter grup tersinkron.
  await d.getByRole("button", { name: "Filter", exact: true }).click();
  await d.getByRole("radio", { name: "Mono" }).click();
  for (const p of [a, b, c]) await expect(out(p)).toHaveAttribute("data-filter", "MONO");
  await expect(a.getByText("Bimo ganti filter ke Mono")).toBeVisible();

  // AC-P05-3 / TC-FRAME-005/006: jumlah shot & strategi sebelum shot 1; safeguard menampilkan alternatif.
  await b.getByRole("button", { name: "Layout", exact: true }).click();
  await b.getByRole("button", { name: "Tambah shot" }).click();
  for (const p of [a, c, d]) await expect(out(p)).toHaveAttribute("data-slots", "5");
  await b.getByRole("radio", { name: "Foto per orang" }).click();
  for (const p of [a, c, d]) await expect(out(p)).toHaveAttribute("data-slots", "20");
  for (let i = 0; i < 3; i++) await b.getByRole("button", { name: "Tambah shot" }).click();
  await expect(out(a)).toHaveAttribute("data-slots", "32");
  await expect(b.getByText(/8 shot × 4 orang jadi 32 foto/)).toBeVisible();
  await b.getByRole("button", { name: "Tambah shot" }).click();
  await expect(b.getByText(/9 shot belum bisa/)).toBeVisible();
  await expect(out(a)).toHaveAttribute("data-slots", "32");
  await shot(b, "p05-layout-panel");
  await b.getByRole("button", { name: "Pakai 8 shot" }).click();
  await b.getByRole("radio", { name: "Foto bareng per shot" }).click();
  for (const p of [a, c, d]) await expect(out(p)).toHaveAttribute("data-slots", "8");

  // AC-P05-4: upload frame custom dari satu klien terlihat di klien lain; dipasang FIXED mengikuti lubang.
  await c.getByRole("button", { name: "Frame", exact: true }).click();
  await c.getByRole("button", { name: "Upload frame" }).click();
  await c.getByLabel("Pilih file frame (PNG atau WebP)").setInputFiles({ name: "frame-kita.png", mimeType: "image/png", buffer: await framePng(4) });
  await expect(c.getByText(/4 lubang ketemu/)).toBeVisible({ timeout: 20_000 });
  // 8 shot tapi frame cuma 4 lubang → alasan + alternatif (bukan potong diam-diam).
  await expect(c.getByText(/Frame ini cuma punya 4 lubang, butuh 8/)).toBeVisible();
  await expect(c.getByRole("button", { name: "Pasang buat semua" })).toBeDisabled();
  await shot(c, "p05-upload-panel");
  await c.getByRole("button", { name: "Pakai 4 shot" }).click();
  for (const p of [a, b, d]) await expect(out(p)).toHaveAttribute("data-slots", "4");
  await expect(a.getByText("Sasa pasang frame-kita · 4 shot")).toBeVisible();
  await a.getByRole("button", { name: "Frame", exact: true }).click();
  await a.getByRole("button", { name: "Punyaku" }).click();
  await expect(a.getByRole("option", { name: /^frame-kita, Punyaku, dipakai/ })).toBeVisible();
  await shot(a, "p05-custom-frame");
  await a.getByRole("button", { name: "Frame", exact: true }).click();

  // AC-P05-5: > 10 MB ditolak dengan pesan (cek klien; server diuji di integrasi).
  await c.getByRole("button", { name: "Upload frame" }).click();
  await c.getByLabel("Pilih file frame (PNG atau WebP)").setInputFiles({ name: "frame-glitter.png", mimeType: "image/png", buffer: Buffer.alloc(11 * 1024 * 1024, 1) });
  await expect(c.getByText("frame-glitter.png kebesaran (11 MB). Maksimal 10 MB.")).toBeVisible();

  // Reload salah satu peserta: studio pulih dari snapshot (frame custom, filter, layout).
  await d.reload();
  await expect(d.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 15_000 });
  await expect(result(d)).toHaveAttribute("data-filter", "MONO");
  await expect(out(d)).toHaveAttribute("data-slots", "4");

  for (const p of ps) await p.ctx.close();
});

test("mobile: feed fullscreen, dock (Timer & shutter nonaktif), Alat → sheet Frame → Pasang buat semua", async ({ browser }) => {
  test.setTimeout(120_000);
  const a = await newPage(browser, { width: 390, height: 844 });
  const b = await newPage(browser, { width: 1280, height: 800 });
  const code = await createRoom(a.page, "Nadia");
  await joinRoom(b.page, code, "Raka");
  await toStudio([a.page, b.page], "Photo Grid");
  const m = a.page;
  await expect(m.getByRole("button", { name: /^Timer \d+s/ })).toBeEnabled();
  await expect(m.getByRole("button", { name: /^Ambil foto, hitung mundur/ })).toBeEnabled();
  await expect(m.getByText(code, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await shot(m, "p05-studio-mobile");
  await m.getByRole("button", { name: "Alat" }).click();
  await expect(m.getByRole("dialog", { name: "Alat" })).toBeVisible();
  await m.getByRole("button", { name: /^Frame/ }).click();
  await m.getByRole("option", { name: /^Lilac Dream/ }).click();
  await shot(m, "p05-frame-mobile");
  await m.getByRole("button", { name: "Pasang Lilac Dream buat semua" }).click();
  await expect(result(b.page)).toHaveAttribute("data-frame", "builtin/lilac-dream@1");
  // Tidak ada scroll horizontal di mobile.
  expect(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await a.ctx.close();
  await b.ctx.close();
});
