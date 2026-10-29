import { expect, test } from "@playwright/test";
import { collectCsp, createRoom, joinRoom, openPerson, playingRemoteVideos } from "./kit";

/**
 * P10 — ketahanan WebRTC pada build produksi (tanpa hook dev): izin kamera ditolak (SCR-04), tab background → foreground,
 * putus jaringan klien lalu pulih (ICE restart / rebuild), reload. Kamera palsu Chromium; TANPA TURN, NAT ketat tidak diuji.
 */
test("izin kamera ditolak: pesan cara mengizinkan, tetap bisa masuk tanpa kamera, peserta lain tidak terganggu", async ({ browser }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "satu proyek cukup");
  test.setTimeout(120_000);
  const denied = await openPerson(browser, info, "Ditolak", { camera: false });
  await denied.ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  const host = await openPerson(browser, info, "Nadia");
  const code = await createRoom(host.page, "Nadia");

  await denied.page.goto(`/r/${code}`);
  await denied.page.getByLabel("Nama panggilan").fill("");
  await denied.page.getByLabel("Nama panggilan").fill("Ditolak");
  await denied.page.getByRole("button", { name: `Gabung ke ${code}` }).click();
  await expect(denied.page.getByRole("heading", { name: /Cek kamera/ })).toBeVisible({ timeout: 15_000 });
  await denied.page.getByRole("button", { name: "Nyalain kamera" }).click();
  await expect(denied.page.getByText("Cara ngizinin lagi:")).toBeVisible({ timeout: 10_000 });
  await denied.page.getByRole("button", { name: "Masuk tanpa kamera" }).click();
  await expect(denied.page.getByRole("heading", { name: /geng/i })).toBeVisible();
  // Host melihat peserta masuk; kamera mereka tampil sebagai tidak ada, bukan error.
  await expect(host.page.getByText("2 dari 4 udah masuk")).toBeVisible({ timeout: 10_000 });
  expect(await collectCsp(denied)).toEqual([]);
  expect(denied.watch.pageErrors).toEqual([]);
  await denied.done();
  await host.done();
});

test("background→foreground, putus jaringan klien lalu pulih, reload: 3 feed remote pulih tanpa error halaman", async ({ browser }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "satu proyek cukup");
  test.setTimeout(240_000);
  const people = [];
  for (const [i, n] of ["Nadia", "Raka", "Sasa", "Bimo"].entries()) people.push(await openPerson(browser, info, n, { fakeVideoIdx: i }));
  const [A, B, C, D] = people as [(typeof people)[number], (typeof people)[number], (typeof people)[number], (typeof people)[number]];
  const code = await createRoom(A.page, "Nadia");
  for (const [p, n] of [[B, "Raka"], [C, "Sasa"], [D, "Bimo"]] as const) await joinRoom(p.page, code, n);
  for (const p of people) await expect.poll(() => playingRemoteVideos(p.page), { timeout: 45_000 }).toBe(3);

  // Tab disembunyikan lalu kembali (visibilitychange) pada B.
  await B.page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await B.page.waitForTimeout(2_000);
  await B.page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  for (const p of people) await expect.poll(() => playingRemoteVideos(p.page), { timeout: 30_000 }).toBe(3);

  // Jaringan C putus 8 dtk (melewati ambang disconnected 3 dtk + heartbeat) lalu pulih.
  await C.ctx.setOffline(true);
  await C.page.waitForTimeout(8_000);
  await C.ctx.setOffline(false);
  for (const p of people) await expect.poll(() => playingRemoteVideos(p.page), { timeout: 60_000 }).toBe(3);
  await expect(C.page.getByText("4 dari 4 udah masuk")).toBeVisible({ timeout: 30_000 });

  // Reload D: renegosiasi penuh.
  await D.page.reload();
  await expect(D.page.getByRole("heading", { name: /geng/i })).toBeVisible({ timeout: 20_000 });
  for (const p of people) await expect.poll(() => playingRemoteVideos(p.page), { timeout: 45_000 }).toBe(3);

  for (const p of people) {
    expect(p.watch.pageErrors, `pageerror ${p.watch.name}`).toEqual([]);
    expect(await collectCsp(p), `CSP ${p.watch.name}`).toEqual([]);
    await p.done();
  }
});
