// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { buildCsp, cspEnvFromProcess, makeNonce } from "../csp";
import type { CspEnv } from "../csp";

const prod: CspEnv = { isDev: false, realtimeUrl: "https://rt.longroll.example", storageOrigin: "https://bucket.storage.example", googleEnabled: false, upgradeInsecure: true };
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("CSP final (TC-SEC-021, TH-03)", () => {
  it("produksi: script-src tanpa 'unsafe-inline' & 'unsafe-eval', bernonce + strict-dynamic", () => {
    const csp = buildCsp("NONCE123", prod);
    const script = directive(csp, "script-src");
    expect(script).toContain("'nonce-NONCE123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    // <style>/<link> memakai nonce; hanya ATRIBUT style yang boleh inline.
    expect(directive(csp, "style-src")).toBe("style-src 'self' 'nonce-NONCE123'");
    expect(directive(csp, "style-src-attr")).toBe("style-src-attr 'unsafe-inline'");
  });

  it("direktif pengunci: default-src self, object none, base-uri none, frame-ancestors none, form-action self, upgrade-insecure-requests", () => {
    const csp = buildCsp("n", prod);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(directive(csp, "media-src")).toBe("media-src 'self' blob:");
  });

  it("connect-src/img-src hanya origin realtime + storage; tanpa wildcard di produksi", () => {
    const csp = buildCsp("n", prod);
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' https://rt.longroll.example wss://rt.longroll.example https://bucket.storage.example");
    expect(directive(csp, "img-src")).toContain("https://bucket.storage.example");
    expect(csp).not.toMatch(/ \*[ ;]|\* /);
    expect(csp).not.toContain("ws://localhost");
  });

  it("origin Google hanya diizinkan bila OAuth client dikonfigurasi (least privilege)", () => {
    expect(buildCsp("n", prod)).not.toContain("google");
    const g = buildCsp("n", { ...prod, googleEnabled: true });
    expect(directive(g, "script-src")).toContain("https://accounts.google.com/gsi/client");
    expect(directive(g, "connect-src")).toContain("https://www.googleapis.com");
    expect(directive(g, "frame-src")).toBe("frame-src https://accounts.google.com");
    expect(directive(g, "script-src")).not.toContain("'unsafe-inline'");
  });

  it("development: unsafe-eval untuk React dev, tetap tanpa unsafe-inline pada script", () => {
    const dev = buildCsp("n", { ...prod, isDev: true, upgradeInsecure: false });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "script-src")).not.toContain("'unsafe-inline'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("upgrade-insecure-requests: menyala di produksi, hanya dimatikan lewat CSP_UPGRADE_INSECURE_REQUESTS=false (E2E WebKit di http://localhost)", () => {
    expect(buildCsp("n", prod)).toContain("upgrade-insecure-requests");
    expect(cspEnvFromProcess({ NODE_ENV: "production" } as never).upgradeInsecure).toBe(true);
    expect(cspEnvFromProcess({ NODE_ENV: "production", CSP_UPGRADE_INSECURE_REQUESTS: "false" } as never).upgradeInsecure).toBe(false);
    expect(cspEnvFromProcess({ NODE_ENV: "development" } as never).upgradeInsecure).toBe(false);
  });

  it("nonce: 128-bit, unik per panggilan, base64", () => {
    const a = makeNonce();
    const b = makeNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("proxy.ts", () => {
  it("katalog /dev dijawab 404 di produksi (rewrite ke route tak ada) tetapi lolos di development", () => {
    vi.stubEnv("NODE_ENV", "production");
    const hidden = proxy(new NextRequest("http://localhost:3000/dev/components"));
    expect(hidden.headers.get("x-middleware-rewrite")).toContain("/__tidak-ada");
    expect(hidden.headers.get("content-security-policy")).toContain("nonce-");
    vi.stubEnv("NODE_ENV", "development");
    expect(proxy(new NextRequest("http://localhost:3000/dev/components")).headers.get("x-middleware-rewrite")).toBeNull();
    vi.unstubAllEnvs();
  });

  it("setiap request mendapat CSP dengan nonce baru; nonce diteruskan ke render lewat header request", () => {
    const r1 = proxy(new NextRequest("http://localhost:3000/r/ABCDEF"));
    const r2 = proxy(new NextRequest("http://localhost:3000/"));
    const c1 = r1.headers.get("content-security-policy")!;
    const c2 = r2.headers.get("content-security-policy")!;
    const n1 = /'nonce-([^']+)'/.exec(c1)![1];
    const n2 = /'nonce-([^']+)'/.exec(c2)![1];
    expect(n1).not.toBe(n2);
    expect(directive(c1, "script-src")).not.toContain("'unsafe-inline'");
    // Next meneruskan header request yang dimodifikasi lewat x-middleware-request-*.
    expect(r1.headers.get("x-middleware-request-x-nonce")).toBe(n1);
  });
});
