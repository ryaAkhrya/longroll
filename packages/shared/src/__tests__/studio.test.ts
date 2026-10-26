import { describe, expect, it } from "vitest";
import { MODES } from "../session";
import type { Mode } from "../session";
import {
  BUILTIN_FRAMES,
  FILTER_PRESETS,
  PARTICIPANT_SLOTS,
  STUDIO_LIMITS,
  STUDIO_MODE_DEFAULTS,
  applyStudioPatch,
  builtinFrame,
  computeFrameTransform,
  filterCss,
  generatePlan,
  groupTiles,
  initStudio,
  lockStudioStructure,
  planFromHoles,
  regenerateForParticipants,
  revertStudio,
  sanitizePatch,
  transformHoles,
  validateLayout,
} from "../studio";
import type { Arrangement, BindingStrategy, FrameTemplate, PlanInput, StudioContext } from "../studio";

const slotsOf = (n: number) => PARTICIPANT_SLOTS.slice(0, n);

function input(mode: Mode, strategy: BindingStrategy, shotCount: number, n: number, arrangement?: Exclude<Arrangement, "CUSTOM">): PlanInput {
  const d = STUDIO_MODE_DEFAULTS[mode];
  return {
    mode,
    strategy,
    shotCount,
    participantSlots: slotsOf(n),
    arrangement: arrangement ?? (d.arrangement as Exclude<Arrangement, "CUSTOM">),
    slotRatio: d.slotRatio,
    output: { preset: "AUTO" },
    gap: 16,
    cornerRadius: 6,
  };
}

describe("TC-FRAME-005: BindingPlan kedua strategi, semua mode & susunan, 1–8 shot × 1–4 peserta", () => {
  for (const mode of MODES) {
    const d = STUDIO_MODE_DEFAULTS[mode];
    for (const strategy of d.strategies) {
      for (const arrangement of d.arrangements as Exclude<Arrangement, "CUSTOM">[]) {
        it(`${mode} · ${strategy} · ${arrangement}`, () => {
          for (let n = 1; n <= 4; n++) {
            for (let s = 1; s <= d.maxShots; s++) {
              const r = generatePlan(input(mode, strategy, s, n, arrangement));
              if (!r.ok) {
                // Satu-satunya penolakan yang sah: batas sisi grid mosaik (dengan alternatif), bukan pemotongan.
                expect(r.violation.code).toBe("MAX_GRID_SIDE");
                expect(r.violation.alternatives.length).toBeGreaterThan(0);
                continue;
              }
              const L = r.layout;
              expect(validateLayout(L, strategy, slotsOf(n))).toBeNull();
              const expectSlots = strategy === "PER_SHOT_GROUP" ? s : s * n;
              expect(L.slots).toHaveLength(expectSlots);
              expect(L.shotCount).toBe(s);
              expect(Math.max(L.canvas.widthPx, L.canvas.heightPx)).toBeLessThanOrEqual(STUDIO_LIMITS.MAX_OUTPUT_PX);
              const kinds = new Set(L.slots.map((x) => x.binding.kind));
              expect([...kinds]).toEqual([strategy === "PER_SHOT_GROUP" ? "SHOT_GROUP" : strategy === "FREEFORM" ? "FREE" : "CELL"]);
            }
          }
        });
      }
    }
  }

  it("contoh 10 §5.3 (4 peserta): Strip 4 shot → A 4 slot ROW, B 16 slot; Group 1 shot → A 1 BLEND, B 4 slot", () => {
    const a = generatePlan(input("PHOTO_STRIP", "PER_SHOT_GROUP", 4, 4));
    const b = generatePlan(input("PHOTO_STRIP", "PER_PARTICIPANT_SHOT", 4, 4));
    expect(a.ok && a.layout.slots.length).toBe(4);
    expect(a.ok && a.layout.slots[0]!.binding).toEqual({ kind: "SHOT_GROUP", shotIndex: 0, arrangement: "ROW" });
    expect(b.ok && b.layout.slots.length).toBe(16);
    const g = generatePlan(input("GROUP_SHOT", "PER_SHOT_GROUP", 1, 4));
    expect(g.ok && g.layout.slots.map((s) => s.binding)).toEqual([{ kind: "SHOT_GROUP", shotIndex: 0, arrangement: "BLEND" }]);
    const gb = generatePlan(input("GROUP_SHOT", "PER_PARTICIPANT_SHOT", 1, 4));
    expect(gb.ok && gb.layout.slots.length).toBe(4);
  });

  it("plan > 16 cell otomatis memakai kanvas lebih panjang/lebar (AUTO)", () => {
    const small = generatePlan(input("PHOTO_STRIP", "PER_PARTICIPANT_SHOT", 4, 2));
    const big = generatePlan(input("PHOTO_STRIP", "PER_PARTICIPANT_SHOT", 8, 4));
    expect(small.ok && big.ok).toBe(true);
    if (small.ok && big.ok) expect(big.layout.canvas.heightPx * big.layout.canvas.widthPx).toBeGreaterThan(small.layout.canvas.heightPx * small.layout.canvas.widthPx);
  });

  it("generator deterministik (semua klien identik)", () => {
    expect(JSON.stringify(generatePlan(input("FREEFORM_COLLAGE", "FREEFORM", 8, 4)))).toBe(JSON.stringify(generatePlan(input("FREEFORM_COLLAGE", "FREEFORM", 8, 4))));
  });

  it("sub-tile komposit grup tidak melebihi slot", () => {
    for (const arr of ["ROW", "COLUMN", "GRID", "BLEND"] as const) {
      for (let n = 1; n <= 4; n++) {
        const tiles = groupTiles(400, 300, arr, n);
        expect(tiles).toHaveLength(n);
        for (const t of tiles) {
          expect(t.x).toBeGreaterThanOrEqual(-1e-9);
          expect(t.x + t.w).toBeLessThanOrEqual(400 + 1e-6);
          expect(t.y + t.h).toBeLessThanOrEqual(300 + 1e-6);
        }
      }
    }
  });
});

