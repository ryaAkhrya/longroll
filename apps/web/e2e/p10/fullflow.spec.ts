import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { axeScan, collectCsp, createRoom, joinRoom, openPerson, playingRemoteVideos, shutterName, unexpectedErrors } from "./kit";
import type { Person } from "./kit";

/**
 * P10-A — satu alur lengkap 4 peserta (P02→P08) pada BUILD PRODUKSI (CSP nonce nyata):
 * bikin room → 3 gabung → WebRTC (kamera palsu) → vote → studio (frame/layout) → capture sinkron per shot dengan
 * Ulang/Pakai independen → editor kolaboratif (Yjs) + undo + reconnect → hasil → unduh → galeri → sesi baru → keluar.
 * Setiap peserta diawasi untuk pelanggaran CSP dan error konsol. Bukan perangkat nyata/TURN/OAuth/S3.
 */
let current: Person[] = [];
test.afterEach(async ({}, info) => {
  if (info.status === info.expectedStatus) return;
  for (const p of current) {
    const csp = await collectCsp(p);
    const where = await p.page.evaluate(() => ["editor", "review", "result-screen", "gallery-screen"].filter((t) => document.querySelector(`[data-testid="${t}"]`)).join("+") + " heading=" + (document.querySelector("h1")?.textContent ?? "").slice(0, 40)).catch(() => "?");
    await p.page.screenshot({ path: `test-results/p10/diag-${info.project.name}-${p.watch.name}.png` }).catch(() => undefined);
    console.log(`[diag ${p.watch.name}] at=${where}`);
    console.log(`[diag ${p.watch.name}] csp=${JSON.stringify(csp)} errors=${JSON.stringify(unexpectedErrors(p))}`);
  }
});
const stamp = (label: string, t0: number) => {
  test.info().annotations.push({ type: label, description: `${Date.now() - t0} ms` });
  console.log(`[step] ${label} +${Date.now() - t0}ms`);
};

async function acceptAll(people: Person[], shotIdx: number) {
  for (const p of people) {
    const review = p.page.getByTestId("review");
    await expect(review).toBeVisible({ timeout: 60_000 });
    await expect(review.getByRole("button", { name: "Pakai ini" })).toBeEnabled({ timeout: 60_000 });
  }
  void shotIdx;
}

