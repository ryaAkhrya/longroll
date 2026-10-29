import { expect } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";

/** Merekam setiap panggilan getUserMedia (untuk TC-CAM-007: mikrofon tidak pernah diminta). */
export const RECORD_GUM = () => {
  const calls: unknown[] = [];
  (window as unknown as { __gumCalls: unknown[] }).__gumCalls = calls;
  const md = navigator.mediaDevices;
  if (md?.getUserMedia) {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = (c?: MediaStreamConstraints) => {
      calls.push(JSON.parse(JSON.stringify(c ?? {})));
      return orig(c);
    };
  }
};

export async function newPage(browser: Browser, opts: { width?: number; height?: number; camera?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 1280, height: opts.height ?? 800 },
    permissions: opts.camera === false ? [] : ["camera"],
  });
  await ctx.addInitScript(RECORD_GUM);
  return { ctx, page: await ctx.newPage() };
}

/** Selesaikan SCR-04: nyalakan kamera (media palsu) lalu masuk lobby, atau masuk tanpa kamera. */
export async function passCameraCheck(page: Page, withCamera = true) {
  await expect(page.getByRole("heading", { name: /Cek kamera/ })).toBeVisible({ timeout: 15_000 });
  if (withCamera) {
    await page.getByRole("button", { name: "Nyalain kamera" }).click();
    await page.getByRole("button", { name: "Masuk ke lobby" }).click();
  } else {
    await page.getByRole("button", { name: "Masuk tanpa kamera" }).click();
  }
  await expect(page.getByRole("heading", { name: /geng/i })).toBeVisible();
}

export async function createRoom(page: Page, name: string, withCamera = true): Promise<string> {
  await page.goto("/r/new");
  // Teks yang diisi sebelum hidrasi selesai bisa tak tercatat oleh React (value tracker, terlihat di WebKit): kosongkan lalu isi ulang sampai tombol aktif.
  await expect(async () => {
    await page.getByLabel("Nama panggilan").fill("");
    await page.getByLabel("Nama panggilan").fill(name);
    await expect(page.getByRole("button", { name: "Bikin room" })).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: "Bikin room" }).click();
  await page.waitForURL(/\/r\/[A-HJ-NP-Z2-9]{6}$/);
  await passCameraCheck(page, withCamera);
  return page.url().split("/r/")[1]!;
}

export async function joinRoom(page: Page, code: string, name: string, withCamera = true) {
  await page.goto(`/r/${code}`);
  await expect(page.getByText("Room ketemu")).toBeVisible();
  await expect(async () => {
    await page.getByLabel("Nama panggilan").fill("");
    await page.getByLabel("Nama panggilan").fill(name);
    await expect(page.getByRole("button", { name: `Gabung ke ${code}` })).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByRole("button", { name: `Gabung ke ${code}` }).click();
  await passCameraCheck(page, withCamera);
}

/** Jumlah kartu peserta lain yang menampilkan video remote yang benar-benar berjalan (videoWidth > 0). */
export function playingRemoteVideos(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLLIElement>("li[data-camera='video']"))
      .filter((li) => !li.getAttribute("aria-label")?.includes("(kamu)"))
      .map((li) => li.querySelector("video"))
      .filter((v): v is HTMLVideoElement => !!v && v.videoWidth > 0 && !v.paused).length,
  );
}
