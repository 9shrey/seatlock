import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgres://seatlock:seatlock@localhost:55440/seatlock_test",
      JWT_SECRET: "test-secret",
    },
    // All files share one database, so run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
