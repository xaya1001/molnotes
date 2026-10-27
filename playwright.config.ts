import { createHash } from "node:crypto";
import { availableParallelism } from "node:os";
import { defineConfig } from "@playwright/test";

// The test server listens on one port per worker, starting at `port`
// (tests/helpers/test.ts adds the worker's index). CI runs alone on its
// runner, so it uses every core and a fixed port. Locally the host lock
// allows one browser run at a time, so it keeps two workers; each checkout
// derives its ports from its path, so parallel task worktrees (and a preview
// left running in one of them) never contend for the same ports.
const workers = process.env.CI ? availableParallelism() : 2;
export const ciPort = 43873;
export function localPort(checkout: string) {
  const digest = createHash("sha256").update(checkout).digest();
  return 43880 + (digest.readUInt16BE(0) % 1000) * workers;
}
const port = process.env.CI ? ciPort : localPort(process.cwd());

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  workers,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://127.0.0.1:${port}`, screenshot: "only-on-failure" },
  webServer: {
    command: `node tests/helpers/serve-content.ts ${port} ${workers}`,
    url: `http://127.0.0.1:${port + workers - 1}/`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
  },
});