describe("TC-FRAME-006: safeguard menampilkan alasan + alternatif, tanpa pemotongan diam-diam", () => {
  it("9 shot ditolak (bukan dipotong ke 8) dengan alternatif 8 shot", () => {
    const r = generatePlan(input("PHOTO_STRIP", "PER_SHOT_GROUP", 9, 4));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violation).toMatchObject({ code: "MAX_SHOTS", limit: 8, actual: 9 });
      expect(r.violation.alternatives[0]!.patch).toEqual({ shotCount: 8 });
    }
  });
  it("Group Shot maksimal 4 shot", () => {
    const r = generatePlan(input("GROUP_SHOT", "PER_SHOT_GROUP", 5, 2));
    expect(!r.ok && r.violation.code).toBe("MAX_SHOTS");
  });
  it("8 shot × 4 orang strategi per orang di strip → peringatan + alternatif (tetap 32 foto)", () => {
    const r = generatePlan(input("PHOTO_STRIP", "PER_PARTICIPANT_SHOT", 8, 4));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.layout.slots).toHaveLength(32);
      expect(r.warnings[0]!.message).toContain("32 foto");
      expect(r.warnings[0]!.alternatives.length).toBeGreaterThan(0);
    }
  });
  it("output custom > 8192 px ditolak dengan alternatif", () => {
    const r = generatePlan({ ...input("PHOTO_GRID", "PER_SHOT_GROUP", 1, 2), output: { preset: "CUSTOM", widthPx: 9000, heightPx: 1000 } });
    expect(!r.ok && r.violation.code).toBe("MAX_OUTPUT_PX");
  });
  it("strategi/susunan yang tidak cocok dengan mode ditolak", () => {
    expect(generatePlan(input("PHOTO_STRIP", "FREEFORM", 4, 2)).ok).toBe(false);
    expect(generatePlan(input("FREEFORM_COLLAGE", "PER_SHOT_GROUP", 4, 2)).ok).toBe(false);
    expect(generatePlan(input("PHOTO_STRIP", "PER_SHOT_GROUP", 4, 2, "GRID")).ok).toBe(false);
  });
});

