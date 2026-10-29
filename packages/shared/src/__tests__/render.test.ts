import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  EXPORT_LIMITS,
  PARTICIPANT_SLOTS,
  addPngDpi,
  addSticker,
  addText,
  buildScene,
  computeExportSize,
  createEditorDoc,
  crc32,
  drawDocument,
  drawElement,
  exportFileName,
  generatePlan,
  initStudio,
  listElements,
  needsTiling,
  physChunk,
  pngChunk,
  qualityWarnings,
  tilePlan,
  updateElement,
} from "../index";
import type { Ctx2D, DocumentModel, DrawResources, ElementSnapshot } from "../index";

// ---------------------------------------------------------------- konteks perekam (golden operasi)
type Call = [string, ...unknown[]];
function recorder() {
  const log: Call[] = [];
  const methods = ["save", "restore", "translate", "rotate", "scale", "beginPath", "closePath", "moveTo", "lineTo", "quadraticCurveTo", "arcTo", "rect", "clip", "fill", "stroke", "fillRect", "fillText", "drawImage"];
  const ctx = new Proxy(
    {} as Record<string, unknown>,
    {
      get(_t, prop: string) {
        if (methods.includes(prop)) return (...a: unknown[]) => void log.push([prop, ...a]);
        if (prop === "measureText") return (s: string) => ({ width: s.length * 10 });
        if (prop === "createLinearGradient") return (...a: number[]) => ({ addColorStop: (o: number, c: string) => void log.push(["stop", o, c]), grad: a });
        return undefined;
      },
      set(_t, prop: string, value) {
        log.push([`set:${prop}`, value]);
        return true;
      },
    },
  ) as unknown as Ctx2D;
  return { ctx, log };
}

const names = (log: Call[]) => log.map((c) => c[0]);
const img = (w: number, h: number) => ({ naturalWidth: w, naturalHeight: h });
const res = (photos: Record<string, ReturnType<typeof img>> = {}): DrawResources => ({
  photo: (id) => photos[id] ?? null,
  overlay: null,
  path: (d) => `path(${d.slice(0, 6)})`,
  pattern: () => null,
});

const photoEl = (over: Record<string, unknown> = {}): ElementSnapshot => ({
  type: "photo",
  x: 300,
  y: 400,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
  attemptId: "att1",
  w: 200,
  h: 150,
  srcW: 1600,
  srcH: 1200,
  crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.5 },
  zoom: 1,
  flipX: false,
  filter: null,
  radius: 12,
  ownerName: "Nadia",
  ...over,
});

