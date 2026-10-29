import fs from "node:fs";
import { expect, test } from "@playwright/test";
import type { Download, Locator } from "@playwright/test";
import { createRoom, joinRoom, openPerson, playingRemoteVideos, shutterName, unexpectedErrors, collectCsp } from "./kit";
import type { Person } from "./kit";

/**
 * P10 — multi-shot (Photo Strip) + bukti BYTE-LEVEL bahwa Ulang/Pakai bersifat independen:
 *  - foto yang sudah "Pakai" milik A/B/C tidak berubah byte-nya (milik sendiri maupun yang dilihat peserta lain) saat D mengulang;
 *  - foto lama D yang diulang tetap terlihat byte-identik oleh yang lain, take baru D berbeda dari take lama;
 *  - semua penonton melihat byte yang sama untuk foto yang sama;
 *  - galeri hanya memuat foto yang diterima (take yang diulang tidak ada), semuanya unik;
 *  - PNG hasil: dimensi sama dengan label ukuran ekspor, dan konsisten antar-klien.
 * Memakai kamera palsu Chromium (bukan perangkat nyata).
 */
/**
 * SHA-256 isi gambar. URL http(s) bertanda tangan: byte file apa adanya (fetch, diizinkan connect-src). URL `blob:` (pratinjau
 * lokal milik sendiri) tidak boleh di-fetch oleh CSP connect-src, jadi hash dihitung dari PIKSEL yang didekode (canvas, same-origin).
 */
const sha = (loc: Locator) =>
  loc.evaluate(async (img: HTMLImageElement) => {
    const hex = (d: ArrayBuffer) => Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
    if (img.src.startsWith("blob:")) {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return "px:" + hex(await crypto.subtle.digest("SHA-256", ctx.getImageData(0, 0, c.width, c.height).data));
    }
    try {
      return "file:" + hex(await crypto.subtle.digest("SHA-256", await (await fetch(img.src)).arrayBuffer()));
    } catch (e) {
      throw new Error(`fetch gagal untuk ${img.src.slice(0, 60)}: ${(e as Error).message}`);
    }
  });

const pngDims = (buf: Buffer) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });
const ownImg = (p: Person) => p.page.getByTestId("my-photo").locator("img");
const seen = (viewer: Person, owner: string) => viewer.page.getByRole("img", { name: `Foto ${owner}`, exact: true });
const rejected = (viewer: Person, owner: string, take = 1) => viewer.page.getByRole("img", { name: `Take ${take} ${owner}, diulang`, exact: true });

async function download(p: Person): Promise<{ bytes: Buffer; file: Download }> {
  const [file] = await Promise.all([p.page.waitForEvent("download", { timeout: 60_000 }), p.page.getByTestId("export-download").click()]);
  return { bytes: fs.readFileSync(await file.path()), file };
}

