import { describe, expect, it } from "vitest";
import {
  ARRANGEMENT_LABEL,
  BUILTIN_FRAMES,
  FRAME_CATEGORY_LABEL,
  FRAME_CATEGORY_ORDER,
  MODES,
  NEUTRAL_ADJUST,
  PARTICIPANT_SLOTS,
  STICKER_CATALOG,
  STUDIO_MODE_DEFAULTS,
  buildScene,
  drawDocument,
  drawPhotoBody,
  effectiveAdjust,
  framesForMode,
  generatePlan,
  initStudio,
  masonryCols,
} from "../index";
import type { AdjustedPhotoRequest, Arrangement, Ctx2D, DocumentModel, DrawResources, ElementSnapshot, ImageLike, Mode, ParticipantSlot, StudioState } from "../index";

const SLOTS = PARTICIPANT_SLOTS as readonly ParticipantSlot[];
const HEX = /^#[0-9a-fA-F]{6}$/;
const ctxScene = { names: ["Nadia", "Raka", "Sasa", "Bimo"], dateText: "2026.10.30" };

const studioWith = (mode: Mode, n: number, arrangement?: Exclude<Arrangement, "CUSTOM">, strategy?: StudioState["bindingStrategy"], shots?: number): StudioState | null => {
  const d = STUDIO_MODE_DEFAULTS[mode];
  const slots = SLOTS.slice(0, n) as ParticipantSlot[];
  const base = initStudio(mode, slots);
  const plan = generatePlan({ mode, strategy: strategy ?? d.bindingStrategy, shotCount: shots ?? d.shotCount, participantSlots: slots, arrangement: arrangement ?? (d.arrangement as Exclude<Arrangement, "CUSTOM">), slotRatio: d.slotRatio, output: { preset: "AUTO" }, gap: base.style.gap, cornerRadius: base.style.cornerRadius });
  return plan.ok ? { ...base, layout: plan.layout, bindingStrategy: strategy ?? d.bindingStrategy } : null;
};

