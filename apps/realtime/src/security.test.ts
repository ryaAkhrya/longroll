import { describe, expect, it } from "vitest";
import { ROOM_CODE_ALPHABET } from "@longroll/shared";
import { generateRoomCode, generateToken, hashEquals, hashIp, hashToken, uuidv7 } from "./security";

describe("security", () => {
  it("kode room 6 karakter dari alfabet DEC-022", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(6);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    }
  });

  it("token 32 byte base64url dan hash SHA-256 dibandingkan constant-time", () => {
    const t = generateToken();
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(hashEquals(hashToken(t), hashToken(t))).toBe(true);
    expect(hashEquals(hashToken(t), hashToken(generateToken()))).toBe(false);
    expect(hashEquals(null, hashToken(t))).toBe(false);
  });

  it("hash IP bersalt tidak memuat IP mentah", () => {
    const h = hashIp("203.0.113.9", "salt");
    expect(h).not.toContain("203");
    expect(hashIp("203.0.113.9", "other")).not.toBe(h);
  });

  it("uuidv7 berformat benar", () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