describe("validator layout (14 §6.1, 10 §7)", () => {
  const base = () => {
    const r = generatePlan(input("PHOTO_STRIP", "PER_PARTICIPANT_SHOT", 2, 2));
    if (!r.ok) throw new Error();
    return r.layout;
  };
  it("menolak NaN, slot < 60 px, slot ≥ 50% di luar kanvas, binding salah strategi, shotIndex di luar", () => {
    const L1 = base();
    L1.slots[0]!.x = Number.NaN;
    expect(validateLayout(L1, "PER_PARTICIPANT_SHOT", slotsOf(2))?.detail).toBe("nan");
    const L2 = base();
    L2.slots[0]!.w = 40;
    expect(validateLayout(L2, "PER_PARTICIPANT_SHOT", slotsOf(2))?.detail).toBe("min-size");
    const L3 = base();
    L3.slots[0]!.x = L3.canvas.widthPx - L3.slots[0]!.w * 0.3;
    expect(validateLayout(L3, "PER_PARTICIPANT_SHOT", slotsOf(2))?.detail).toBe("outside");
    expect(validateLayout(base(), "PER_SHOT_GROUP", slotsOf(2))?.reason).toBe("BINDING");
    const L4 = base();
    (L4.slots[0]!.binding as { shotIndex: number }).shotIndex = 5;
    expect(validateLayout(L4, "PER_PARTICIPANT_SHOT", slotsOf(2))?.detail).toBe("shot-index");
    const L5 = base();
    L5.slots.pop();
    expect(validateLayout(L5, "PER_PARTICIPANT_SHOT", slotsOf(2))?.detail).toBe("missing-cell");
  });
});

describe("TC-FRAME-020/021: adaptasi frame tanpa skala non-uniform", () => {
  const sizes = [
    { w: 600, h: 1800 },
    { w: 1800, h: 600 },
    { w: 1000, h: 1000 },
    { w: 1201, h: 777 },
  ];
  const ratioOk = (o: { sw: number; sh: number; dw: number; dh: number }) => Math.abs(o.dw / o.sw - o.dh / o.sh) < 1e-9;
  for (const mode of ["FIXED", "CONTAIN", "COVER", "PATTERN", "NINE_SLICE"] as const) {
    it(`${mode}: setiap operasi gambar punya skala sumbu identik`, () => {
      for (const art of sizes)
        for (const canvas of sizes) {
          const t = computeFrameTransform(art, canvas, mode, { top: 80, right: 60, bottom: 80, left: 60 });
          expect(t.ops.length).toBeGreaterThan(0);
          for (const o of t.ops) {
            expect(ratioOk(o)).toBe(true);
            expect(o.dx).toBeGreaterThanOrEqual(-1e-6 - (mode === "COVER" ? 0 : 0));
            expect(o.dx + o.dw).toBeLessThanOrEqual(canvas.w + 1e-6);
            expect(o.dy + o.dh).toBeLessThanOrEqual(canvas.h + 1e-6);
          }
        }
    });
  }
  it("frame 1:3 di output 1:1 → CONTAIN + letterbox (tanpa stretch)", () => {
    const t = computeFrameTransform({ w: 600, h: 1800 }, { w: 1600, h: 1600 }, "CONTAIN");
    expect(t.letterbox).toBe(true);
    expect(t.ops[0]!.dh).toBeCloseTo(1600);
    expect(t.ops[0]!.dw).toBeCloseTo(1600 / 3);
  });
  it("COVER memotong > 15% → peringatan", () => {
    expect(computeFrameTransform({ w: 600, h: 1800 }, { w: 1600, h: 1600 }, "COVER").cropWarning).toBe(true);
    expect(computeFrameTransform({ w: 1000, h: 1000 }, { w: 1100, h: 1000 }, "COVER").cropWarning).toBe(false);
  });
  it("NINE_SLICE: sudut skala seragam, tepi di-tile menutup kanvas tanpa celah", () => {
    const t = computeFrameTransform({ w: 300, h: 300 }, { w: 1000, h: 700 }, "NINE_SLICE", { top: 50, right: 50, bottom: 50, left: 50 });
    const area = t.ops.reduce((a, o) => a + o.dw * o.dh, 0);
    expect(area).toBeCloseTo(1000 * 700, 3);
  });
  it("lubang ikut transform yang sama", () => {
    const t = computeFrameTransform({ w: 1000, h: 2000 }, { w: 1000, h: 1000 }, "CONTAIN");
    expect(transformHoles([{ x: 100, y: 200, w: 400, h: 400 }], t)[0]).toEqual({ x: 300, y: 100, w: 200, h: 200 });
  });
});

