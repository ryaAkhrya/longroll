import { afterEach, describe, expect, it, vi } from "vitest";
import type { CameraPresentation } from "@longroll/shared";

const support = { v: true };
vi.mock("@/render/adjustImage", () => ({ supportsCtxFilter: () => support.v }));

import { drawFrame } from "../captureFrame";

const WARM: CameraPresentation = { zoom: 1, offset: { x: 0, y: 0 }, brightness: 0, warmth: 1 };
const NEUTRAL: CameraPresentation = { zoom: 1, offset: { x: 0, y: 0 }, brightness: 0, warmth: 0 };

/** Kanvas tiruan: jsdom tidak punya canvas 2d. Menyimpan piksel RGBA 4×4 dan mencatat filter yang dipasang. */
function fakeCanvas() {
  const px = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) px.set([120, 140, 160, 255], i * 4);
  const ctx = {
    filter: "none",
    setFilterCalls: 0,
    translate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({ data: px, width: 4, height: 4 })),
    putImageData: vi.fn(),
  };
  let f = "none";
  Object.defineProperty(ctx, "filter", { get: () => f, set: (v: string) => { f = v; ctx.setFilterCalls++; } });
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, ctx, px };
}

function run(cp: CameraPresentation) {
  const f = fakeCanvas();
  const create = vi.spyOn(document, "createElement").mockImplementation(() => f.canvas);
  const video = { videoWidth: 4, videoHeight: 4 } as HTMLVideoElement;
  drawFrame(video, cp, false, 4);
  create.mockRestore();
  return f;
}

afterEach(() => {
  support.v = true;
});

describe("drawFrame: filter presentasi kamera (DEC-064, WYSIWYG)", () => {
  it("ctx.filter tersedia: dipakai langsung, tanpa baca/tulis piksel", () => {
    support.v = true;
    const { ctx } = run(WARM);
    expect(ctx.filter).toBe("sepia(0.3) saturate(1.15)");
    expect(ctx.getImageData).not.toHaveBeenCalled();
  });

  it("ctx.filter tidak berfungsi (Safari): filter yang sama diterapkan lewat fallback piksel bersama", () => {
    support.v = false;
    const { ctx, px } = run(WARM);
    expect(ctx.setFilterCalls).toBe(0);
    expect(ctx.getImageData).toHaveBeenCalledTimes(1);
    expect(ctx.putImageData).toHaveBeenCalledTimes(1);
    // Hangat: merah naik relatif terhadap biru dibanding piksel asli (120,140,160).
    expect(px[0]! - px[2]!).toBeGreaterThan(120 - 160);
    expect([px[0], px[1], px[2]]).not.toEqual([120, 140, 160]);
    expect(px[3]).toBe(255);
  });

  it("tanpa filter presentasi: tidak ada pekerjaan tambahan di kedua jalur", () => {
    for (const v of [true, false]) {
      support.v = v;
      const { ctx } = run(NEUTRAL);
      expect(ctx.setFilterCalls).toBe(0);
      expect(ctx.getImageData).not.toHaveBeenCalled();
    }
  });
});