describe("katalog frame (Phase 3)", () => {
  it("≥ 20 frame bawaan, id unik & stabil, nama unik, semua kategori berlabel & berurutan", () => {
    expect(BUILTIN_FRAMES.length).toBeGreaterThanOrEqual(20);
    expect(BUILTIN_FRAMES.length).toBeLessThanOrEqual(30);
    expect(new Set(BUILTIN_FRAMES.map((f) => f.id)).size).toBe(BUILTIN_FRAMES.length);
    expect(new Set(BUILTIN_FRAMES.map((f) => f.name)).size).toBe(BUILTIN_FRAMES.length);
    for (const f of BUILTIN_FRAMES) {
      expect(f.id).toMatch(/^builtin\/[a-z0-9-]+@1$/);
      expect(FRAME_CATEGORY_LABEL[f.category], f.id).toBeTruthy();
      expect(FRAME_CATEGORY_ORDER).toContain(f.category);
      expect(f.name.length).toBeLessThanOrEqual(18);
    }
    expect([...FRAME_CATEGORY_ORDER].sort()).toEqual(Object.keys(FRAME_CATEGORY_LABEL).sort());
  });

  it("lisensi: semua orisinal repo, tanpa atribusi pihak ketiga & tanpa URL eksternal (tidak ada hotlink)", () => {
    const text = JSON.stringify(BUILTIN_FRAMES);
    expect(text).not.toMatch(/https?:\/\//);
    for (const f of BUILTIN_FRAMES) expect(f.license.source).toMatch(/LONGROLL original/);
    for (const s of STICKER_CATALOG) {
      expect(s.license.source, s.id).toMatch(/LONGROLL original/);
      expect(JSON.stringify(s)).not.toMatch(/https?:\/\//);
    }
  });

  it("warna valid & palet kontras (teks/dekor terbaca di atas latar frame)", () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };
    const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    for (const f of BUILTIN_FRAMES) {
      expect(f.palette.bg, f.id).toMatch(HEX);
      expect(f.palette.ink, f.id).toMatch(HEX);
      // palet ink/bg dipakai sebagai petunjuk visual & teks utama: minimal 3:1 (teks besar WCAG).
      expect(ratio(f.palette.bg, f.palette.ink), `${f.id} ${f.palette.bg}/${f.palette.ink}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("tiap mode punya ≥ 12 frame yang cocok; frame tema film hanya untuk susunan baris-kolom; tidak ada frame tanpa mode", () => {
    for (const m of MODES) expect(framesForMode(m).length, m).toBeGreaterThanOrEqual(12);
    for (const f of BUILTIN_FRAMES) expect(f.modes.length, f.id).toBeGreaterThan(0);
    for (const id of ["film-400", "super-8", "contact-sheet"]) {
      const f = BUILTIN_FRAMES.find((x) => x.id === `builtin/${id}@1`)!;
      expect(f.modes).not.toContain("FREEFORM_COLLAGE");
      expect(f.modes).not.toContain("GROUP_SHOT");
    }
    // frame bawaan tiap mode (default) harus termasuk daftar modenya
    for (const m of MODES) expect(framesForMode(m).map((f) => f.id)).toContain(STUDIO_MODE_DEFAULTS[m].frameId);
  });

  it("identitas visual berbeda: tidak ada dua frame dengan latar + gaya slot + dekor identik", () => {
    const sig = (f: (typeof BUILTIN_FRAMES)[number]) => JSON.stringify([f.layers.background, f.layers.decor, f.slotStyle]);
    expect(new Set(BUILTIN_FRAMES.map(sig)).size).toBe(BUILTIN_FRAMES.length);
  });
});

describe("geometri scene: semua frame × semua mode × susunan", () => {
  for (const mode of MODES) {
    it(`${mode}: dekor tetap di dalam kanvas dan tidak menimpa foto; slot di dalam kanvas`, () => {
      const d = STUDIO_MODE_DEFAULTS[mode];
      let scenes = 0;
      for (const arrangement of d.arrangements as Exclude<Arrangement, "CUSTOM">[]) {
        for (const n of [1, 2, 4]) {
          const studio = studioWith(mode, n, arrangement);
          if (!studio) continue;
          for (const f of framesForMode(mode)) {
            const scene = buildScene({ ...studio, frame: { frameId: f.id, source: "BUILTIN", adapt: "CONTAIN", overlayOpacity: 1 } }, f, ctxScene);
            scenes++;
            const W = scene.width;
            const H = scene.height;
            for (const s of scene.slots) {
              // 82% sel kolase / foto miring boleh sedikit melewati tepi? Tidak: harus ≥ 99% di dalam kanvas.
              const inside = Math.min(s.x + s.w, W) - Math.max(s.x, 0);
              expect(inside / s.w, `${mode}/${arrangement}/${f.id} slot ${s.id}`).toBeGreaterThan(0.99);
            }
            const photoBoxes = scene.slots.filter((s) => s.rotation === 0).map((s) => ({ x: s.x + s.photo.x, y: s.y + s.photo.y, w: s.photo.w, h: s.photo.h }));
            for (const dec of scene.decor) {
              if (dec.kind === "shape") {
                expect(dec.x - dec.size / 2, `${f.id} shape x`).toBeGreaterThanOrEqual(-1);
                expect(dec.x + dec.size / 2, `${f.id} shape x2`).toBeLessThanOrEqual(W + 1);
                expect(dec.y - dec.size / 2, `${f.id} shape y`).toBeGreaterThanOrEqual(-1);
                expect(dec.y + dec.size / 2, `${f.id} shape y2`).toBeLessThanOrEqual(H + 1);
                for (const b of photoBoxes) {
                  const ox = Math.min(dec.x + dec.size / 2, b.x + b.w) - Math.max(dec.x - dec.size / 2, b.x);
                  const oy = Math.min(dec.y + dec.size / 2, b.y + b.h) - Math.max(dec.y - dec.size / 2, b.y);
                  expect(ox > 1 && oy > 1, `${mode}/${arrangement}/${f.id}: bentuk dekor menimpa foto`).toBe(false);
                }
              } else if (dec.kind === "rect" && dec.rotation === 0 && dec.w > 0) {
                expect(dec.x, `${f.id} rect x`).toBeGreaterThanOrEqual(-1);
                expect(dec.x + dec.w, `${f.id} rect x2`).toBeLessThanOrEqual(W + 1);
              } else if (dec.kind === "text") {
                expect(dec.x, `${f.id} text x`).toBeGreaterThanOrEqual(0);
                expect(dec.x, `${f.id} text x2`).toBeLessThanOrEqual(W);
                expect(dec.y, `${f.id} text y`).toBeGreaterThan(0);
                expect(dec.y, `${f.id} text y2`).toBeLessThan(H);
              }
            }
          }
        }
      }
      expect(scenes).toBeGreaterThan(40);
    });
  }
});

describe("susunan baru (Strip zig-zag, Majalah, Satu menonjol, Kolase tertata)", () => {
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, tol = 0.5) =>
    Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > tol && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > tol;

  it("setiap susunan baru berlabel dan terdaftar pada mode yang benar", () => {
    expect(STUDIO_MODE_DEFAULTS.PHOTO_STRIP.arrangements).toContain("STRIP_ZIGZAG");
    expect(STUDIO_MODE_DEFAULTS.PHOTO_GRID.arrangements).toContain("MAGAZINE");
    expect(STUDIO_MODE_DEFAULTS.GROUP_SHOT.arrangements).toEqual(expect.arrayContaining(["FEATURE", "GRID"]));
    expect(STUDIO_MODE_DEFAULTS.FREEFORM_COLLAGE.arrangements).toContain("MASONRY");
    for (const a of ["STRIP_ZIGZAG", "MAGAZINE", "FEATURE", "MASONRY"] as const) expect(ARRANGEMENT_LABEL[a]).toBeTruthy();
  });

  it("Majalah: foto utama terbesar & berada di kiri-atas; pendukung tanpa tumpang tindih; semua di dalam kanvas", () => {
    for (const n of [1, 2, 3, 4]) {
      for (const shots of [1, 2, 3]) {
        const s = studioWith("PHOTO_GRID", n, "MAGAZINE", "PER_PARTICIPANT_SHOT", shots);
        if (!s) continue;
        const L = s.layout;
        expect(L.slots.length).toBe(n * shots);
        const area = (q: { w: number; h: number }) => q.w * q.h;
        if (L.slots.length > 1) {
          const [hero, ...rest] = L.slots;
          expect(area(hero!), `n=${n} shots=${shots}`).toBeGreaterThan(Math.max(...rest.map(area)) * 1.2);
          for (const r of rest) expect(hero!.x <= r.x + 1 && hero!.y <= r.y + 1).toBe(true);
        }
        for (let i = 0; i < L.slots.length; i++) {
          const a = L.slots[i]!;
          expect(a.x).toBeGreaterThanOrEqual(-0.5);
          expect(a.x + a.w).toBeLessThanOrEqual(L.canvas.widthPx + 0.5);
          expect(a.y + a.h).toBeLessThanOrEqual(L.canvas.heightPx + 0.5);
          for (let j = i + 1; j < L.slots.length; j++) expect(overlap(a, L.slots[j]!), `n=${n} s=${shots} ${i}x${j}`).toBe(false);
        }
      }
    }
  });

  it("Kolase tertata: tanpa tumpang tindih (tilt kecil), kolom 2 untuk ≤ 6 foto dan 3 di atasnya, deterministik", () => {
    expect(masonryCols(6)).toBe(2);
    expect(masonryCols(7)).toBe(3);
    for (const [n, shots] of [[2, 2], [3, 2], [4, 2], [4, 4]] as const) {
      const a = studioWith("FREEFORM_COLLAGE", n, "MASONRY", "FREEFORM", shots);
      const b = studioWith("FREEFORM_COLLAGE", n, "MASONRY", "FREEFORM", shots);
      if (!a || !b) continue;
      expect(JSON.stringify(a.layout)).toBe(JSON.stringify(b.layout));
      const L = a.layout;
      expect(L.slots).toHaveLength(n * shots);
      for (let i = 0; i < L.slots.length; i++) {
        const s = L.slots[i]!;
        expect(Math.abs(s.rotation)).toBeLessThanOrEqual(1.5);
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x + s.w).toBeLessThanOrEqual(L.canvas.widthPx + 0.5);
        expect(s.y + s.h).toBeLessThanOrEqual(L.canvas.heightPx + 0.5);
        for (let j = i + 1; j < L.slots.length; j++) expect(overlap(s, L.slots[j]!, 2), `n=${n} s=${shots} ${i}x${j}`).toBe(false);
      }
    }
  });

  it("Strip zig-zag: berselang-seling kiri/kanan, tetap di dalam kanvas, tidak bertumpuk", () => {
    const s = studioWith("PHOTO_STRIP", 3, "STRIP_ZIGZAG")!;
    const L = s.layout;
    const xs = L.slots.map((q) => q.x + q.w / 2);
    expect(xs[0]).not.toBeCloseTo(xs[1]!, 0);
    expect(xs[0]).toBeCloseTo(xs[2]!, 0);
    for (const q of L.slots) {
      expect(q.x).toBeGreaterThan(0);
      expect(q.x + q.w).toBeLessThan(L.canvas.widthPx);
    }
    for (let i = 0; i < L.slots.length - 1; i++) expect(overlap(L.slots[i]!, L.slots[i + 1]!, 1)).toBe(false);
  });

  it("Satu menonjol (grup): peserta pertama lebih besar dari tile lain dan semua tile di dalam slot", () => {
    const s = studioWith("GROUP_SHOT", 4, "FEATURE")!;
    const sc = buildScene({ ...s, frame: null }, null, ctxScene);
    const tiles = sc.slots[0]!.tiles;
    expect(tiles).toHaveLength(4);
    expect(tiles[0]!.w * tiles[0]!.h).toBeGreaterThan(Math.max(...tiles.slice(1).map((t) => t.w * t.h)) * 1.5);
    for (const t of tiles) expect(t.x + t.w).toBeLessThanOrEqual(sc.slots[0]!.photo.w + 0.01);
  });
});

describe("jalur render adjustment: pratinjau = export", () => {
  const photo = (over: Record<string, unknown> = {}): ElementSnapshot => ({ type: "photo", x: 100, y: 100, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, attemptId: "att1", w: 200, h: 150, srcW: 1600, srcH: 1200, crop: { x: 0, y: 0, w: 1, h: 1 }, zoom: 1, flipX: false, filter: null, radius: 0, hidden: false, ...over });
  const mkRes = (calls: AdjustedPhotoRequest[], returns: ImageLike | null = { naturalWidth: 10, naturalHeight: 10 }, pixelScale?: number): DrawResources => ({
    pixelScale,
    photo: () => ({ naturalWidth: 1600, naturalHeight: 1200 }),
    overlay: null,
    path: (d) => d,
    pattern: () => null,
    adjusted: (r) => (calls.push(r), returns),
  });
  const fakeCtx = (): Ctx2D => new Proxy({} as Record<string, unknown>, { get: (_t, p: string) => (p === "measureText" ? () => ({ width: 1 }) : p === "createLinearGradient" ? () => ({ addColorStop() {} }) : () => undefined), set: () => true }) as unknown as Ctx2D;

  it("tanpa adjustment: processor tidak dipanggil; netral eksplisit juga tidak", () => {
    const calls: AdjustedPhotoRequest[] = [];
    drawPhotoBody(fakeCtx(), photo(), mkRes(calls), null, null);
    drawPhotoBody(fakeCtx(), photo(), mkRes(calls), null, { ...NEUTRAL_ADJUST });
    drawPhotoBody(fakeCtx(), photo({ adjust: { ...NEUTRAL_ADJUST } }), mkRes(calls), null, null);
    expect(calls).toHaveLength(0);
  });

  it("ukuran piksel mengikuti skala render × skala elemen (export 2× = piksel 2× lipat; editor mengikuti zoom layar)", () => {
    const calls: AdjustedPhotoRequest[] = [];
    const doc = (scaleX: number): DocumentModel => ({ meta: { canvas: { w: 600, h: 800 }, globalFilter: null, frameStyle: { bgColor: "#fff", overlayOpacity: 1 }, globalAdjust: { exposure: 20 } }, elements: [{ ...photo({ scaleX, scaleY: scaleX }), id: "photo:att1", z: "a0" } as never], scene: null });
    drawDocument(fakeCtx(), doc(1), mkRes(calls), 1);
    drawDocument(fakeCtx(), doc(1), mkRes(calls), 2);
    drawDocument(fakeCtx(), doc(1.5), mkRes(calls), 2);
    expect(calls.map((c) => [c.pxW, c.pxH])).toEqual([[200, 150], [400, 300], [600, 450]]);
    expect(calls.every((c) => c.adjust.exposure === 20)).toBe(true);
  });

  it("per-foto menggantikan global; null ikut global; preset filter diteruskan agar diterapkan SEBELUM adjustment", () => {
    const calls: AdjustedPhotoRequest[] = [];
    drawPhotoBody(fakeCtx(), photo({ adjust: { saturation: -100 }, filter: "MONO" }), mkRes(calls), null, { exposure: 40 });
    drawPhotoBody(fakeCtx(), photo({ adjust: null }), mkRes(calls), "FILM", { exposure: 40 });
    expect(calls[0]!.adjust).toMatchObject({ saturation: -100, exposure: 0 });
    expect(calls[0]!.filterCss).toMatch(/grayscale/);
    expect(calls[1]!.adjust).toMatchObject({ exposure: 40 });
    expect(calls[1]!.filterCss).toMatch(/sepia/);
    expect(effectiveAdjust(photo({ adjust: { tint: 5 } }), { exposure: 9 })).toMatchObject({ tint: 5, exposure: 0 });
  });

  it("processor gagal/null → jatuh ke jalur tanpa adjustment (foto tetap tampil), tanpa melempar", () => {
    const calls: AdjustedPhotoRequest[] = [];
    const ops: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, { get: (_t, p: string) => (...a: unknown[]) => void ops.push(`${p}:${a.length}`), set: () => true }) as unknown as Ctx2D;
    expect(() => drawPhotoBody(ctx, photo(), mkRes(calls, null), null, { exposure: 40 })).not.toThrow();
    expect(calls).toHaveLength(1);
    expect(ops.some((o) => o.startsWith("drawImage:9"))).toBe(true); // jalur lama (9 argumen crop) dipakai
  });
});
