import { expect } from "@playwright/test";
import type { Browser, Page, TestInfo } from "@playwright/test";
import { createRoom, joinRoom, openPerson, shutterName } from "./kit";
import type { Person } from "./kit";

/** Rata-rata luminans PNG (0..255) dihitung di browser (decode asli, bukan perkiraan di Node). */
export async function luma(scratch: Page, png: Buffer): Promise<{ mean: number; w: number; h: number; px: (x: number, y: number) => number[] }> {
  const r = await scratch.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const c = document.createElement("canvas");
    // Normalisasi ke lebar 240 px supaya perbandingan editor (skala layar) vs export (skala dokumen) adil.
    const w = 240;
    const h = Math.max(1, Math.round((bmp.height / bmp.width) * w));
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
    return { mean: sum / (d.length / 4), w: bmp.width, h: bmp.height, first: Array.from(d.slice(0, 4)), srcW: bmp.width };
  }, png.toString("base64"));
  return { mean: r.mean, w: r.srcW, h: r.h, px: () => r.first };
}

/** Piksel (x,y) dari PNG export pada ukuran asli. */
export async function pixelAt(scratch: Page, png: Buffer, x: number, y: number): Promise<number[]> {
  return scratch.evaluate(
    async ([b64, px, py]) => {
      const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const c = document.createElement("canvas");
      c.width = 1;
      c.height = 1;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(bmp, px as number, py as number, 1, 1, 0, 0, 1, 1);
      return Array.from(g.getImageData(0, 0, 1, 1).data);
    },
    [png.toString("base64"), x, y] as const,
  );
}

/** Tangkap dokumen di kanvas editor (persis area dokumen, bukan latar sekitar) sebagai PNG. */
export async function editorShot(p: Person): Promise<Buffer> {
  const wrap = p.page.getByTestId("editor-canvas");
  const box = (await wrap.boundingBox())!;
  const [dx, dy, dw, dh] = (await wrap.getAttribute("data-doc"))!.split(",").map(Number) as [number, number, number, number];
  return p.page.screenshot({ clip: { x: box.x + dx, y: box.y + dy, width: dw, height: dh } });
}

export async function toEditor(browser: Browser, info: TestInfo, mode: RegExp, shots: number, pre?: (A: Person, B: Person) => Promise<void>) {
  const A = await openPerson(browser, info, "Nadia", { fakeVideoIdx: 0 });
  const B = await openPerson(browser, info, "Raka", { fakeVideoIdx: 1 });
  const code = await createRoom(A.page, "Nadia");
  await joinRoom(B.page, code, "Raka");
  await expect(A.page.getByText("Raka").first()).toBeVisible({ timeout: 20_000 });
  await A.page.getByRole("button", { name: "Mulai vote mode" }).click();
  for (const p of [A, B]) await p.page.getByRole("radio", { name: mode }).click();
  await expect(A.page.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 20_000 });
  await expect(B.page.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 20_000 });
  if (pre) await pre(A, B);
  for (let i = 0; i < shots; i++) {
    await expect(A.page.getByRole("button", { name: shutterName })).toBeEnabled({ timeout: 30_000 });
    await A.page.getByRole("button", { name: shutterName }).click();
    await A.page.getByRole("button", { name: "Tetap mulai" }).click({ timeout: 2_500 }).catch(() => undefined);
    for (const p of [A, B]) {
      await expect(p.page.getByTestId("review")).toBeVisible({ timeout: 60_000 });
      await expect(p.page.getByTestId("review").getByRole("button", { name: "Pakai ini" })).toBeEnabled({ timeout: 60_000 });
    }
    for (const p of [A, B]) await p.page.getByTestId("review").getByRole("button", { name: "Pakai ini" }).click();
  }
  for (const p of [A, B]) await expect(p.page.getByTestId("editor")).toBeVisible({ timeout: 60_000 });
  return { A, B, code };
}

export const tool = (p: Person, name: string) => p.page.getByRole("navigation", { name: "Alat editor" }).getByRole("button", { name: new RegExp(`^${name}`) }).first();

export async function finishAndExport(A: Person, B: Person, scratch: Page): Promise<Buffer> {
  await A.page.getByRole("button", { name: /^Selesai( edit)?$/ }).first().click();
  await A.page.getByRole("dialog", { name: /Selesai buat semua/ }).getByRole("button", { name: /^Selesai$/ }).click();
  await expect(A.page.getByTestId("result-preview")).toBeVisible({ timeout: 40_000 });
  await expect(B.page.getByTestId("result-screen")).toBeVisible({ timeout: 40_000 });
  const [dl] = await Promise.all([A.page.waitForEvent("download", { timeout: 90_000 }), A.page.getByRole("button", { name: /^Unduh$/ }).click()]);
  const fs = await import("node:fs");
  const buf = fs.readFileSync(await dl.path());
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  void scratch;
  return buf;
}

