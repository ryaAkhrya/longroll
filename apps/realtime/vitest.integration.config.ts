import { defineConfig } from "vitest/config";

/** Tes integrasi: server HTTP+WS sungguhan di port acak (store memori). Tes PostgreSQL hanya jalan bila LONGROLL_TEST_DATABASE_URL diset manual. */
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    environment: "node",
    env: { NODE_ENV: "test" },
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
