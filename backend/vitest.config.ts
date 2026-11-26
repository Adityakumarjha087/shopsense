import { defineConfig } from "vitest/config";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://shopsense:shopsense@localhost:20610/shopsense_test";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DB,
      LOG_LEVEL: "silent",
      LLM_PROVIDER: "fake",
      STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
      INTERNAL_API_KEY: "test-internal-key-123456",
      REDIS_URL: "",
      MEILI_HOST: "",
      STRIPE_SECRET_KEY: "",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/scripts/**", "src/seed/catalog-data.ts"],
      reporter: ["text-summary", "text", "lcov"],
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 60 },
    },
  },
});
