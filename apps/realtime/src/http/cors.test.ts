import { describe, expect, it } from "vitest";
import { loadConfig } from "../config";
import { applyCors, isAllowedOrigin } from "./util";

const cfg = loadConfig({ ALLOWED_ORIGINS: "https://app.longroll.id" } as never);
const run = (origin?: string) => {
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => (headers[k.toLowerCase()] = v) };
  applyCors(cfg, { headers: origin ? { origin } : {} } as never, res as never);
  return headers;
};

describe("applyCors (allowlist eksak + Vary: Origin)", () => {
  it("origin sah: ACAO sama persis + credentials; bukan wildcard", () => {
    const h = run("https://app.longroll.id");
    expect(h["access-control-allow-origin"]).toBe("https://app.longroll.id");
    expect(h["access-control-allow-credentials"]).toBe("true");
  });

  it("origin asing / tanpa Origin: tanpa ACAO, tetapi TETAP Vary: Origin (cache <img> tak boleh dipakai ulang untuk fetch CORS)", () => {
    for (const o of ["https://evil.example", "https://app.longroll.id.evil.example", "http://app.longroll.id", undefined]) {
      const h = run(o);
      expect(h["access-control-allow-origin"], String(o)).toBeUndefined();
      expect(h["access-control-allow-credentials"]).toBeUndefined();
      expect(h["vary"]).toBe("Origin");
    }
    expect(isAllowedOrigin(cfg, "*")).toBe(false);
  });
});