test("Photo Strip multi-shot: Ulang/Pakai independen (byte-level), galeri hanya foto diterima, ekspor konsisten", async ({ browser }, info) => {
  test.skip(info.project.name !== "chromium-desktop", "satu proyek cukup (kamera palsu Chromium)");
  test.setTimeout(480_000);
  const names = ["Nadia", "Raka", "Sasa", "Bimo"];
  const people: Person[] = [];
  for (const [i, n] of names.entries()) people.push(await openPerson(browser, info, n, { fakeVideoIdx: i }));
  const [A, B, C, D] = people as [Person, Person, Person, Person];
  const code = await createRoom(A.page, "Nadia");
  await joinRoom(B.page, code, "Raka");
  await joinRoom(C.page, code, "Sasa");
  await joinRoom(D.page, code, "Bimo");
  for (const p of people) await expect.poll(() => playingRemoteVideos(p.page), { timeout: 45_000 }).toBe(3);

  await C.page.getByRole("button", { name: "Mulai vote mode" }).click();
  for (const p of people) await p.page.getByRole("radio", { name: /^Photo Strip\./ }).click();
  for (const p of people) await expect(p.page.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 20_000 });

  const review = (p: Person) => p.page.getByTestId("review");
  const acceptBtn = (p: Person) => review(p).getByRole("button", { name: "Pakai ini" });
  const ready = async () => {
    for (const p of people) {
      await expect(review(p)).toBeVisible({ timeout: 60_000 });
      await expect(acceptBtn(p)).toBeEnabled({ timeout: 60_000 });
    }
  };
  const shotTotal = Number(/dari (\d+)/.exec((await (async () => { await C.page.getByRole("button", { name: shutterName }).click(); await ready(); return review(A).locator("p.cap").first().textContent(); })()) ?? "")?.[1]);
  expect(shotTotal, "Photo Strip harus multi-shot").toBeGreaterThanOrEqual(3);
  console.log(`[multishot] shotTotal=${shotTotal}`);

  // ── Shot 1: A, B, C menerima; D mengulang ──
  const owners = [A, B, C, D];
  // Semua melihat foto semua orang lain (server-side preview) sebelum keputusan.
  for (const v of people) for (const o of people) if (v !== o) await expect(seen(v, o.watch.name)).toBeVisible({ timeout: 30_000 });
  const own1: Record<string, string> = {};
  for (const o of owners) own1[o.watch.name] = await sha(ownImg(o));
  // Bimo (D) belum mengulang: catat apa yang dilihat tiap penonton untuk setiap pemilik.
  const view1: Record<string, Record<string, string>> = {};
  for (const v of people) {
    view1[v.watch.name] = {};
    for (const o of people) if (v !== o) view1[v.watch.name]![o.watch.name] = await sha(seen(v, o.watch.name));
  }
  // Semua penonton melihat byte yang sama untuk pemilik yang sama (konsistensi antar-klien).
  for (const o of people) {
    const hs = new Set(people.filter((v) => v !== o).map((v) => view1[v.watch.name]![o.watch.name]));
    expect(hs.size, `penonton berbeda melihat byte berbeda untuk foto ${o.watch.name}`).toBe(1);
  }
  // Setiap pemilik menghasilkan foto berbeda (kamera palsu bergerak + take terpisah).
  expect(new Set(Object.values(own1)).size).toBeGreaterThan(1);

  for (const p of [A, B, C]) await acceptBtn(p).click();
  const d1 = view1["Nadia"]!["Bimo"]!; // take 1 D sebagaimana dilihat orang lain (varian server)
  await review(D).getByRole("button", { name: "Ulang" }).click();
  // Take ke-2 D: butuh countdown + unggah; tombol baru aktif setelah foto siap (tidak ada auto-accept).
  await expect.poll(async () => (await acceptBtn(D).isEnabled()) && (await sha(ownImg(D))) !== own1["Bimo"], { timeout: 60_000 }).toBe(true);
  const d2 = await sha(ownImg(D));
  expect(d2).not.toBe(own1["Bimo"]);

  // Byte-level: foto A/B/C tidak berubah, baik di layar pemiliknya maupun di layar orang lain.
  for (const o of [A, B, C]) {
    expect(await sha(ownImg(o)), `foto milik ${o.watch.name} berubah setelah orang lain mengulang`).toBe(own1[o.watch.name]);
    await expect(review(o)).toHaveAttribute("data-my-status", "ACCEPTED");
  }
  for (const v of people) {
    for (const o of [A, B, C]) {
      if (v === o) continue;
      expect(await sha(seen(v, o.watch.name)), `${v.watch.name} melihat foto ${o.watch.name} berubah`).toBe(view1[v.watch.name]![o.watch.name]);
    }
  }
  // Take lama D terlihat (ditandai diulang) oleh yang lain dengan byte identik dengan yang dulu dilihat; take baru berbeda.
  for (const v of [A, B, C]) {
    await expect(rejected(v, "Bimo")).toBeVisible({ timeout: 30_000 });
    expect(await sha(rejected(v, "Bimo")), "take lama D berubah").toBe(view1[v.watch.name]!["Bimo"]);
    await expect(seen(v, "Bimo")).toBeVisible({ timeout: 30_000 });
    expect(await sha(seen(v, "Bimo"))).not.toBe(view1[v.watch.name]!["Bimo"]);
  }
  // Yang diterima = byte file yang dilihat orang lain (varian preview di server) pada saat keputusan.
  const viewerOf = (name: string) => (name === "Nadia" ? B : A);
  const accepted: string[] = [view1["Raka"]!["Nadia"]!, view1["Nadia"]!["Raka"]!, view1["Nadia"]!["Sasa"]!, await sha(seen(A, "Bimo"))];

  await acceptBtn(D).click();
  // ── Shot 2..N: semua menerima ──
  for (let shot = 2; shot <= shotTotal; shot++) {
    const shutter = A.page.getByRole("button", { name: shutterName });
    await expect(shutter).toBeEnabled({ timeout: 60_000 });
    await shutter.click();
    await ready();
    for (const o of owners) {
      const img = seen(viewerOf(o.watch.name), o.watch.name);
      await expect(img).toBeVisible({ timeout: 30_000 });
      accepted.push(await sha(img));
    }
    for (const p of people) await acceptBtn(p).click();
  }
  for (const p of people) await expect(p.page.getByTestId("editor")).toBeVisible({ timeout: 60_000 });

  // ── Editor → final → hasil ──
  await B.page.getByTestId("finish-edit").click();
  await B.page.getByRole("dialog").getByRole("button", { name: "Selesai", exact: true }).click();
  for (const p of people) await expect(p.page.getByTestId("result-screen")).toBeVisible({ timeout: 30_000 });
  await expect(A.page.getByTestId("result-preview")).toBeVisible({ timeout: 30_000 });

  // ── Ekspor: dimensi PNG = label ukuran; konsisten antar-klien ──
  const label = (await A.page.getByTestId("export-size").textContent()) ?? "";
  const m = /(\d[\d.]*)\s*[×x]\s*(\d[\d.]*)/.exec(label.replace(/\s/g, " "));
  expect(m, `label ukuran tidak terbaca: "${label}"`).toBeTruthy();
  const want = { w: Number(m![1]!.replace(/\./g, "")), h: Number(m![2]!.replace(/\./g, "")) };
  const dA = await download(A);
  const dC = await download(C);
  expect(dA.bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(pngDims(dA.bytes)).toEqual(want);
  expect(pngDims(dC.bytes)).toEqual(want);
  expect(dA.bytes.length).toBeGreaterThan(50_000);
  const hashEqual = dA.bytes.equals(dC.bytes);
  test.info().annotations.push({ type: "export-dims", description: `${want.w}x${want.h}; byte-identik antar-klien: ${hashEqual}; ${dA.bytes.length} B` });
  console.log(`[multishot] export ${want.w}x${want.h} identik-antar-klien=${hashEqual} bytes=${dA.bytes.length}`);
  expect(Math.abs(dA.bytes.length - dC.bytes.length) / dA.bytes.length, "ukuran file antar-klien terlalu berbeda").toBeLessThan(0.02);

  // Preset "Cetak 300 dpi" (2× dasar) dan "Story" (1080×1920): dimensi PNG = label; 2× tepat dari ukuran dasar.
  const sizeOf = async () => {
    const t = (await A.page.getByTestId("export-size").textContent()) ?? "";
    const mm = /(\d[\d.]*)\s*[×x]\s*(\d[\d.]*)/.exec(t);
    return { label: t, w: Number(mm![1]!.replace(/\./g, "")), h: Number(mm![2]!.replace(/\./g, "")) };
  };
  for (const [preset, check] of [
    [/Cetak 300 dpi/, (z: { w: number; h: number }) => expect(z).toEqual({ w: want.w * 2, h: want.h * 2 })],
    [/Story/, (z: { w: number; h: number }) => expect(z).toEqual({ w: 1080, h: 1920 })],
  ] as const) {
    await A.page.getByRole("radiogroup", { name: "Ukuran hasil" }).getByRole("radio", { name: preset }).click();
    await expect.poll(async () => (await sizeOf()).label, { timeout: 15_000 }).not.toBe(label);
    const z = await sizeOf();
    const big = await download(A);
    expect(big.bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(pngDims(big.bytes)).toEqual({ w: z.w, h: z.h });
    check({ w: z.w, h: z.h });
    console.log(`[multishot] export ${String(preset)} ${z.w}x${z.h} bytes=${big.bytes.length}`);
  }

  // ── Galeri: hanya foto yang diterima (4 orang × N shot), semuanya unik, take diulang tidak ada ──
  await A.page.getByRole("button", { name: "Ke galeri" }).click();
  await A.page.getByRole("button", { name: "Per orang" }).click();
  const imgs = A.page.getByTestId("gallery-people").locator("img");
  await expect(imgs).toHaveCount(4 * shotTotal, { timeout: 30_000 });
  await expect.poll(() => imgs.evaluateAll((els) => els.every((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0)), { timeout: 30_000 }).toBe(true);
  const galleryHashes: string[] = [];
  for (let i = 0; i < 4 * shotTotal; i++) galleryHashes.push(await sha(imgs.nth(i)));
  // Galeri = tepat foto yang diterima (multiset sama), jadi take D yang diulang tidak ikut.
  expect([...galleryHashes].sort()).toEqual([...accepted].sort());
  const countOf = (arr: string[], h: string) => arr.filter((x) => x === h).length;
  expect(countOf(galleryHashes, d1), "take D yang diulang muncul di galeri").toBe(countOf(accepted, d1));

  for (const p of people) {
    expect(await collectCsp(p), `CSP ${p.watch.name}`).toEqual([]);
    expect(unexpectedErrors(p), `error konsol ${p.watch.name}`).toEqual([]);
  }
  for (const p of people) await p.done();
});
