import { defineConfig } from "@playwright/test";

/**
 * E2E IC-1 (P02 §16): web + realtime lokal, store memori (tanpa database), grace/hold dipersingkat.
 * Memakai Chrome terpasang (channel "chrome"), bukan browser unduhan Playwright.
 * Jalankan: npm run test:e2e -w @longroll/web
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    trace: "retain-on-failure",
    // Kamera PALSU Chromium (pola uji bergerak), bukan perangkat nyata. Mikrofon tidak pernah diminta.
    launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
  },
  webServer: [
    {
      command: "npm run dev -w @longroll/realtime",
      cwd: "../..",
      url: "http://localhost:4000/api/health",
      reuseExistingServer: false,
      stdout: "pipe",
      env: {
        PORT: "4000",
        ALLOWED_ORIGINS: "http://localhost:3000",
        ROOM_GRACE_PERIOD_SECONDS: "6",
        PARTICIPANT_HOLD_SECONDS: "4",
        // Salt unik per run: counter rate limit kini persisten (PostgreSQL); batasnya sendiri tidak diubah.
        RATE_LIMIT_SALT: `e2e-${Date.now()}`,
      },
    },
    {
      command: "npm run dev -w @longroll/web",
      cwd: "../..",
      url: "http://localhost:3000",
      reuseExistingServer: false,
      env: { NEXT_PUBLIC_REALTIME_URL: "http://localhost:4000" },
    },
  ],
});
