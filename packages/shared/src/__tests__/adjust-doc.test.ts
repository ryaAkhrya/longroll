import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import {
  NEUTRAL_ADJUST,
  PARTICIPANT_SLOTS,
  createSeededDoc,
  effectiveAdjust,
  initStudio,
  listElements,
  metaMap,
  readHistory,
  readMeta,
  revertEntry,
  setGlobalAdjust,
  setPhotoAdjust,
  validateDoc,
} from "../index";
import type { Attempt, CaptureState, EditorCtx, ParticipantSlot, Shot } from "../index";

const SLOTS = PARTICIPANT_SLOTS as readonly ParticipantSlot[];
const PIDS = ["pa", "pb"];

function seeded() {
  const studio = initStudio("PHOTO_STRIP", SLOTS.slice(0, PIDS.length) as ParticipantSlot[]);
  const attempts: Record<string, Attempt> = {};
  const accepted = new Map<string, string>();
  const shots: Shot[] = Array.from({ length: studio.layout.shotCount }, (_, s) => {
    const per: Shot["perParticipant"] = {};
    PIDS.forEach((pid, i) => {
      const id = `att-${s}-${i}`;
      per[pid] = { status: "ACCEPTED", attempts: [id], currentAttemptId: id, acceptedAttemptId: id, retakeT0ServerMs: null, statusAtMs: 0 };
      attempts[id] = { attemptId: id, shotIndex: s, ownerId: pid, ownerNameAtCapture: `N${i}`, ownerColor: SLOTS[i]!, attemptNo: 1, kind: "shot", status: "READY", createdAtMs: 0, capturedAtServerMs: 0, late: false, mirrored: false, preview: { bytes: 1, width: 640, height: 480, sha256: "a".repeat(64) }, full: { bytes: 1, width: 1600, height: 1200, sha256: "b".repeat(64) }, purged: false };
      accepted.set(id, pid);
    });
    return { index: s, state: "DONE", t0ServerMs: 1, armedBy: PIDS[0]!, armedAtMs: 0, countdownSec: 5, required: PIDS, slotOf: Object.fromEntries(PIDS.map((p, i) => [p, SLOTS[i]!])), perParticipant: per, doneAtMs: 1, heldBy: null } satisfies Shot;
  });
  const capture: CaptureState = { eligible: Object.fromEntries(PIDS.map((p, i) => [p, SLOTS[i]!])), shotCount: shots.length, shots, attempts, bytesUsed: 0 };
  const doc = createSeededDoc({ studio, capture, names: { pa: "A", pb: "B" }, srcDims: () => ({ w: 1600, h: 1200 }) });
  return { doc, acc: { acceptedAttempts: accepted } };
}
const ctx = (pid: string, clock = { t: 1000 }): EditorCtx => ({ participantId: pid, name: pid, origin: { pid }, now: () => clock.t });

