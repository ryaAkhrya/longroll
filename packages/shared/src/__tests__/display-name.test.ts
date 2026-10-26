import { describe, expect, it } from "vitest";
import { uniqueDisplayName, validateDisplayName } from "../display-name";

describe("validateDisplayName (DEC-043)", () => {
  it("trim, rapatkan spasi, terima huruf/angka/emoji", () => {
    expect(validateDisplayName("  Nadia   R  ")).toEqual({ ok: true, value: "Nadia R" });
    expect(validateDisplayName("Bimo 🎉")).toEqual({ ok: true, value: "Bimo 🎉" });
    expect(validateDisplayName("👩‍👩‍👧")).toMatchObject({ ok: true });
  });

  it("tolak kosong, > 20 karakter, dan karakter markup", () => {
    expect(validateDisplayName("   ")).toEqual({ ok: false, reason: "EMPTY" });
    expect(validateDisplayName("a".repeat(21))).toEqual({ ok: false, reason: "TOO_LONG" });
    expect(validateDisplayName("<b>hi</b>")).toEqual({ ok: false, reason: "CHARS" });
    expect(validateDisplayName(42)).toEqual({ ok: false, reason: "EMPTY" });
  });

  it("buang karakter kontrol", () => {
    expect(validateDisplayName("Ra\u0000ka\u202E")).toEqual({ ok: true, value: "Raka" });
  });
});

describe("uniqueDisplayName", () => {
  it("sufiks ' 2' tanpa melewati batas", () => {
    expect(uniqueDisplayName("Raka", ["raka"])).toBe("Raka 2");
    expect(uniqueDisplayName("Raka", ["Raka", "Raka 2"])).toBe("Raka 3");
    expect(uniqueDisplayName("a".repeat(20), ["a".repeat(20)])).toBe(`${"a".repeat(18)} 2`);
  });
});
