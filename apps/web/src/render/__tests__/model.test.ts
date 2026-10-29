import { describe, expect, it } from "vitest";
import { initStudio, publicStudio } from "@longroll/shared";
import { parseLayoutJson, sceneFor } from "../model";

/** TC-REG-P10-001: masuk editor crash "Cannot read properties of undefined (reading 'style.bgColor')" (layout tanpa fieldVersions). */
describe("parseLayoutJson / sceneFor", () => {
  const studio = publicStudio(initStudio("PHOTO_GRID", ["P1", "P2", "P3", "P4"]))!;
  const meta = { canvas: { w: studio.layout.canvas.widthPx, h: studio.layout.canvas.heightPx }, frame: null, frameStyle: { bgColor: "#FFFFFF", overlayOpacity: 1 }, globalFilter: null, schemaVersion: 1 } as never;

  it("dokumen lama (tanpa fieldVersions) tetap menghasilkan scene tanpa melempar", () => {
    const { layout, participantSlots, style, bindingStrategy } = studio;
    const parsed = parseLayoutJson(JSON.stringify({ layout, participantSlots, style, bindingStrategy }));
    expect(parsed?.studio.fieldVersions).toEqual({});
    expect(sceneFor(meta, parsed, null, ["A", "B", "C", "D"], Date.UTC(2026, 9, 29))).not.toBeNull();
  });

  it("fieldVersions yang tersimpan dipertahankan; JSON rusak / bukan string → null", () => {
    const { layout, participantSlots, style, bindingStrategy } = studio;
    const parsed = parseLayoutJson(JSON.stringify({ layout, participantSlots, style, bindingStrategy, fieldVersions: { "style.bgColor": 3 } }));
    expect(parsed?.studio.fieldVersions["style.bgColor"]).toBe(3);
    expect(parseLayoutJson("{bukan json")).toBeNull();
    expect(parseLayoutJson(undefined)).toBeNull();
  });
});
