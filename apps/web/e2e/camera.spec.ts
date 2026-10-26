import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, newPage, playingRemoteVideos } from "./helpers";

/**
 * P03 dengan PERANGKAT KAMERA PALSU Chromium (`--use-fake-device-for-media-stream`), jaringan localhost,
 * tanpa TURN. Membuktikan: izin & SCR-04, feed remote nyata via WebRTC mesh, tanpa mikrofon, kontrol
 * kamera hanya milik pemilik, renegosiasi setelah reload, ICE restart & rebuild PC.
 * TIDAK membuktikan: perangkat nyata, NAT ketat, relay TURN (TC-RTC-002/003/005 = perangkat nyata).
 */
test("TC-RTC-001: 4 konteks media palsu saling menerima 3 feed remote", async ({ browser }) => {
  test.setTimeout(120_000);
  const people = [await newPage(browser), await newPage(browser), await newPage(browser), await newPage(browser)];
  const [a, b, c, d] = people as [(typeof people)[number], (typeof people)[number], (typeof people)[number], (typeof people)[number]];

  const code = await createRoom(a.page, "Nadia");
  await joinRoom(b.page, code, "Raka");
  await joinRoom(c.page, code, "Sasa");
  const joinedAt = Date.now();
  await joinRoom(d.page, code, "Bimo");

  // AC-6: 3 track remote ≤ 5 s (diukur sejak peserta ke-4 mulai join; termasuk SCR-04 di D).
  for (const p of people) await expect.poll(() => playingRemoteVideos(p.page), { timeout: 15_000 }).toBe(3);
  const elapsed = Date.now() - joinedAt;
  test.info().annotations.push({ type: "rtc-3-remote-ms", description: String(elapsed) });

  // Kartu sendiri: LIVE + ring; video lokal jalan.
  await expect(a.page.getByRole("listitem", { name: /Kamera Nadia \(kamu\), live/ })).toBeVisible();
  await expect(a.page.getByRole("listitem", { name: /Kamera Nadia \(kamu\)/ }).getByText("LIVE")).toBeVisible();

  // TC-CAM-007: tidak ada getUserMedia dengan audio; tidak ada track audio di video mana pun.
  for (const p of people) {
    const calls = await p.page.evaluate(() => (window as unknown as { __gumCalls: { audio?: unknown }[] }).__gumCalls);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.audio === undefined || c.audio === false).toBe(true);
    const audioTracks = await p.page.evaluate(() =>
      Array.from(document.querySelectorAll("video")).reduce((n, v) => n + ((v.srcObject as MediaStream | null)?.getAudioTracks().length ?? 0), 0),
    );
    expect(audioTracks).toBe(0);
  }

  // Kamera off/on oleh pemilik → peserta lain melihat state & feed kembali (replaceTrack, tanpa putus peer).
  await a.page.getByRole("button", { name: "Matikan kamera kamu" }).click();
  await expect(b.page.getByRole("listitem", { name: /Kamera Nadia, kamera off/ })).toBeVisible({ timeout: 3_000 });
  await a.page.getByRole("listitem", { name: /Kamera Nadia \(kamu\)/ }).getByRole("button", { name: "Nyalain lagi" }).click();
  await expect.poll(() => playingRemoteVideos(b.page), { timeout: 10_000 }).toBe(3);

  // Kameraku (owner-only): zoom milik Nadia terlihat di klien Raka.
  await a.page.getByRole("button", { name: "Buka pengaturan Kameraku" }).click();
  await a.page.getByLabel("Zoom").fill("1.5");
  await a.page.getByRole("button", { name: "Tutup", exact: true }).click();
  await expect
    .poll(() => b.page.getByRole("listitem", { name: /Kamera Nadia, live/ }).locator("video").evaluate((v) => (v as HTMLVideoElement).style.transform), { timeout: 3_000 })
    .toContain("scale(1.5)");
  // Tidak ada kontrol kamera di kartu milik orang lain (REQ-CAM-13).
  await expect(b.page.getByRole("listitem", { name: /Kamera Nadia, live/ }).getByRole("button")).toHaveCount(0);

  // Reload (reconnect room + renegosiasi media): feed Bimo kembali di semua klien.
  await d.page.reload();
  await expect(d.page.getByRole("heading", { name: /geng/i })).toBeVisible({ timeout: 10_000 });
  for (const p of people) await expect.poll(() => playingRemoteVideos(p.page), { timeout: 20_000 }).toBe(3);

  // TC-RTC-004 (simulasi terkontrol): ICE restart lalu rebuild PC dari klien Nadia ke Raka.
  const peerIds = await a.page.evaluate(() => Object.keys((window as unknown as { __lrMedia: { status: () => Record<string, string> } }).__lrMedia.status()));
  expect(peerIds).toHaveLength(3);
  await a.page.evaluate((ids) => {
    const m = (window as unknown as { __lrMedia: { restartIce: (id: string) => void; retry: (id: string) => void } }).__lrMedia;
    m.restartIce(ids[0]!);
    m.retry(ids[1]!);
  }, peerIds);
  await expect
    .poll(() => a.page.evaluate(() => Object.values((window as unknown as { __lrMedia: { status: () => Record<string, string> } }).__lrMedia.status())), {
      timeout: 20_000,
    })
    .toEqual(["connected", "connected", "connected"]);
  await expect.poll(() => playingRemoteVideos(a.page), { timeout: 20_000 }).toBe(3);

  for (const p of people) await p.ctx.close();
});

test("TC-CAM-002 / DEC-068: izin ditolak → pemulihan; masuk tanpa kamera tetap bisa melihat feed lain", async ({ browser }) => {
  test.setTimeout(90_000);
  const a = await newPage(browser);
  const code = await createRoom(a.page, "Nadia");

  // Konteks tanpa izin kamera + getUserMedia ditolak (simulasi NotAllowedError).
  const b = await newPage(browser, { camera: false });
  await b.ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
  });
  await b.page.goto(`/r/${code}`);
  await b.page.getByLabel("Nama panggilan").fill("Raka");
  await b.page.getByRole("button", { name: `Gabung ke ${code}` }).click();
  await b.page.getByRole("button", { name: "Nyalain kamera" }).click();
  await expect(b.page.getByText("Browser nolak akses kamera.")).toBeVisible();
  await expect(b.page.getByText(/Pengaturan › Safari › Kamera/)).toBeVisible();
  await b.page.getByRole("button", { name: "Masuk tanpa kamera" }).click();
  await expect(b.page.getByRole("heading", { name: /geng/i })).toBeVisible();

  await expect(a.page.getByRole("listitem", { name: /Kamera Raka, tanpa kamera/ })).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => playingRemoteVideos(b.page), { timeout: 15_000 }).toBe(1);
  await a.ctx.close();
  await b.ctx.close();
});