describe("adjust di dokumen kolaboratif", () => {
  it("dokumen baru tanpa adjust: meta netral & valid (kompatibel dokumen lama)", () => {
    const { doc, acc } = seeded();
    expect(readMeta(doc)!.globalAdjust ?? null).toBeNull();
    expect(validateDoc(doc, acc)).toBeNull();
  });

  it("global & per-foto: tersimpan padat (kunci ≠ 0), valid, per-foto menggantikan global, null = ikut global", () => {
    const { doc, acc } = seeded();
    expect(setGlobalAdjust(doc, ctx("pa"), { ...NEUTRAL_ADJUST, exposure: 20, contrast: -10 })).toBe(true);
    expect(readMeta(doc)!.globalAdjust).toEqual({ exposure: 20, contrast: -10 });
    expect(setGlobalAdjust(doc, ctx("pa"), { ...NEUTRAL_ADJUST, exposure: 20, contrast: -10 })).toBe(false); // tak ada perubahan
    const photo = listElements(doc).find((e) => e.type === "photo")!;
    expect(setPhotoAdjust(doc, ctx("pb"), photo.id, { ...NEUTRAL_ADJUST, saturation: -100 })).toBe(true);
    const after = listElements(doc).find((e) => e.id === photo.id)!;
    expect(after.adjust).toEqual({ saturation: -100 });
    expect(validateDoc(doc, acc)).toBeNull();
    expect(effectiveAdjust(after, readMeta(doc)!.globalAdjust)).toMatchObject({ saturation: -100, exposure: 0 }); // per-foto menggantikan
    const other = listElements(doc).filter((e) => e.type === "photo" && e.id !== photo.id)[0]!;
    expect(effectiveAdjust(other, readMeta(doc)!.globalAdjust)).toMatchObject({ exposure: 20, contrast: -10 });
    expect(setPhotoAdjust(doc, ctx("pb"), photo.id, null)).toBe(true);
    expect(effectiveAdjust(listElements(doc).find((e) => e.id === photo.id)!, readMeta(doc)!.globalAdjust)).toMatchObject({ exposure: 20 });
  });

  it("reset (netral) menghapus nilai & Balikin mengembalikan nilai sebelumnya", () => {
    const { doc } = seeded();
    setGlobalAdjust(doc, ctx("pa"), { ...NEUTRAL_ADJUST, temperature: 30 });
    const set = readHistory(doc).at(-1)!;
    setGlobalAdjust(doc, ctx("pa"), NEUTRAL_ADJUST);
    expect(metaMap(doc).get("globalAdjust")).toBeNull();
    const reset = readHistory(doc).at(-1)!;
    expect(revertEntry(doc, ctx("pb"), reset.id)).toEqual({ ok: true });
    expect(readMeta(doc)!.globalAdjust).toEqual({ temperature: 30 });
    expect(set.metaKey).toBe("globalAdjust");
  });

  it("validasi menolak nilai di luar rentang, bukan bilangan bulat, dan kunci asing (dokumen dibuang, bukan dipotong)", () => {
    const { doc, acc } = seeded();
    const bad = (v: unknown) => {
      const d = new Y.Doc();
      Y.applyUpdate(d, Y.encodeStateAsUpdate(doc));
      metaMap(d).set("globalAdjust", v);
      return validateDoc(d, acc);
    };
    expect(bad({ exposure: 101 })?.code).toBe("SCHEMA");
    expect(bad({ grain: -1 })?.code).toBe("SCHEMA");
    expect(bad({ exposure: 1.5 })?.code).toBe("SCHEMA");
    expect(bad({ hacked: 1 })?.code).toBe("SCHEMA");
    expect(bad("x")?.code).toBe("SCHEMA");
    expect(bad({ exposure: 10 })).toBeNull();
    expect(bad(null)).toBeNull();
  });

  it("dua peserta mengatur bersamaan: kunci berbeda pada meta = LWW satu nilai konvergen; foto berbeda tak saling menimpa", () => {
    const a = seeded().doc;
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const photos = listElements(a).filter((e) => e.type === "photo");
    setPhotoAdjust(a, ctx("pa"), photos[0]!.id, { ...NEUTRAL_ADJUST, exposure: 40 });
    setPhotoAdjust(b, ctx("pb"), photos[1]!.id, { ...NEUTRAL_ADJUST, tint: -30 });
    setGlobalAdjust(a, ctx("pa"), { ...NEUTRAL_ADJUST, contrast: 10 });
    setGlobalAdjust(b, ctx("pb"), { ...NEUTRAL_ADJUST, contrast: -10 });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const la = listElements(a);
    expect(la.find((e) => e.id === photos[0]!.id)!.adjust).toEqual({ exposure: 40 });
    expect(la.find((e) => e.id === photos[1]!.id)!.adjust).toEqual({ tint: -30 });
    expect(readMeta(a)!.globalAdjust).toEqual(readMeta(b)!.globalAdjust); // konvergen, deterministik
    expect(listElements(b)).toEqual(la);
  });

  it("muatan kecil: adjust penuh < 200 byte (tanpa bitmap)", () => {
    const { doc } = seeded();
    const before = Y.encodeStateAsUpdate(doc).length;
    setGlobalAdjust(doc, ctx("pa"), { exposure: 10, brightness: 10, contrast: 10, saturation: 10, highlights: 10, shadows: 10, temperature: 10, tint: 10, grain: 10 });
    const d = new Y.Doc();
    Y.applyUpdate(d, Y.encodeStateAsUpdate(doc));
    expect(Y.encodeStateAsUpdate(doc, Y.encodeStateVector(d)).length).toBe(2); // sudah identik
    expect(Y.encodeStateAsUpdate(doc).length - before).toBeLessThan(600);
  });
});
