// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkRealtimeUrl } from "../deploy-check";

const prod = { VERCEL_ENV: "production" };

describe("checkRealtimeUrl", () => {
  it("origin https sah → ok", () => {
    expect(checkRealtimeUrl({ ...prod, NEXT_PUBLIC_REALTIME_URL: "https://rt.longroll.id" }).level).toBe("ok");
  });

  it("Vercel production: placeholder .invalid, kosong, localhost, http, path → build gagal (error)", () => {
    for (const v of ["https://realtime.longroll.invalid", "", "http://localhost:4000", "http://rt.longroll.id", "https://rt.longroll.id/api", "bukan url"]) {
      expect(checkRealtimeUrl({ ...prod, NEXT_PUBLIC_REALTIME_URL: v }).level, v).toBe("error");
    }
    expect(checkRealtimeUrl({ ...prod }).level).toBe("error");
  });

  it("di luar Vercel production (preview/lokal) hanya peringatan, tidak mematikan build", () => {
    expect(checkRealtimeUrl({ VERCEL_ENV: "preview", NEXT_PUBLIC_REALTIME_URL: "https://realtime.longroll.invalid" }).level).toBe("warn");
    expect(checkRealtimeUrl({ NEXT_PUBLIC_REALTIME_URL: "http://localhost:4000" }).level).toBe("warn");
  });
});
