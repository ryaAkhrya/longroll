import { defineConfig } from "@playwright/test";

/**
 * P10-A: E2E terhadap BUILD PRODUKSI web (`next start`, CSP nonce nyata, tanpa 'unsafe-eval') + service realtime.
 * Default: store & storage memori/lokal (hermetik, tanpa menyentuh Neon). `P10_NEON=1` memakai DATABASE_URL dari
 * apps/realtime/.env (Neon development, role longroll_app) — dipakai hanya untuk satu alur terkontrol.
 * Kamera = perangkat PALSU Chromium (`--use-fake-device-for-media-stream`), bukan perangkat nyata.
 * Prasyarat: `NEXT_PUBLIC_REALTIME_URL=http://localhost:4000 npm run build -w @longroll/web`.
 * Jalankan: npx playwright test -c playwright.p10.config.ts
 */
const CHROMIUM_LAUNCH = { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] };
const neon = process.env.P10_NEON === "1";

export default defineConfig({
  // P10_LEGACY=1: jalankan spec P01–P05 yang sudah ada (e2e/*.spec.ts) terhadap build produksi yang sama.
  testDir: process.env.P10_LEGACY === "1" ? "./e2e" : "./e2e/p10",
  testIgnore: process.env.P10_LEGACY === "1" ? "**/p10/**" : undefined,
  timeout: 240_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results/p10",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "chromium-desktop", use: { channel: "chrome", launchOptions: CHROMIUM_LAUNCH, viewport: { width: 1366, height: 860 } } },
    { name: "chromium-mobile", use: { channel: "chrome", launchOptions: CHROMIUM_LAUNCH, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    // Lintas browser (DEC-050): tanpa channel Chrome. Firefox memakai kamera palsu; WebKit (Windows) tidak punya kamera palsu → jalur "tanpa kamera".
    {
      name: "firefox-desktop",
      testMatch: ["**/landing.spec.ts", "**/security.spec.ts", "**/crossbrowser.spec.ts", "**/fullflow.spec.ts"],
      use: {
        browserName: "firefox",
        viewport: { width: 1366, height: 860 },
        launchOptions: { firefoxUserPrefs: { "media.navigator.streams.fake": true, "media.navigator.permission.disabled": true } },
      },
    },
    {
      name: "webkit-desktop",
      testMatch: ["**/landing.spec.ts", "**/security.spec.ts", "**/crossbrowser.spec.ts"],
      use: { browserName: "webkit", viewport: { width: 1366, height: 860 }, launchOptions: {} },
    },
  ],
  webServer: [
    // P10_SELF_REALTIME=1: spec restart mengelola proses realtime sendiri (kill/start) → hanya web yang dijalankan Playwright.
    ...(process.env.P10_SELF_REALTIME === "1" ? [] : [{
      command: "npm run start -w @longroll/realtime",
      cwd: "../..",
      url: "http://localhost:4000/api/health",
      reuseExistingServer: false,
      stdout: "pipe" as const,
      env: {
        PORT: "4000",
        ALLOWED_ORIGINS: "http://localhost:3000",
        ROOM_GRACE_PERIOD_SECONDS: "6",
        PARTICIPANT_HOLD_SECONDS: "4",
        RATE_LIMIT_SALT: `p10-${Date.now()}`,
        ...(neon ? {} : { DATABASE_URL: "" }),
        // WebKit menolak cookie Secure di http://localhost (Chrome/Firefox menerima); produksi memakai HTTPS. Hanya run WebKit.
        ...(process.env.P10_WEBKIT === "1" ? { COOKIE_SECURE: "false" } : {}),
      },
    }]),
    {
      command: "npm run start -w @longroll/web",
      cwd: "../..",
      url: "http://localhost:3000",
      reuseExistingServer: false,
      // WebKit meng-upgrade subresource http://localhost ke https (SSL error) akibat upgrade-insecure-requests; hanya run WebKit yang mematikannya.
      env: { NEXT_PUBLIC_REALTIME_URL: "http://localhost:4000", ...(process.env.P10_WEBKIT === "1" ? { CSP_UPGRADE_INSECURE_REQUESTS: "false" } : {}) },
    },
  ],
});