describe("drawElement: satu jalur render editor & export", () => {
  it("urutan transform: translate(x,y) → rotate → scale → opacity → tubuh; kembali ke state sebelumnya (save/restore seimbang)", () => {
    const { ctx, log } = recorder();
    drawElement(ctx, photoEl({ rotation: 90, scaleX: 2, scaleY: 3, opacity: 0.5 }), res({ att1: img(1600, 1200) }), null);
    const n = names(log);
    expect(n.slice(0, 5)).toEqual(["save", "translate", "rotate", "scale", "set:globalAlpha"]);
    expect(log[1]).toEqual(["translate", 300, 400]);
    expect(log[2]![1]).toBeCloseTo(Math.PI / 2);
    expect(log[3]).toEqual(["scale", 2, 3]);
    expect(log[4]).toEqual(["set:globalAlpha", 0.5]);
    expect(n.filter((x) => x === "save").length).toBe(n.filter((x) => x === "restore").length);
  });

  it("foto: clip rounded-rect SEBELUM drawImage; sumber = crop × piksel asli, tujuan = kotak slot (tanpa distorsi); flip & filter (per foto menimpa global)", () => {
    const { ctx, log } = recorder();
    drawElement(ctx, photoEl(), res({ att1: img(1600, 1200) }), "MONO");
    const draw = log.find((c) => c[0] === "drawImage")!;
    expect(draw.slice(2)).toEqual([160, 240, 800, 600, -100, -75, 200, 150]); // sx, sy, sw, sh, dx, dy, dw, dh
    expect(names(log).indexOf("clip")).toBeLessThan(names(log).indexOf("drawImage"));
    expect(log.find((c) => c[0] === "set:filter")![1]).toContain("grayscale"); // global MONO
    // rasio sumbu identik (tanpa distorsi): sw/dw == sh/dh
    expect(800 / 200).toBeCloseTo(600 / 150, 5);
    const second = recorder();
    drawElement(second.ctx, photoEl({ filter: "HANGAT", flipX: true }), res({ att1: img(1600, 1200) }), "MONO");
    expect(second.log.find((c) => c[0] === "set:filter")![1]).toContain("sepia");
    const names2 = names(second.log);
    expect(names2.lastIndexOf("scale")).toBeGreaterThan(names2.indexOf("clip"));
    expect(second.log.filter((c) => c[0] === "scale").at(-1)).toEqual(["scale", -1, 1]);
  });

  it("foto belum termuat → placeholder gelap, BUKAN foto palsu (tidak ada drawImage)", () => {
    const { ctx, log } = recorder();
    drawElement(ctx, photoEl(), res(), null);
    expect(names(log)).not.toContain("drawImage");
    expect(names(log)).toContain("fillRect");
  });

  it("stiker: skala dari viewBox 100 ke ukuran elemen; tint hanya untuk stiker tintable; stroke memakai strokeWidth aset", () => {
    const heart = recorder();
    drawElement(heart.ctx, { type: "sticker", x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, assetId: "heart", w: 200, h: 200, tint: "#112233" }, res(), null);
    expect(heart.log).toContainEqual(["translate", -100, -100]);
    expect(heart.log).toContainEqual(["scale", 2, 2]);
    expect(heart.log).toContainEqual(["set:fillStyle", "#112233"]);
    const smile = recorder();
    drawElement(smile.ctx, { type: "sticker", x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, assetId: "smile", w: 100, h: 100, tint: "#112233" }, res(), null);
    expect(smile.log).not.toContainEqual(["set:fillStyle", "#112233"]); // tidak tintable
    expect(smile.log).toContainEqual(["set:lineWidth", 6]);
  });

  it("teks: font per gaya, bungkus kata mengikuti lebar, rata tengah; doodle: kurva halus + cap bulat", () => {
    const t = recorder();
    drawElement(t.ctx, { type: "text", x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, content: "halo dunia yang indah", fontStyle: "serif", color: "#1B1720", fontSize: 20, align: "center", w: 120 }, res(), null);
    expect(t.log.find((c) => c[0] === "set:font")![1]).toMatch(/^italic 20px /);
    const lines = t.log.filter((c) => c[0] === "fillText");
    expect(lines.length).toBeGreaterThan(1); // dibungkus
    expect(lines.map((l) => l[1]).join(" ")).toBe("halo dunia yang indah");
    expect(new Set(lines.map((l) => l[3])).size).toBe(lines.length); // y berbeda per baris
    const d = recorder();
    drawElement(d.ctx, { type: "doodle", x: 5, y: 5, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, points: "0,0;100,50;100,-50;100,50", color: "#F2778F", width: 8 }, res(), null);
    expect(names(d.log)).toContain("quadraticCurveTo");
    expect(d.log).toContainEqual(["set:lineCap", "round"]);
    expect(d.log).toContainEqual(["set:lineWidth", 8]);
  });
});

