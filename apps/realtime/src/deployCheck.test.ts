import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { checkProductionConfig, siteOf } from "./deployCheck";

const base = {
  NODE_ENV: "production",
  ALLOWED_ORIGINS: "https://app.longroll.id",
  PUBLIC_WS_URL: "wss://rt.longroll.id/ws",
  DATABASE_URL: "postgresql://x",
  TRUST_PROXY: "1",
  TURN_URLS: "turn:turn.longroll.id:3478",
  TURN_SHARED_SECRET: "s",
};
const check = (env: Record<string, string>) => checkProductionConfig(loadConfig({ ...base, ...env } as never));

describe("siteOf (heuristik eTLD+1)", () => {
  it("domain kustom, ccTLD dua-label, dan hosting multi-tenant", () => {
    expect(siteOf("app.longroll.id")).toBe("longroll.id");
    expect(siteOf("rt.longroll.id")).toBe("longroll.id");
    expect(siteOf("app.longroll.co.id")).toBe("longroll.co.id");
    expect(siteOf("longroll.vercel.app")).toBe("longroll.vercel.app");
    expect(siteOf("x.y.longroll.vercel.app")).toBe("longroll.vercel.app");
    expect(siteOf("longroll-rt.up.railway.app")).toBe("longroll-rt.up.railway.app");
    expect(siteOf("localhost")).toBe("localhost");
  });
});

describe("checkProductionConfig (DEC-082, 15 §3)", () => {
  it("topologi sah: app.<domain> + rt.<domain>, host-only → tanpa error", () => {
    expect(check({}).errors).toEqual([]);
  });

  it("vercel.app + railway.app = lintas-site → ditolak dengan penjelasan DEC-082", () => {
    const r = check({ ALLOWED_ORIGINS: "https://longroll.vercel.app", PUBLIC_WS_URL: "wss://longroll-rt.up.railway.app/ws" });
    expect(r.errors.join(" ")).toMatch(/DEC-082.*bukan site yang sama/);
  });

  it("tidak melonggarkan keamanan: http, ws, COOKIE_SECURE=false, placeholder .invalid, path/slash pada origin, localhost", () => {
    expect(check({ ALLOWED_ORIGINS: "http://app.longroll.id" }).errors.join()).toMatch(/https/);
    expect(check({ PUBLIC_WS_URL: "ws://rt.longroll.id/ws" }).errors.join()).toMatch(/wss/);
    expect(check({ COOKIE_SECURE: "false" }).errors.join()).toMatch(/COOKIE_SECURE/);
    expect(check({ ALLOWED_ORIGINS: "https://realtime.longroll.invalid", PUBLIC_WS_URL: "wss://realtime.longroll.invalid/ws" }).errors.join()).toMatch(/placeholder/);
    expect(check({ ALLOWED_ORIGINS: "https://app.longroll.id/" }).errors.join()).toMatch(/origin murni/);
    expect(check({ PUBLIC_WS_URL: "wss://localhost:4000/ws" }).errors.join()).toMatch(/placeholder\/lokal/);
    expect(check({ ALLOWED_ORIGINS: "*" }).errors.length).toBeGreaterThan(0);
  });

  it("COOKIE_DOMAIN: harus induk host realtime dan bukan public suffix; selalu diberi peringatan", () => {
    const ok = check({ COOKIE_DOMAIN: "longroll.id" });
    expect(ok.errors).toEqual([]);
    expect(ok.warnings.join()).toMatch(/COOKIE_DOMAIN/);
    expect(check({ COOKIE_DOMAIN: "other.id" }).errors.join()).toMatch(/bukan induk/);
    expect(check({ COOKIE_DOMAIN: "vercel.app" }).errors.length).toBeGreaterThan(0);
  });

  it("S3 wajib https; TURN_URLS tanpa secret ditolak; TURN kosong & TRUST_PROXY=0 hanya peringatan", () => {
    expect(check({ S3_ENDPOINT: "http://s3.example.com" }).errors.join()).toMatch(/S3_ENDPOINT/);
    expect(check({ TURN_SHARED_SECRET: "" }).errors.join()).toMatch(/TURN_SHARED_SECRET/);
    const w = check({ TURN_URLS: "", TURN_SHARED_SECRET: "", TRUST_PROXY: "0" });
    expect(w.errors).toEqual([]);
    expect(w.warnings.join()).toMatch(/TURN_URLS kosong/);
    expect(w.warnings.join()).toMatch(/TRUST_PROXY=0/);
  });

  it("non-produksi: tidak memeriksa apa pun (dev lokal tetap http://localhost)", () => {
    expect(checkProductionConfig(loadConfig({ NODE_ENV: "development" } as never))).toEqual({ errors: [], warnings: [] });
  });
});
