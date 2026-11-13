import { availableParallelism } from "node:os";
import { defineConfig } from "@playwright/test";

// Each worker gets its own server and records file.
const workers = process.env.CI ? availableParallelism() : 2;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  workers,
  retries: process.env.CI ? 1 : 0,
  use: { screenshot: "only-on-failure" },
  webServer: {
    command: `node tests/helpers/serve-content.ts ${workers}`,
    wait: { stdout: /Test server ports: (?<test_server_ports>[\d,]+)/ },
    gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
  },
});
