import { describe, expect, it } from "vitest";
import { DEFAULT_CAMERA_PRESENTATION } from "@longroll/shared";
import { buildConstraints, mapCameraError, RESOLUTION_TIERS } from "../camera";
import { presenceCamera } from "../MediaProvider";
import { presentationFilter, presentationTransform } from "../presentation";
import { encodingFor, nextQuality, QUALITY_LEVELS } from "../quality";
import { isPolite } from "../transport";

describe("kamera (09 §1)", () => {
  it("constraint selalu tanpa audio (TC-CAM-007 / DEC-076)", () => {
    for (let tier = 0; tier < RESOLUTION_TIERS.length; tier++) {
      expect(buildConstraints({ tier }).audio).toBe(false);
      expect(buildConstraints({ tier, deviceId: "abc" }).audio).toBe(false);
    }
  });

  it("deviceId → exact, tanpa deviceId → facingMode", () => {
    expect(buildConstraints({ tier: 0, deviceId: "cam-1" }).video).toMatchObject({ deviceId: { exact: "cam-1" } });
    expect(buildConstraints({ tier: 0, facing: "environment" }).video).toMatchObject({ facingMode: "environment" });
    expect(buildConstraints({ tier: 2 }).video).toMatchObject({ width: { ideal: 640 }, height: { ideal: 480 } });
  });

  it("pemetaan error DOM → state UI (09 §1.1)", () => {
    expect(mapCameraError({ name: "NotAllowedError" })).toBe("denied");
    expect(mapCameraError({ name: "SecurityError" })).toBe("denied");
    expect(mapCameraError({ name: "NotFoundError" })).toBe("unavailable");
    expect(mapCameraError({ name: "NotReadableError" })).toBe("in_use");
    expect(mapCameraError({ name: "AbortError" })).toBe("in_use");
  });

  it("status lokal → presence.camera", () => {
    expect(presenceCamera("live", false)).toBe("live");
    expect(presenceCamera("starting", true)).toBe("permission");
    expect(presenceCamera("idle", true)).toBe("permission");
    expect(presenceCamera("idle", false)).toBe("none");
    expect(presenceCamera("ended", false)).toBe("off");
    expect(presenceCamera("denied", false)).toBe("none");
    expect(presenceCamera("in_use", false)).toBe("in_use");
  });
});

describe("role offer (09 §5)", () => {
  it("participantId lebih kecil = impolite (membuat offer); simetris", () => {
    expect(isPolite("a", "b")).toBe(false);
    expect(isPolite("b", "a")).toBe(true);
  });
});

describe("adaptasi kualitas (DEC-072)", () => {
  it("turun saat bitrate keluar rendah, naik setelah 3 sampel bagus", () => {
    let s = { level: 0, goodStreak: 0 };
    s = nextQuality(s, 200_000);
    expect(s.level).toBe(1);
    s = nextQuality(s, 100_000);
    expect(s.level).toBe(2);
    s = nextQuality(s, 400_000);
    s = nextQuality(s, 400_000);
    expect(s.level).toBe(2);
    s = nextQuality(s, 400_000);
    expect(s.level).toBe(1);
    expect(nextQuality(s, null)).toEqual(s);
  });

  it("encoding ≤ 640×480 @ 500 kbps pada level 0; 320×240 & 12 fps pada level 2", () => {
    expect(encodingFor(0, 1920, 1080)).toEqual({ maxBitrate: QUALITY_LEVELS[0]!.maxBitrate, maxFramerate: 30, scaleResolutionDownBy: 3 });
    expect(encodingFor(0, 640, 480).scaleResolutionDownBy).toBe(1);
    expect(encodingFor(2, 1280, 720)).toMatchObject({ maxFramerate: 12, scaleResolutionDownBy: 4 });
  });
});

describe("framing tampilan (09 §4.1)", () => {
  it("default tanpa transform/filter; cermin hanya scaleX", () => {
    expect(presentationTransform(DEFAULT_CAMERA_PRESENTATION, false)).toBe("none");
    expect(presentationFilter(DEFAULT_CAMERA_PRESENTATION)).toBe("none");
    expect(presentationTransform(DEFAULT_CAMERA_PRESENTATION, true)).toBe("scaleX(-1)");
  });

  it("geser dibatasi ruang hasil zoom (tidak memperlihatkan tepi kosong)", () => {
    const t = presentationTransform({ zoom: 2, offset: { x: 1, y: -1 }, brightness: 0, warmth: 0 }, false);
    expect(t).toBe("translate(-50%, 50%) scale(2)");
    expect(presentationFilter({ zoom: 1, offset: { x: 0, y: 0 }, brightness: 1, warmth: 1 })).toBe("brightness(1.35) sepia(0.3) saturate(1.15)");
  });
});
