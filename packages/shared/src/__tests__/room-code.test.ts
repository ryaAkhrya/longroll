import { describe, expect, it } from "vitest";
import { isCompleteRoomCode, normalizeRoomCode } from "../room-code";

describe("normalizeRoomCode", () => {
  it("huruf besar dan membuang karakter ambigu/di luar alfabet", () => {
    expect(normalizeRoomCode("ab0o1i-c2")).toBe("ABC2");
  });
  it("memotong ke 6 karakter", () => {
    expect(normalizeRoomCode("abcdefgh")).toBe("ABCDEF");
  });
});

describe("isCompleteRoomCode", () => {
  it("true hanya untuk 6 karakter valid", () => {
    expect(isCompleteRoomCode("GENG27")).toBe(true);
    expect(isCompleteRoomCode("GENG2")).toBe(false);
    expect(isCompleteRoomCode("BOBA27")).toBe(false); // O tidak ada di alfabet DEC-022
  });
});