describe("frame bawaan & filter", () => {
  it("≥ 6 frame dari 6 kategori V1, lisensi/provenance terisi, fallback Linen ada", () => {
    const cats = new Set(BUILTIN_FRAMES.map((f) => f.category));
    for (const c of ["KOREAN", "MINIMAL", "RETRO", "SCRAPBOOK", "PASTEL", "GRID"]) expect(cats.has(c as never)).toBe(true);
    expect(BUILTIN_FRAMES.length).toBeGreaterThanOrEqual(6);
    for (const f of BUILTIN_FRAMES) expect(f.license.source.length).toBeGreaterThan(10);
    expect(builtinFrame("builtin/linen@1")).toBeDefined();
  });
  it("6 preset filter (05 §12), id tak dikenal → none", () => {
    expect(FILTER_PRESETS.map((f) => f.label)).toEqual(["Asli", "Hangat", "Sejuk", "Pudar", "Film", "Mono"]);
    expect(filterCss("MONO")).toContain("grayscale(1)");
    expect(filterCss("X" as never)).toBe("none");
  });
});

const HOLE_FRAME: FrameTemplate = {
  id: "room/r/f1",
  name: "Lubang",
  category: "CUSTOM",
  modes: [...MODES],
  baseSize: { w: 1000, h: 3000 },
  adapt: "FIXED",
  slots: [0, 1, 2, 3].map((i) => ({ x: 100, y: 100 + i * 700, w: 800, h: 600 })),
  layers: { overlay: { kind: "custom", frameId: "f1", width: 1000, height: 3000 } },
  palette: { bg: "#FFFFFF", ink: "#000000" },
  license: { source: "upload" },
  version: 1,
};

function ctx(over: Partial<StudioContext> = {}): StudioContext {
  return {
    mode: "PHOTO_STRIP",
    participantSlots: slotsOf(4),
    by: "a",
    nowMs: 1,
    changeId: "c1",
    frameLookup: (id) => builtinFrame(id) ?? (id === HOLE_FRAME.id ? HOLE_FRAME : undefined),
    ...over,
  };
}

