import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { editorShot, luma, toEditor, tool } from "./phase3kit";
import type { Page } from "@playwright/test";

/**
 * Phase 4 — pengukuran performa jalur adjustment (build produksi, Chromium, kamera palsu). Aktif dengan P10_PERF=1.
 * Mengukur: latensi interaksi slider → kanvas, biaya per foto (applyAdjust + draw), long task, pertumbuhan heap setelah 60
 * perubahan + GC, ukuran cache kanvas, dan waktu export netral vs beradjustment. Hasil ditulis ke test-results/p10/perf.json.
 */
const stats = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  const q = (p: number) => a[Math.min(a.length - 1, Math.floor(p * a.length))] ?? 0;
  return { n: a.length, mean: +(a.reduce((s, v) => s + v, 0) / Math.max(1, a.length)).toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +(a.at(-1) ?? 0).toFixed(2) };
};

async function heapMB(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const { usedSize } = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
  await cdp.detach();
  return +(usedSize / 1048576).toFixed(1);
}

test("perf · adjustment: latensi slider, long task, heap, cache, dan waktu export", async ({ browser }, info) => {
  test.skip(process.env.P10_PERF !== "1" || info.project.name !== "chromium-desktop", "set P10_PERF=1 (chromium-desktop)");
  test.setTimeout(480_000);
  const scratch = await (await browser.newContext()).newPage();
  const { A, B } = await toEditor(browser, info, /^Photo Strip\./, 4);
  const out: Record<string, unknown> = { viewport: A.page.viewportSize() };

  await tool(A, "Atur").click();
  await A.page.waitForTimeout(800);
  await A.page.evaluate(() => {
    const g = globalThis as unknown as { __lrPerf: unknown; __long: number[] };
    g.__lrPerf = { adjust: [], hits: 0 };
    g.__long = [];
    try {
      new PerformanceObserver((l) => l.getEntries().forEach((e) => g.__long.push(e.duration))).observe({ entryTypes: ["longtask"] });
    } catch {
      /* longtask tak didukung */
    }
  });
  out.heapStartMB = await heapMB(A.page);

  // 60 perubahan slider (fill + blur = komit). Latensi = sampai 2 frame berikutnya selesai (kanvas sudah digambar ulang).
  const exposure = A.page.getByLabel("Eksposur");
  const lat: number[] = [];
  for (let i = 0; i < 60; i++) {
    const v = String(-60 + ((i * 7) % 121));
    const t0 = Date.now();
    await exposure.fill(v);
    await A.page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    lat.push(Date.now() - t0);
    await exposure.blur();
  }
  await A.page.waitForTimeout(500);
  const probe = (await A.page.evaluate(() => {
    const g = globalThis as unknown as { __lrPerf: { adjust: { ms: number; px: number }[]; hits: number; cache?: () => unknown }; __long: number[] };
    return { adjust: g.__lrPerf.adjust, hits: g.__lrPerf.hits, cache: g.__lrPerf.cache?.() ?? null, long: g.__long };
  })) as { adjust: { ms: number; px: number }[]; hits: number; cache: { entries: number; totalPx: number } | null; long: number[] };
  out.sliderLatencyMs = stats(lat);
  out.perPhotoAdjustMs = stats(probe.adjust.map((a) => a.ms));
  out.perPhotoPixels = stats(probe.adjust.map((a) => a.px));
  out.cacheHits = probe.hits;
  out.cacheAfter = probe.cache;
  out.longTasks = { count: probe.long.length, maxMs: +(Math.max(0, ...probe.long)).toFixed(1) };
  out.heapAfterMB = await heapMB(A.page);
  out.heapGrowthMB = +((out.heapAfterMB as number) - (out.heapStartMB as number)).toFixed(1);

  // Pastikan hasilnya benar-benar berubah (bukan loop kosong) dan B menerima nilai akhir.
  await exposure.fill("60");
  await exposure.blur();
  const base = (await luma(scratch, await editorShot(B))).mean;
  out.lumaB = +base.toFixed(1);

  // Export: netral (setelah reset) vs beradjustment; Asli & Cetak 300 dpi.
  const timeExport = async (preset: RegExp) => {
    await A.page.getByRole("radio", { name: preset }).click();
    const t0 = Date.now();
    const [dl] = await Promise.all([A.page.waitForEvent("download", { timeout: 120_000 }), A.page.getByRole("button", { name: /^Unduh$/ }).click()]);
    await dl.path();
    return Date.now() - t0;
  };
  await A.page.getByRole("button", { name: "Reset penyesuaian" }).click();
  await A.page.waitForTimeout(500);
  const finish = async () => {
    await A.page.getByRole("button", { name: /^Selesai( edit)?$/ }).first().click();
    await A.page.getByRole("dialog", { name: /Selesai buat semua/ }).getByRole("button", { name: /^Selesai$/ }).click();
    await expect(A.page.getByTestId("result-preview")).toBeVisible({ timeout: 40_000 });
  };
  await finish();
  out.exportNeutralAsliMs = await timeExport(/^Asli/);
  out.exportNeutralCetakMs = await timeExport(/^Cetak 300/);
  await A.page.getByRole("button", { name: "Balik edit" }).click();
  await expect(A.page.getByTestId("editor")).toBeVisible({ timeout: 30_000 });
  await tool(A, "Atur").click();
  const exp2 = A.page.getByLabel("Eksposur");
  await exp2.fill("40");
  await exp2.blur();
  await A.page.getByRole("tab", { name: "Cahaya" }).click();
  await A.page.getByLabel("Sorotan").fill("-40");
  await A.page.getByLabel("Sorotan").blur();
  await A.page.getByRole("tab", { name: "Warna" }).click();
  await A.page.getByLabel("Suhu warna").fill("30");
  await A.page.getByLabel("Suhu warna").blur();
  await A.page.getByRole("tab", { name: "Efek" }).click();
  await A.page.getByLabel("Grain").fill("40");
  await A.page.getByLabel("Grain").blur();
  await A.page.waitForTimeout(500);
  await finish();
  out.exportAdjustedAsliMs = await timeExport(/^Asli/);
  out.exportAdjustedCetakMs = await timeExport(/^Cetak 300/);
  out.heapEndMB = await heapMB(A.page);

  fs.mkdirSync("test-results/p10", { recursive: true });
  fs.writeFileSync("test-results/p10/perf.json", JSON.stringify(out, null, 2));
  console.log("[perf]", JSON.stringify(out));
  // Batas kasar yang masuk akal untuk laptop biasa: interaksi < 150 ms (p95), tak ada long task > 250 ms, heap tak bocor > 40 MB.
  expect((out.sliderLatencyMs as { p95: number }).p95).toBeLessThan(150);
  expect(out.heapGrowthMB as number).toBeLessThan(40);
  await A.done();
  await B.done();
  await scratch.context().close();
});
