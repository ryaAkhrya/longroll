# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: studio.spec.ts >> 4 peserta: studio, frame lokal vs Pasang buat semua, Balikin, filter, layout, upload frame, reload
- Location: e2e\studio.spec.ts:48:5

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator: getByRole('img', { name: /^(Hasil sementara|Pratinjau)/ }).first()
Expected: "4"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toHaveAttribute" getByRole('img', { name: /^(Hasil sementara|Pratinjau)/ }).first() with timeout 5000ms
  - waiting for getByRole('img', { name: /^(Hasil sementara|Pratinjau)/ }).first()

```

```yaml
- link "Lompat ke konten":
  - /url: "#main"
- banner:
  - link "LONGROLL, ke beranda":
    - /url: /
    - text: longroll
  - button "Salin kode room Q9GCDZ": Room Q9GCDZ
  - list "Tahap sesi":
    - listitem: Vote
    - listitem: Foto
    - listitem: Edit
    - listitem: Hasil
  - 'group "4 peserta di room: Nadia, Raka, Sasa, Bimo"':
    - img "Nadia"
    - img "Raka"
    - img "Sasa"
    - img "Bimo"
  - button "Keluar dari room"
- main:
  - region "Studio sesi 1":
    - navigation "Alat studio":
      - button "Frame"
      - button "Layout"
      - button "Kamera"
      - button "Filter"
    - list "Kamera peserta":
      - listitem "Kamera Nadia (kamu), live":
        - text: Kualitas diturunkan
        - button "Buka pengaturan Kameraku"
        - button "Matikan kamera kamu"
      - listitem "Kamera Raka, live"
      - listitem "Kamera Sasa, live"
      - listitem "Kamera Bimo, live"
    - complementary:
      - region "Hasil sementara": Hasil sementara Bareng
      - term: Mode
      - definition: Photo Strip
      - term: Frame
      - definition:
        - button "Seoul Strip"
      - term: Layout
      - definition:
        - button "4 shot · 4:3"
    - group "Timer countdown":
      - button "3 dtk"
      - button "5 dtk" [pressed]
      - button "10 dtk"
    - text: Shot
    - strong: 1/4
    - button "Ambil foto, hitung mundur 5 detik"
    - text: Siap
    - strong: 0/4
    - button "Bentar"
    - paragraph: Siapa aja boleh cekrek