describe("drawDocument: komposisi final (urutan layer, skala seragam, tile)", () => {
  function model() {
    const studio = initStudio("PHOTO_STRIP", [PARTICIPANT_SLOTS[0]!, PARTICIPANT_SLOTS[1]!]);
    const scene = buildScene(studio, null, { names: [], dateText: "2026.10.29" });
    const doc = createEditorDoc();
    const c = { participantId: "p", name: "p", origin: {} };
    const s1 = addSticker(doc, c, "heart", { x: 100, y: 100 });
    const t1 = addText(doc, c, { x: 200, y: 200 }, "hai");
    const hid = addSticker(doc, c, "star", { x: 300, y: 300 });
    updateElement(doc, c, hid, { hidden: true }, "sembunyikan");
    // dua foto sintetis (z lebih rendah dari stiker/teks agar urutan tampak)
    const els = listElements(doc) as unknown as (ElementSnapshot & { id: string; z: string })[];
    const photos = ["a", "b"].map((k, i) => ({ ...photoEl({ attemptId: `att-${k}`, x: 200 + i * 50 }), id: `photo:att-${k}`, z: `A${i}` })) as (ElementSnapshot & { id: string; z: string })[];
    return { m: { meta: { canvas: { w: scene.width, h: scene.height }, globalFilter: null, frameStyle: { bgColor: "#FFFFFF", overlayOpacity: 1 } }, elements: [...photos, ...els], scene } as DocumentModel, s1, t1 };
  }

  it("urutan: latar → foto → dekor frame → stiker/teks; elemen tersembunyi tidak digambar; skala uniform di awal", () => {
    const { m } = model();
    const { ctx, log } = recorder();
    drawDocument(ctx, m, res({ "att-a": img(1600, 1200), "att-b": img(1600, 1200) }), 2);
    expect(log.find((c) => c[0] === "scale")).toEqual(["scale", 2, 2]);
    const imgs = names(log).filter((n) => n === "drawImage").length;
    expect(imgs).toBe(2);
    const firstFill = names(log).indexOf("fillRect");
    const firstPhoto = names(log).indexOf("drawImage");
    const firstText = log.findIndex((c, i) => c[0] === "fillText" && i > firstPhoto);
    expect(firstFill).toBeLessThan(firstPhoto);
    expect(firstText).toBeGreaterThan(firstPhoto);
    // stiker "star" tersembunyi: hanya 1 stiker (heart) → warna fill heart muncul, kuning star tidak
    expect(log).toContainEqual(["set:fillStyle", "#F2778F"]);
    expect(log).not.toContainEqual(["set:fillStyle", "#F2C94C"]);
  });

  it("tile: clip ke ukuran tile lalu translate(-x,-y) SEBELUM skala; semua tile menutup output tanpa tumpang tindih", () => {
    const { m } = model();
    const { ctx, log } = recorder();
    drawDocument(ctx, m, res(), 4, { x: 4096, y: 8192, w: 1000, h: 500 });
    const n = names(log);
    expect(n.indexOf("clip")).toBeLessThan(n.indexOf("scale"));
    expect(log).toContainEqual(["rect", 0, 0, 1000, 500]);
    expect(log).toContainEqual(["translate", -4096, -8192]);
  });
});