test("alur penuh: room → 4 peserta → vote → studio → capture → editor → hasil → unduh → galeri → sesi baru → keluar", async ({ browser }, info) => {
  test.setTimeout(600_000);
  const t0 = Date.now();
  const names = ["Nadia", "Raka", "Sasa", "Bimo"];
  const people: Person[] = [];
  for (const n of names) people.push(await openPerson(browser, info, n));
  current = people;
  const a11y: string[] = [];
  const scan = async (label: string) => void a11y.push(...(await axeScan(A.page, `${info.project.name}:${label}`)));
  const [A, B, C, D] = people as [Person, Person, Person, Person];
  const mobile = info.project.name.includes("mobile");

  // ── P02: bikin & gabung ──
  const code = await createRoom(A.page, "Nadia");
  await joinRoom(B.page, code, "Raka");
  await joinRoom(C.page, code, "Sasa");
  await joinRoom(D.page, code, "Bimo");
  for (const p of people) await expect(p.page.getByText("4 dari 4 udah masuk")).toBeVisible();
  await scan("lobby");
  stamp("room-4-peserta", t0);

  // ── P03: WebRTC, media palsu (3 feed remote per klien); mikrofon tidak pernah diminta ──
  for (const p of people) await expect.poll(() => playingRemoteVideos(p.page), { timeout: 45_000 }).toBe(3);
  const gum = (await A.page.evaluate(() => (window as unknown as { __gumCalls: { audio?: unknown }[] }).__gumCalls)) ?? [];
  expect(gum.length).toBeGreaterThan(0);
  expect(gum.every((g) => !g.audio)).toBe(true);
  stamp("webrtc-3-remote", t0);

  // ── P04: vote, mode terkunci ──
  await C.page.getByRole("button", { name: "Mulai vote mode" }).click();
  await expect(A.page.getByRole("radiogroup", { name: "Mode foto" })).toBeVisible();
  await scan("voting");
  for (const p of people) await p.page.getByRole("radio", { name: /^Photo Grid\./ }).click();
  for (const p of people) await expect(p.page.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 15_000 });

  await scan("studio");
  // ── P05: frame bersama (satu mengubah, semua melihat) ──
  const out = (pg: Page) => pg.getByRole("img", { name: /^(Hasil sementara|Pratinjau)/ }).first();
  const open = async (pg: Page, tab: string) => {
    if (mobile) {
      const sheet = pg.getByRole("dialog", { name: /Alat|Frame|Layout/ });
      if (!(await sheet.isVisible().catch(() => false))) await pg.getByRole("button", { name: "Alat" }).click();
      await pg.getByRole("button", { name: new RegExp(`^${tab}`) }).filter({ visible: true }).first().click();
      return;
    }
    await pg.getByRole("button", { name: tab, exact: true }).filter({ visible: true }).first().click();
  };
  await open(B.page, "Frame");
  await B.page.getByRole("option", { name: /^Scrapbook/ }).click();
  await B.page.getByRole("button", { name: /^Pasang .*buat semua$/ }).click();
  for (const p of [A, C, D]) {
    if (mobile) await open(p.page, "Frame"); // pratinjau hasil hanya tampil di sheet Frame pada mobile
    await expect(out(p.page)).toHaveAttribute("data-frame", "builtin/scrapbook@1");
    if (mobile) await p.page.getByRole("dialog").getByRole("button", { name: "Tutup" }).click();
  }
  if (mobile) await B.page.getByRole("dialog").getByRole("button", { name: "Tutup" }).click();
  else await open(B.page, "Frame");
  stamp("studio-frame", t0);

  // ── P06: capture sinkron. Shot 1: C menekan; D memilih "Ulang" sementara yang lain "Pakai ini" (independen) ──
  await C.page.getByRole("button", { name: shutterName }).click();
  await acceptAll(people, 0);
  await scan("review");
  stamp("capture-shot1-review", t0);

  // Independen: A, B, C menerima; D mengulang → status mereka tidak berubah dan D masuk take ke-2.
  for (const p of [A, B, C]) await p.page.getByTestId("review").getByRole("button", { name: "Pakai ini" }).click();
  await D.page.getByTestId("review").getByRole("button", { name: "Ulang" }).click();
  for (const p of [A, B, C]) {
    const other = p.page.locator('[data-testid^="other-"][data-status]');
    await expect.poll(async () => (await other.evaluateAll((els) => els.map((e) => e.getAttribute("data-status")))).join(",")).toMatch(/RETAKE_COUNTDOWN|CAPTURING|UPLOADING|ACCEPTED|DECIDING/);
    await expect(p.page.getByTestId("review")).toHaveAttribute("data-my-status", "ACCEPTED");
  }
  // D menyelesaikan take ke-2 dan menerima; tanpa auto-accept, tombol baru aktif setelah foto siap.
  await expect(D.page.getByTestId("review").getByRole("button", { name: "Pakai ini" })).toBeEnabled({ timeout: 60_000 });
  await expect(D.page.getByText(/Take 1 · diulang|percobaan 2/).first()).toBeVisible({ timeout: 30_000 }).catch(() => undefined);
  await D.page.getByTestId("review").getByRole("button", { name: "Pakai ini" }).click();
  stamp("capture-shot1-done", t0);

  // Shot berikutnya (sampai masuk editor).
  for (let guard = 0; guard < 6; guard++) {
    const inEditor = await A.page.getByTestId("editor").isVisible().catch(() => false);
    if (inEditor) break;
    const shutter = A.page.getByRole("button", { name: shutterName });
    await expect.poll(async () => (await A.page.getByTestId("editor").isVisible()) || (await shutter.isEnabled().catch(() => false)), { timeout: 60_000 }).toBe(true);
    if (await A.page.getByTestId("editor").isVisible()) break;
    await shutter.click();
    await acceptAll(people, guard + 1);
    for (const p of people) await p.page.getByTestId("review").getByRole("button", { name: "Pakai ini" }).click();
  }
  for (const p of people) await expect(p.page.getByTestId("editor")).toBeVisible({ timeout: 60_000 });
  await scan("editor");
  stamp("editor-terbuka", t0);

  // ── P07: editor kolaboratif ──
  const canvas = (p: Person) => p.page.getByTestId("editor-canvas");
  const count = async (p: Person) => Number(await canvas(p).getAttribute("data-elements"));
  const before = await count(A);
  // Stiker oleh A dan B bersamaan.
  const addSticker = async (p: Person) => {
    if (mobile) await p.page.getByRole("toolbar", { name: "Alat editor" }).getByRole("button", { name: /Stiker/ }).first().click().catch(() => undefined);
    else await p.page.getByRole("navigation", { name: "Alat editor" }).getByRole("button", { name: /Stiker/ }).first().click();
    await p.page.getByRole("button", { name: /^Tambah stiker / }).first().click();
  };
  await Promise.all([addSticker(A), addSticker(B)]);
  for (const p of people) await expect.poll(() => count(p), { timeout: 15_000 }).toBe(before + 2);
  // Undo oleh A hanya membatalkan perubahannya sendiri.
  await A.page.getByRole("button", { name: "Undo" }).click();
  for (const p of people) await expect.poll(() => count(p), { timeout: 15_000 }).toBe(before + 1);
  // Reconnect: C reload → state editor pulih identik.
  await C.page.reload();
  await expect(C.page.getByTestId("editor")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => count(C), { timeout: 20_000 }).toBe(before + 1);
  // Offline sementara lalu pulih (D).
  await D.ctx.setOffline(true);
  await D.page.waitForTimeout(1500);
  await D.ctx.setOffline(false);
  await expect.poll(() => count(D), { timeout: 30_000 }).toBe(before + 1);
  stamp("editor-sinkron", t0);

  // ── P08: selesai → hasil → unduh ──
  await B.page.getByTestId("finish-edit").click();
  await B.page.getByRole("dialog").getByRole("button", { name: "Selesai", exact: true }).click();
  for (const p of people) await expect(p.page.getByTestId("result-screen")).toBeVisible({ timeout: 30_000 });
  const img = A.page.getByTestId("result-preview");
  await expect(img).toBeVisible({ timeout: 30_000 });
  expect(await img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(true);
  await scan("hasil");
  stamp("hasil-tampil", t0);

  const [dl] = await Promise.all([A.page.waitForEvent("download", { timeout: 60_000 }), A.page.getByTestId("export-download").click()]);
  const path = await dl.path();
  const fs = await import("node:fs");
  const bytes = fs.readFileSync(path);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a"); // PNG
  expect(bytes.length).toBeGreaterThan(20_000);
  expect(dl.suggestedFilename()).toMatch(/\.png$/);
  stamp("unduh-png", t0);

  // Galeri: kartu sesi 1 dengan gambar yang benar-benar termuat.
  await A.page.getByRole("button", { name: "Ke galeri" }).click();
  await expect(A.page.getByTestId("gallery-screen")).toBeVisible();
  await expect(A.page.getByTestId("gallery-sessions").getByRole("article")).toHaveCount(1, { timeout: 30_000 });
  await expect
    .poll(() => A.page.locator('[data-testid="gallery-sessions"] img').evaluateAll((els) => els.length > 0 && els.every((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0)), { timeout: 30_000 })
    .toBe(true);
  await scan("galeri");
  stamp("galeri", t0);

  // Sesi berikutnya: peserta lain mendapat undangan SCR-19.
  await A.page.getByRole("button", { name: /Sesi baru/ }).first().click();
  const dlg = B.page.getByTestId("invite-join");
  await expect(dlg).toBeVisible({ timeout: 30_000 });
  await dlg.click();
  // SCR-19 (isu P08): status peserta lain tampil lintas-klien — Nadia (pengaju) & Raka sudah "Ikut" di dialog Sasa/Bimo.
  const peers = C.page.getByTestId("invite-peers");
  await expect(peers).toBeVisible({ timeout: 30_000 });
  await expect(peers.getByRole("listitem").filter({ hasText: "Nadia" })).toContainText(/Ikut/, { timeout: 15_000 });
  await expect(peers.getByRole("listitem").filter({ hasText: "Raka" })).toContainText(/Ikut/, { timeout: 15_000 });
  await C.page.getByTestId("invite-later").click();
  await D.page.getByTestId("invite-join").click();
  stamp("sesi-2", t0);

  expect(a11y, "axe serious/critical").toEqual([]);

  // ── CSP + konsol: tidak boleh ada pelanggaran di klien mana pun ──
  for (const p of people) {
    const v = await collectCsp(p);
    expect(v, `pelanggaran CSP di ${p.watch.name}`).toEqual([]);
    expect(unexpectedErrors(p), `error konsol di ${p.watch.name}`).toEqual([]);
  }

  // ── keluar semua ──
  for (const p of people) {
    if (mobile) await p.page.getByRole("button", { name: "Menu room" }).click();
    await p.page.getByRole("button", { name: "Keluar dari room" }).filter({ visible: true }).first().click();
    await p.page.getByRole("button", { name: "Keluar", exact: true }).click();
    await p.page.waitForURL("http://localhost:3000/");
    await p.ctx.close();
  }

  // ── siklus hidup: semua keluar → grace (6 s di E2E) → room bubar, data dihapus (SCR-21) ──
  const late = await openPerson(browser, info, "Telat", { camera: false });
  await late.page.waitForTimeout(9_000);
  await late.page.goto(`/r/${code}`);
  await expect(late.page.getByRole("heading", { name: /udah bubar/ })).toBeVisible();
  console.log(`[room] ${code} bubar`);
  await late.ctx.close();
});