- region "Notifikasi"
- alert
```

# Test source

```ts
  1   | import { expect, test } from "@playwright/test";
  2   | import type { Page } from "@playwright/test";
  3   | import sharp from "sharp";
  4   | import { createRoom, joinRoom, newPage, playingRemoteVideos } from "./helpers";
  5   | 
  6   | /**
  7   |  * P05 (AC-P05-1/2/3/4/5/11/13, TC-FRAME-001..004, 010, 011): 4 konteks, media palsu Chromium.
  8   |  * Masuk studio lewat voting nyata, lalu frame/filter/layout bersama, pratinjau lokal, Balikin,
  9   |  * upload frame custom, reload, dan dock/sheet mobile.
  10  |  */
  11  | 
  12  | const SHOTS = process.env.LR_SCREENSHOT_DIR;
  13  | async function shot(page: Page, name: string) {
  14  |   if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
  15  | }
  16  | 
  17  | const result = (p: Page) => p.getByRole("img", { name: /^Hasil sementara/ });
  18  | /** Kanvas output bersama yang terlihat (Hasil sementara, atau pratinjau besar saat panel terbuka). */
  19  | const out = (p: Page) => p.getByRole("img", { name: /^(Hasil sementara|Pratinjau)/ }).first();
  20  | 
  21  | async function toStudio(pages: Page[], mode = "Photo Strip") {
  22  |   await pages[1]!.getByRole("button", { name: "Mulai vote mode" }).click();
  23  |   for (const p of pages) await p.getByRole("radio", { name: new RegExp(`^${mode}\\.`) }).click();
  24  |   for (const p of pages) {
  25  |     await expect(p.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 10_000 });
  26  |   }
  27  | }
  28  | 
  29  | async function framePng(holes: number): Promise<Buffer> {
  30  |   const w = 1000;
  31  |   const h = 3000;
  32  |   const hh = (h - 100 * (holes + 1)) / holes;
  33  |   const rects = Array.from({ length: holes }, (_, i) => `<rect x="90" y="${100 + i * (hh + 100)}" width="${w - 180}" height="${hh}" fill="black"/>`).join("");
  34  |   const mask = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="white"/>${rects}</svg>`))
  35  |     .greyscale()
  36  |     .raw()
  37  |     .toBuffer();
  38  |   const rgba = Buffer.alloc(w * h * 4);
  39  |   for (let i = 0; i < w * h; i++) {
  40  |     rgba[i * 4] = 59;
  41  |     rgba[i * 4 + 1] = 35;
  42  |     rgba[i * 4 + 2] = 80;
  43  |     rgba[i * 4 + 3] = mask[i]!;
  44  |   }
  45  |   return sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  46  | }
  47  | 
  48  | test("4 peserta: studio, frame lokal vs Pasang buat semua, Balikin, filter, layout, upload frame, reload", async ({ browser }) => {
  49  |   test.setTimeout(300_000);
  50  |   const ps = await Promise.all([0, 1, 2, 3].map(() => newPage(browser, { width: 1440, height: 900 })));
  51  |   const [a, b, c, d] = ps.map((p) => p.page) as [Page, Page, Page, Page];
  52  |   const code = await createRoom(a, "Nadia");
  53  |   await joinRoom(b, code, "Raka");
  54  |   await joinRoom(c, code, "Sasa");
  55  |   await joinRoom(d, code, "Bimo");
  56  |   await toStudio([a, b, c, d]);
  57  | 
  58  |   // Studio awal: plan default sementara (DEC-061 OPEN) Strip 4 shot, feed live di slot.
> 59  |   for (const p of [a, b, c, d]) await expect(out(p)).toHaveAttribute("data-slots", "4");
      |                                                      ^ Error: expect(locator).toHaveAttribute(expected) failed
  60  |   await expect.poll(() => playingRemoteVideos(a), { timeout: 30_000 }).toBe(3);
  61  |   await expect.poll(() => result(a).locator("[data-participant] video").count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(16);
  62  |   await shot(a, "p05-studio-desktop");
  63  | 
  64  |   // AC-P05-2: pratinjau lokal tidak mengubah klien lain; presence "lagi lihat".
  65  |   await a.getByRole("button", { name: "Frame", exact: true }).click();
  66  |   await a.getByRole("option", { name: /^Film 400/ }).click();
  67  |   await expect(a.getByRole("img", { name: /^Pratinjau Film 400/ })).toHaveAttribute("data-frame", "builtin/film-400@1");
  68  |   await expect(result(b)).toHaveAttribute("data-frame", "builtin/seoul-strip@1");
  69  |   await expect(b.getByRole("button", { name: "Frame", exact: true })).toBeVisible();
  70  |   await b.getByRole("button", { name: "Frame", exact: true }).click();
  71  |   await expect(b.getByText(/Nadia lagi lihat Film 400/)).toBeVisible();
  72  |   await b.getByRole("button", { name: "Frame", exact: true }).click();
  73  |   await shot(a, "p05-frame-panel");
  74  | 
  75  |   // AC-P05-1: Pasang buat semua ≤ 1 s di 3 klien lain + toast dengan Balikin.
  76  |   await a.getByRole("button", { name: "Pasang buat semua" }).click();
  77  |   await Promise.all([c, d].map((p) => expect(result(p)).toHaveAttribute("data-frame", "builtin/film-400@1", { timeout: 1_000 })));
  78  |   await expect(c.getByText("Nadia pasang Film 400")).toBeVisible();
  79  |   await expect(result(c)).toHaveAttribute("data-frame", "builtin/film-400@1");
  80  | 
  81  |   // Balikin satu langkah dari klien lain.
  82  |   await c.getByRole("button", { name: "Balikin" }).first().click();
  83  |   for (const p of [a, b, d]) await expect(result(p).or(p.getByRole("img", { name: /^Pratinjau/ })).first()).toHaveAttribute("data-frame", "builtin/seoul-strip@1");
  84  |   await a.getByRole("button", { name: "Frame", exact: true }).click();
  85  | 
  86  |   // Filter grup tersinkron.
  87  |   await d.getByRole("button", { name: "Filter", exact: true }).click();
  88  |   await d.getByRole("radio", { name: "Mono" }).click();
  89  |   for (const p of [a, b, c]) await expect(out(p)).toHaveAttribute("data-filter", "MONO");
  90  |   await expect(a.getByText("Bimo ganti filter ke Mono")).toBeVisible();
  91  | 
  92  |   // AC-P05-3 / TC-FRAME-005/006: jumlah shot & strategi sebelum shot 1; safeguard menampilkan alternatif.
  93  |   await b.getByRole("button", { name: "Layout", exact: true }).click();
  94  |   await b.getByRole("button", { name: "Tambah shot" }).click();
  95  |   for (const p of [a, c, d]) await expect(out(p)).toHaveAttribute("data-slots", "5");
  96  |   await b.getByRole("radio", { name: "Foto per orang" }).click();
  97  |   for (const p of [a, c, d]) await expect(out(p)).toHaveAttribute("data-slots", "20");
  98  |   for (let i = 0; i < 3; i++) await b.getByRole("button", { name: "Tambah shot" }).click();
  99  |   await expect(out(a)).toHaveAttribute("data-slots", "32");
  100 |   await expect(b.getByText(/8 shot × 4 orang jadi 32 foto/)).toBeVisible();
  101 |   await b.getByRole("button", { name: "Tambah shot" }).click();
  102 |   await expect(b.getByText(/9 shot belum bisa/)).toBeVisible();
  103 |   await expect(out(a)).toHaveAttribute("data-slots", "32");
  104 |   await shot(b, "p05-layout-panel");
  105 |   await b.getByRole("button", { name: "Pakai 8 shot" }).click();
  106 |   await b.getByRole("radio", { name: "Foto bareng per shot" }).click();
  107 |   for (const p of [a, c, d]) await expect(out(p)).toHaveAttribute("data-slots", "8");
  108 | 
  109 |   // AC-P05-4: upload frame custom dari satu klien terlihat di klien lain; dipasang FIXED mengikuti lubang.
  110 |   await c.getByRole("button", { name: "Frame", exact: true }).click();
  111 |   await c.getByRole("button", { name: "Upload frame" }).click();
  112 |   await c.getByLabel("Pilih file frame (PNG atau WebP)").setInputFiles({ name: "frame-kita.png", mimeType: "image/png", buffer: await framePng(4) });
  113 |   await expect(c.getByText(/4 lubang ketemu/)).toBeVisible({ timeout: 20_000 });
  114 |   // 8 shot tapi frame cuma 4 lubang → alasan + alternatif (bukan potong diam-diam).
  115 |   await expect(c.getByText(/Frame ini cuma punya 4 lubang, butuh 8/)).toBeVisible();
  116 |   await expect(c.getByRole("button", { name: "Pasang buat semua" })).toBeDisabled();
  117 |   await shot(c, "p05-upload-panel");
  118 |   await c.getByRole("button", { name: "Pakai 4 shot" }).click();
  119 |   for (const p of [a, b, d]) await expect(out(p)).toHaveAttribute("data-slots", "4");
  120 |   await expect(a.getByText("Sasa pasang frame-kita · 4 shot")).toBeVisible();
  121 |   await a.getByRole("button", { name: "Frame", exact: true }).click();
  122 |   await a.getByRole("button", { name: "Punyaku" }).click();
  123 |   await expect(a.getByRole("option", { name: /^frame-kita, Punyaku, dipakai/ })).toBeVisible();
  124 |   await shot(a, "p05-custom-frame");
  125 |   await a.getByRole("button", { name: "Frame", exact: true }).click();
  126 | 
  127 |   // AC-P05-5: > 10 MB ditolak dengan pesan (cek klien; server diuji di integrasi).
  128 |   await c.getByRole("button", { name: "Upload frame" }).click();
  129 |   await c.getByLabel("Pilih file frame (PNG atau WebP)").setInputFiles({ name: "frame-glitter.png", mimeType: "image/png", buffer: Buffer.alloc(11 * 1024 * 1024, 1) });
  130 |   await expect(c.getByText("frame-glitter.png kebesaran (11 MB). Maksimal 10 MB.")).toBeVisible();
  131 | 
  132 |   // Reload salah satu peserta: studio pulih dari snapshot (frame custom, filter, layout).
  133 |   await d.reload();
  134 |   await expect(d.getByRole("region", { name: "Studio sesi 1" })).toBeVisible({ timeout: 15_000 });
  135 |   await expect(result(d)).toHaveAttribute("data-filter", "MONO");
  136 |   await expect(out(d)).toHaveAttribute("data-slots", "4");
  137 | 
  138 |   for (const p of ps) await p.ctx.close();
  139 | });
  140 | 
  141 | test("mobile: feed fullscreen, dock (Timer & shutter nonaktif), Alat → sheet Frame → Pasang buat semua", async ({ browser }) => {
  142 |   test.setTimeout(120_000);
  143 |   const a = await newPage(browser, { width: 390, height: 844 });
  144 |   const b = await newPage(browser, { width: 1280, height: 800 });
  145 |   const code = await createRoom(a.page, "Nadia");
  146 |   await joinRoom(b.page, code, "Raka");
  147 |   await toStudio([a.page, b.page], "Photo Grid");
  148 |   const m = a.page;
  149 |   await expect(m.getByRole("button", { name: /^Timer \d+s/ })).toBeEnabled();
  150 |   await expect(m.getByRole("button", { name: /^Ambil foto, hitung mundur/ })).toBeEnabled();
  151 |   await expect(m.getByText(code, { exact: true }).filter({ visible: true }).first()).toBeVisible();
  152 |   await shot(m, "p05-studio-mobile");
  153 |   await m.getByRole("button", { name: "Alat" }).click();
  154 |   await expect(m.getByRole("dialog", { name: "Alat" })).toBeVisible();
  155 |   await m.getByRole("button", { name: /^Frame/ }).click();
  156 |   await m.getByRole("option", { name: /^Lilac Dream/ }).click();
  157 |   await shot(m, "p05-frame-mobile");
  158 |   await m.getByRole("button", { name: "Pasang Lilac Dream buat semua" }).click();
  159 |   await expect(result(b.page)).toHaveAttribute("data-frame", "builtin/lilac-dream@1");
```