describe("studio bersama: patch, LWW, Balikin, kunci struktur", () => {
  it("sanitizePatch menolak key/nilai asing", () => {
    expect(sanitizePatch({ mode: "PHOTO_GRID" })).toBeNull();
    expect(sanitizePatch({ shotCount: 2.5 })).toBeNull();
    expect(sanitizePatch({ style: { bgColor: "red" } })).toBeNull();
    expect(sanitizePatch({ style: { filterPreset: "SEPIA" } })).toBeNull();
    expect(sanitizePatch({ frame: { frameId: "x", source: "BUILTIN", adapt: "STRETCH" } })).toBeNull();
    expect(sanitizePatch({ slots: [{ id: "s1", x: Infinity, y: 0, w: 100, h: 100 }] })).toBeNull();
    expect(sanitizePatch({ style: { gap: 8 } })).toEqual({ style: { gap: 8 } });
  });

  it("ganti jumlah shot regenerasi plan; field berbeda digabung; field sama → LWW tercatat", () => {
    const s0 = initStudio("PHOTO_STRIP", slotsOf(4));
    const r1 = applyStudioPatch(s0, { shotCount: 6 }, s0.version, ctx({ by: "a", changeId: "c1" }));
    expect(r1.ok && r1.studio.layout.slots.length).toBe(6);
    if (!r1.ok) return;
    // B mengubah filter berbasis versi lama → tetap diterima, tanpa menimpa shotCount.
    const r2 = applyStudioPatch(r1.studio, { style: { filterPreset: "MONO" } }, s0.version, ctx({ by: "b", changeId: "c2" }));
    expect(r2.ok && r2.studio.layout.shotCount).toBe(6);
    expect(r2.ok && r2.studio.lastChange!.overwrote).toEqual([]);
    if (!r2.ok) return;
    const r3 = applyStudioPatch(r2.studio, { shotCount: 3 }, s0.version, ctx({ by: "b", changeId: "c3" }));
    expect(r3.ok && r3.studio.lastChange!.overwrote).toEqual(["shotCount"]);
  });

  it("Balikin satu langkah mengembalikan nilai sebelumnya; changeId lama ditolak", () => {
    const s0 = initStudio("PHOTO_STRIP", slotsOf(4));
    const r1 = applyStudioPatch(s0, { frame: { frameId: "builtin/film-400@1", source: "BUILTIN", adapt: "CONTAIN", overlayOpacity: 1 } }, 1, ctx({ changeId: "c1" }));
    if (!r1.ok) throw new Error();
    const r2 = applyStudioPatch(r1.studio, { style: { filterPreset: "FILM" } }, r1.studio.version, ctx({ changeId: "c2" }));
    if (!r2.ok) throw new Error();
    expect(revertStudio(r2.studio, "c1", ctx({ changeId: "c3" }))).toMatchObject({ ok: false, error: { reason: "STALE_UNDO" } });
    const r3 = revertStudio(r2.studio, "c2", ctx({ changeId: "c3", by: "b" }));
    expect(r3.ok && r3.studio.style.filterPreset).toBe("ASLI");
    expect(r3.ok && r3.studio.frame!.frameId).toBe("builtin/film-400@1");
    expect(r3.ok && r3.studio.lastChange).toMatchObject({ kind: "revert", revertOf: "c2", by: "b" });
  });

  it("TC-FRAME-007: bindingStrategy bisa diubah sebelum shot 1, terkunci sesudahnya (STRUCTURE_LOCKED)", () => {
    const s0 = initStudio("PHOTO_STRIP", slotsOf(4));
    const r = applyStudioPatch(s0, { bindingStrategy: "PER_PARTICIPANT_SHOT" }, 1, ctx());
    expect(r.ok && r.studio.layout.slots.length).toBe(16);
    if (!r.ok) return;
    const locked = lockStudioStructure(r.studio);
    expect(applyStudioPatch(locked, { bindingStrategy: "PER_SHOT_GROUP" }, locked.version, ctx())).toMatchObject({ ok: false, error: { code: "STRUCTURE_LOCKED" } });
    expect(applyStudioPatch(locked, { shotCount: 2 }, locked.version, ctx())).toMatchObject({ ok: false, error: { code: "STRUCTURE_LOCKED" } });
    // Frame & filter tetap boleh.
    expect(applyStudioPatch(locked, { style: { filterPreset: "SEJUK" } }, locked.version, ctx()).ok).toBe(true);
    expect(regenerateForParticipants(locked, "PHOTO_STRIP", slotsOf(3), ctx().frameLookup)).toBeNull();
  });

  it("safeguard lewat patch → INVALID_PATCH SAFEGUARD + alternatif; state tidak berubah", () => {
    const s0 = initStudio("PHOTO_STRIP", slotsOf(4));
    const r = applyStudioPatch(s0, { shotCount: 12 }, 1, ctx());
    expect(r).toMatchObject({ ok: false, error: { code: "INVALID_PATCH", reason: "SAFEGUARD", violation: { code: "MAX_SHOTS" } } });
    expect(s0.layout.shotCount).toBe(4);
  });

  it("edit slot manual (drag/resize) → CUSTOM; slot keluar kanvas ditolak", () => {
    const s0 = initStudio("PHOTO_GRID", slotsOf(2));
    const s = s0.layout.slots[0]!;
    const ok = applyStudioPatch(s0, { slots: [{ id: s.id, x: s.x + 10, y: s.y, w: s.w - 20, h: s.h }] }, 1, ctx({ mode: "PHOTO_GRID", participantSlots: slotsOf(2) }));
    expect(ok.ok && ok.studio.layout.arrangement).toBe("CUSTOM");
    const bad = applyStudioPatch(s0, { slots: [{ id: s.id, x: 99999, y: 0, w: 200, h: 200 }] }, 1, ctx({ mode: "PHOTO_GRID", participantSlots: slotsOf(2) }));
    expect(bad).toMatchObject({ ok: false, error: { code: "INVALID_PATCH", reason: "GEOMETRY" } });
  });

  it("frame custom FIXED berlubang → plan mengikuti lubang; lubang kurang → FRAME_SLOTS + alternatif", () => {
    const s0 = initStudio("PHOTO_STRIP", slotsOf(4));
    const fixed = { frameId: HOLE_FRAME.id, source: "CUSTOM" as const, adapt: "FIXED" as const, overlayOpacity: 1 };
    const r = applyStudioPatch(s0, { frame: fixed }, 1, ctx());
    expect(r.ok && r.studio.layout.slots.length).toBe(4);
    expect(r.ok && r.studio.layout.canvas.heightPx / r.studio.layout.canvas.widthPx).toBeCloseTo(3);
    const r2 = applyStudioPatch(s0, { frame: fixed, bindingStrategy: "PER_PARTICIPANT_SHOT" }, 1, ctx());
    expect(r2).toMatchObject({ ok: false, error: { reason: "SAFEGUARD", violation: { code: "FRAME_SLOTS", limit: 4, actual: 16 } } });
    expect(planFromHoles({ mode: "PHOTO_STRIP", strategy: "PER_SHOT_GROUP", shotCount: 2, participantSlots: slotsOf(1), slotRatio: "4:3", gap: 0, cornerRadius: 0, holes: HOLE_FRAME.slots!, art: HOLE_FRAME.baseSize }).ok).toBe(true);
  });

  it("peserta ke-4 join sebelum shot 1 → plan dibangkitkan ulang (07 §7.2)", () => {
    const s0 = initStudio("PHOTO_GRID", slotsOf(3));
    const s1 = regenerateForParticipants(s0, "PHOTO_GRID", slotsOf(4), ctx().frameLookup)!;
    expect(s1.layout.slots).toHaveLength(4);
    expect(validateLayout(s1.layout, s1.bindingStrategy, slotsOf(4))).toBeNull();
  });
});