describe("rencana export (12 §4, DEC-042)", () => {
  it("preset: Asli 1×, Cetak 2× (300 dpi), Story 1080×1920 contain di tengah (tanpa distorsi)", () => {
    expect(computeExportSize({ w: 600, h: 1800 }, "ASLI")).toMatchObject({ width: 600, height: 1800, scale: 1, dpi: null });
    expect(computeExportSize({ w: 600, h: 1800 }, "CETAK_300")).toMatchObject({ width: 1200, height: 3600, scale: 2, dpi: 300, reduced: false });
    const story = computeExportSize({ w: 600, h: 1800 }, "STORY");
    expect(story).toMatchObject({ width: 1080, height: 1920 });
    expect(story.scale).toBeCloseTo(1920 / 1800, 6);
    expect(story.offsetX).toBeCloseTo((1080 - 600 * story.scale) / 2, 6);
    expect(story.offsetY).toBeCloseTo(0, 6);
    const wide = computeExportSize({ w: 1800, h: 600 }, "STORY");
    expect(wide.scale).toBeCloseTo(1080 / 1800, 6);
    expect(wide.offsetY).toBeGreaterThan(0);
  });

  it("sisi terpanjang tak pernah > 8192; Cetak diturunkan dengan pemberitahuan; plan 32 cell (TC-EXP-012) tetap bisa diexport", () => {
    const tall = computeExportSize({ w: 1200, h: 5000 }, "CETAK_300");
    expect(tall).toMatchObject({ scale: 1, reduced: true });
    expect(Math.max(tall.width, tall.height)).toBeLessThanOrEqual(8192);
    const plan = generatePlan({ mode: "PHOTO_STRIP", strategy: "PER_PARTICIPANT_SHOT", shotCount: 8, participantSlots: [...PARTICIPANT_SLOTS], arrangement: "STRIP_VERTICAL", slotRatio: "4:3", output: { preset: "AUTO" }, gap: 16, cornerRadius: 6 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.layout.slots).toHaveLength(32);
    for (const preset of ["ASLI", "CETAK_300", "STORY"] as const) {
      const sz = computeExportSize({ w: plan.layout.canvas.widthPx, h: plan.layout.canvas.heightPx }, preset);
      expect(Math.max(sz.width, sz.height)).toBeLessThanOrEqual(8192);
      expect(sz.width).toBeGreaterThan(0);
    }
    const huge = computeExportSize({ w: 9000, h: 9000 }, "ASLI");
    expect(Math.max(huge.width, huge.height)).toBeLessThanOrEqual(8192);
    expect(huge.width / huge.height).toBeCloseTo(1, 2);
  });

  it("tiling: > 16 juta piksel atau sisi > 4096 → dipecah; tiap tile ≤ batas; menutup seluruh output tepat satu kali", () => {
    expect(needsTiling(1200, 3600)).toBe(false);
    expect(tilePlan(1200, 3600)).toEqual([{ x: 0, y: 0, w: 1200, h: 3600 }]);
    for (const [w, h] of [[2400, 7200], [8192, 8192], [5000, 3000], [1600, 8192]] as const) {
      const tiles = tilePlan(w, h);
      expect(tiles.length).toBeGreaterThan(1);
      let area = 0;
      const grid = new Set<string>();
      for (const t of tiles) {
        expect(t.w * t.h).toBeLessThanOrEqual(EXPORT_LIMITS.maxTilePx);
        expect(Math.max(t.w, t.h)).toBeLessThanOrEqual(EXPORT_LIMITS.maxTileSide);
        area += t.w * t.h;
        grid.add(`${t.x},${t.y}`);
      }
      expect(area).toBe(w * h);
      expect(grid.size).toBe(tiles.length);
    }
  });

  it("peringatan kualitas (NFR-12): cell < 240 px & upscale > 1.25× dari piksel sumber; bukan penolakan", () => {
    const small = { ...photoEl({ w: 100, h: 75 }), id: "a" };
    const sharp = { ...photoEl({ w: 800, h: 600, crop: { x: 0, y: 0, w: 1, h: 1 }, srcW: 1600 }), id: "b" };
    const blurry = { ...photoEl({ w: 800, h: 600, crop: { x: 0, y: 0, w: 0.25, h: 0.25 }, srcW: 1600 }), id: "c" };
    const w = qualityWarnings([small, sharp, blurry] as never, 1);
    expect(w.map((x) => `${x.code}:${x.elementId}`).sort()).toEqual(["SMALL_CELL:a", "UPSCALE:c"]);
    expect(qualityWarnings([small] as never, 4)).toEqual([]); // diperbesar 4× → cell 400 px (tapi upscale?)
  });

  it("nama file LONGROLL_{CODE}_sesi{n}_{YYYY-MM-DD}.{ext}", () => {
    expect(exportFileName("BOBA27", 2, "png", new Date(2026, 9, 29))).toBe("LONGROLL_BOBA27_sesi2_2026-10-29.png");
    expect(exportFileName("BO/BA 27!", 1, "jpeg", new Date(2026, 0, 5))).toBe("LONGROLL_BOBA27_sesi1_2026-01-05.jpg");
  });
});

describe("PNG: pHYs 300 dpi, tanpa metadata lain", () => {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 2);
  new DataView(ihdr.buffer).setUint32(4, 2);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const png = (...chunks: Uint8Array[]) => {
    const total = sig.length + chunks.reduce((a, c) => a + c.length, 0);
    const out = new Uint8Array(total);
    out.set(sig, 0);
    let o = 8;
    for (const c of chunks) (out.set(c, o), (o += c.length));
    return out;
  };
  const walk = (b: Uint8Array) => {
    const out: { type: string; data: Uint8Array; crcOk: boolean }[] = [];
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    for (let off = 8; off < b.length; ) {
      const len = dv.getUint32(off);
      const type = String.fromCharCode(...b.subarray(off + 4, off + 8));
      const data = b.subarray(off + 8, off + 8 + len);
      const crc = dv.getUint32(off + 8 + len);
      out.push({ type, data, crcOk: ((crc32(b.subarray(off + 4, off + 8 + len)) ^ 0xffffffff) >>> 0) === crc });
      off += 12 + len;
    }
    return out;
  };

  it("sisipkan pHYs tepat setelah IHDR (11811 px/m ≈ 300 dpi), CRC valid, tidak menggandakan, urutan chunk lain terjaga", () => {
    const base = png(pngChunk("IHDR", ihdr), pngChunk("pHYs", physChunk(72).subarray(8, 17)), pngChunk("IDAT", new Uint8Array([1, 2, 3])), pngChunk("IEND", new Uint8Array()));
    const out = addPngDpi(base, 300);
    const chunks = walk(out);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
    expect(chunks.every((c) => c.crcOk)).toBe(true);
    const ppm = new DataView(chunks[1]!.data.buffer, chunks[1]!.data.byteOffset).getUint32(0);
    expect(ppm).toBe(11811);
    expect(walk(addPngDpi(out, 300)).filter((c) => c.type === "pHYs")).toHaveLength(1);
    expect(() => addPngDpi(new Uint8Array(40), 300)).toThrow();
    void Y;
  });
});
