import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { animatedWebp, asApng, bombPng, framePng } from "../../test/fixtures/frames";
import { isAnimated, processFrame, sniffType } from "./pipeline";

describe("pipeline frame (DEC-041, TC-FRAME-010/011, TC-SEC-016/017)", () => {
  it("AC-P05-4: PNG valid → diterima, re-encode PNG, 4 lubang terdeteksi, warna tepi", async () => {
    const r = await processFrame(await framePng(), "image/png");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.holes).toHaveLength(4);
    expect(sniffType(r.png)).toBe("image/png");
    expect(r.width).toBe(1200);
    expect(r.edgeColor).toBe("#F0DCC8");
    for (const h of r.holes) expect(h.w).toBeGreaterThan(900);
  });

  it("re-encode membuang metadata (EXIF) dari file asli", async () => {
    const src = await framePng(800, 800, 1, { text: "rahasia-gps-xyz" });
    expect(src.includes(Buffer.from("rahasia-gps-xyz"))).toBe(true);
    const r = await processFrame(src, "image/png");
    expect(r.ok && r.png.includes(Buffer.from("rahasia-gps-xyz"))).toBe(false);
    expect(r.ok && (await sharp(r.png).metadata()).exif).toBeUndefined();
  });

  it("WebP valid diterima (dikonversi PNG)", async () => {
    const webp = await sharp(await framePng(900, 900, 2)).webp({ lossless: true }).toBuffer();
    const r = await processFrame(webp, "image/webp");
    expect(r.ok && r.holes.length).toBe(2);
  });

  it("AC-P05-7 / TC-SEC-016: SVG menyamar sebagai PNG, tipe tidak cocok, GIF/JPEG → FRAME_UNSUPPORTED", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><script>alert(1)</script></svg>');
    expect(await processFrame(svg, "image/png")).toMatchObject({ ok: false, error: "FRAME_UNSUPPORTED", reason: "MAGIC" });
    expect(await processFrame(await framePng(800, 800, 1), "image/webp")).toMatchObject({ ok: false, error: "FRAME_UNSUPPORTED", reason: "TYPE_MISMATCH" });
    const jpg = await sharp({ create: { width: 800, height: 800, channels: 3, background: "#fff" } }).jpeg().toBuffer();
    expect(await processFrame(jpg, "image/png")).toMatchObject({ ok: false, error: "FRAME_UNSUPPORTED" });
  });

  it("AC-P05-7 / TC-SEC-017: decompression bomb ditolak dari header tanpa decode (cepat, tanpa lonjakan memori)", async () => {
    const bomb = bombPng();
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);
    const before = process.memoryUsage().rss;
    const t0 = Date.now();
    expect(await processFrame(bomb, "image/png")).toMatchObject({ ok: false, error: "FRAME_DIMENSIONS", reason: "TOO_BIG" });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(process.memoryUsage().rss - before).toBeLessThan(200 * 1024 * 1024);
  });

  it("animasi (APNG / WebP animasi) ditolak", async () => {
    const png = await framePng(800, 800, 1);
    const apng = asApng(png);
    expect(isAnimated(apng, "image/png")).toBe(true);
    expect(await processFrame(apng, "image/png")).toMatchObject({ ok: false, error: "FRAME_UNSUPPORTED", reason: "ANIMATED" });
    const anim = await animatedWebp(700, 700);
    expect(await processFrame(anim, "image/webp")).toMatchObject({ ok: false, error: "FRAME_UNSUPPORTED", reason: "ANIMATED" });
  });

  it("dimensi di luar 600–6000 px dan file rusak ditolak", async () => {
    const small = await sharp({ create: { width: 400, height: 500, channels: 4, background: "#fff0" } }).png().toBuffer();
    expect(await processFrame(small, "image/png")).toMatchObject({ ok: false, error: "FRAME_DIMENSIONS", reason: "TOO_SMALL" });
    const big = await sharp({ create: { width: 6400, height: 700, channels: 3, background: "#fff" } }).png({ compressionLevel: 9 }).toBuffer();
    expect(await processFrame(big, "image/png")).toMatchObject({ ok: false, error: "FRAME_DIMENSIONS" });
    const broken = Buffer.concat([(await framePng(800, 800, 1)).subarray(0, 60), Buffer.alloc(500, 7)]);
    expect(await processFrame(broken, "image/png")).toMatchObject({ ok: false, error: "FRAME_DECODE_FAILED" });
  });

  it("> 10 MB ditolak sebelum diproses", async () => {
    expect(await processFrame(new Uint8Array(10 * 1024 * 1024 + 1), "image/png")).toMatchObject({ ok: false, error: "FRAME_TOO_LARGE" });
  });
});