describe("scene tunggal (10 §1, §13)", () => {
  it("tile per slot sesuai strategi; BLEND punya masker tepi; filter = string CSS preset", async () => {
    const { buildScene } = await import("../studio");
    const s = initStudio("GROUP_SHOT", slotsOf(3));
    const scene = buildScene({ ...s, style: { ...s.style, filterPreset: "HANGAT" } }, builtinFrame("builtin/editorial@1")!, { names: ["A", "B", "C"], dateText: "2026.10.26" });
    expect(scene.slots).toHaveLength(1);
    expect(scene.slots[0]!.tiles.map((t) => t.participantSlot)).toEqual(["P1", "P2", "P3"]);
    expect(scene.slots[0]!.tiles[0]!.blend).toEqual({ left: false, right: true });
    expect(scene.filter).toContain("sepia");
    expect(scene.decor.some((d) => d.kind === "text" && d.text === "2026.10.26")).toBe(true);
  });
  it("frame custom: overlay memakai operasi gambar skala seragam; polaroid memberi inset foto", async () => {
    const { buildScene } = await import("../studio");
    const s = initStudio("PHOTO_STRIP", slotsOf(2));
    const scene = buildScene({ ...s, frame: { frameId: HOLE_FRAME.id, source: "CUSTOM", adapt: "CONTAIN", overlayOpacity: 0.8 } }, HOLE_FRAME, { names: [], dateText: "" });
    expect(scene.overlay!.opacity).toBe(0.8);
    for (const o of scene.overlay!.ops) expect(o.dw / o.sw).toBeCloseTo(o.dh / o.sh, 9);
    const scrap = buildScene(s, builtinFrame("builtin/scrapbook@1")!, { names: [], dateText: "" });
    expect(scrap.slots[0]!.photo.w).toBeLessThan(scrap.slots[0]!.w);
    expect(scrap.slots[0]!.frameFill).toBe("#FFFFFF");
  });
});
