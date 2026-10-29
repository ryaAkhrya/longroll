import { describe, expect, it } from "vitest";
import {
  CAPTURE_CONFIG,
  DEFAULT_CAMERA_PRESENTATION,
  acceptedForCell,
  activeShot,
  attemptKey,
  captureCrop,
  clockSample,
  computeClockOffset,
  isCountdownChoice,
  publicCapture,
  shotSettled,
} from "../index";
import type { CaptureState, Shot } from "../index";

const ps = (status: Shot["perParticipant"][string]["status"], accepted: string | null = null) => ({ status, attempts: [], currentAttemptId: null, acceptedAttemptId: accepted, retakeT0ServerMs: null, statusAtMs: 0 });
const shot = (over: Partial<Shot> = {}): Shot => ({
  index: 0,
  state: "REVIEW",
  t0ServerMs: 1,
  armedBy: "a",
  armedAtMs: 0,
  countdownSec: 5,
  required: ["a", "b"],
  slotOf: { a: "P1", b: "P2" },
  perParticipant: { a: ps("ACCEPTED", "x"), b: ps("DECIDING") },
  doneAtMs: null,
  heldBy: null,
  ...over,
});

describe("sinkronisasi jam (DEC-074)", () => {
  it("offset = ts − (t1 + rtt/2); median; sampel rtt > 2× median dibuang", () => {
    const real = 1500; // server 1500 ms di depan klien
    const mk = (rtt: number, jitterAsym = 0) => {
      const t1 = 10_000;
      const t2 = t1 + rtt;
      return clockSample(t1, t1 + rtt / 2 + real + jitterAsym, t2);
    };
    expect(mk(40).offsetMs).toBe(real);
    const samples = [mk(40), mk(44), mk(38), mk(41), mk(900, 400)]; // satu sampel lambat & asimetris
    expect(computeClockOffset(samples)).toBe(real);
    expect(computeClockOffset([])).toBeNull();
    expect(computeClockOffset([mk(50)])).toBe(real);
    // tanpa filter median akan meleset: pastikan sampel outlier memang berbeda
    expect(samples[4]!.offsetMs).not.toBe(real);
  });
});

describe("captureCrop: framing + cermin (09 §4.1, DEC-064)", () => {
  const cp = (zoom: number, x = 0, y = 0) => ({ ...DEFAULT_CAMERA_PRESENTATION, zoom, offset: { x, y } });
  it("zoom 1 = frame penuh; zoom 2 = separuh sisi di tengah; skala seragam (rasio terjaga)", () => {
    expect(captureCrop(1280, 720, cp(1), false)).toMatchObject({ sx: 0, sy: 0, sw: 1280, sh: 720, outW: 1280, outH: 720, flip: false });
    const z = captureCrop(1280, 720, cp(2), false);
    expect(z).toMatchObject({ sx: 320, sy: 180, sw: 640, sh: 360 });
    expect(z.outW / z.outH).toBeCloseTo(1280 / 720, 2);
  });
  it("offset menggeser wilayah; cermin membalik sumbu X wilayah; tak pernah keluar frame", () => {
    const right = captureCrop(1000, 1000, cp(2, 1, 0), false);
    expect(right.sx + right.sw).toBeLessThanOrEqual(1000);
    expect(right.sx).toBeGreaterThan(250);
    const mirrored = captureCrop(1000, 1000, cp(2, 1, 0), true);
    expect(mirrored.sx).toBeLessThan(250); // tampilan tercermin: geser kanan = wilayah kiri sumber
    expect(mirrored.flip).toBe(true);
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const c = captureCrop(1920, 1080, cp(2, x, y), x > 0);
      expect(c.sx).toBeGreaterThanOrEqual(0);
      expect(c.sy).toBeGreaterThanOrEqual(0);
      expect(c.sx + c.sw).toBeLessThanOrEqual(1920 + 1e-6);
      expect(c.sy + c.sh).toBeLessThanOrEqual(1080 + 1e-6);
    }
  });
  it("sisi terpanjang ≤ batas (4096 / preview 640), tanpa upscale", () => {
    const big = captureCrop(7680, 4320, cp(1), false);
    expect(Math.max(big.outW, big.outH)).toBe(CAPTURE_CONFIG.fullMaxPx);
    const pv = captureCrop(1920, 1080, cp(1), false, CAPTURE_CONFIG.previewMaxPx);
    expect(Math.max(pv.outW, pv.outH)).toBe(640);
    expect(captureCrop(640, 480, cp(1), false).outW).toBe(640);
  });
});

describe("helper state capture", () => {
  it("shotSettled hanya bila SEMUA wajib ACCEPTED/SKIPPED (tanpa auto-accept)", () => {
    expect(shotSettled(shot())).toBe(false);
    expect(shotSettled(shot({ perParticipant: { a: ps("ACCEPTED", "x"), b: ps("SKIPPED") } }))).toBe(true);
    expect(shotSettled(shot({ perParticipant: { a: ps("ACCEPTED", "x"), b: ps("MISSING") } }))).toBe(false);
    expect(shotSettled(shot({ perParticipant: { a: ps("ACCEPTED", "x"), b: ps("NOT_REQUIRED") }, required: ["a"] }))).toBe(true);
  });
  it("acceptedForCell: hanya setelah DONE; memetakan slot peserta → attempt; activeShot", () => {
    const done = shot({ state: "DONE", perParticipant: { a: ps("ACCEPTED", "att-a"), b: ps("ACCEPTED", "att-b") } });
    const c: CaptureState = { eligible: { a: "P1", b: "P2" }, shotCount: 2, shots: [done], attempts: {}, bytesUsed: 0 };
    expect(acceptedForCell(c, 0, "P2")).toBe("att-b");
    expect(acceptedForCell(c, 1, "P1")).toBeNull();
    expect(acceptedForCell({ ...c, shots: [shot()] }, 0, "P1")).toBeNull();
    expect(activeShot(c)).toBeNull();
    expect(activeShot({ ...c, shots: [done, shot({ index: 1 })] })!.index).toBe(1);
  });
  it("publicCapture membuang key object storage; key attempt terikat room", () => {
    const c: CaptureState = {
      eligible: {},
      shotCount: 1,
      shots: [],
      bytesUsed: 0,
      attempts: { x: { attemptId: "x", shotIndex: 0, ownerId: "a", ownerNameAtCapture: "A", ownerColor: "P1", attemptNo: 1, kind: "shot", status: "READY", createdAtMs: 0, capturedAtServerMs: 0, late: false, mirrored: false, preview: null, full: null, purged: false, previewKey: "rooms/r/attempts/x/preview.jpg", fullKey: "rooms/r/attempts/x/full.jpg" } },
    };
    expect(JSON.stringify(publicCapture(c))).not.toContain("rooms/");
    expect(attemptKey("r1", "att", "full")).toBe("rooms/r1/attempts/att/full.jpg");
    expect(isCountdownChoice(3) && isCountdownChoice(5) && isCountdownChoice(10)).toBe(true);
    expect(isCountdownChoice(4)).toBe(false);
  });
});
