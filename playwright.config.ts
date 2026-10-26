import { createHash } from "node:crypto";
import { defineConfig } from "@playwright/test";

// CI skips the host lock, so it keeps a fixed port that never collides with a
// local run. Each local checkout derives its own port from its path, so
// parallel task worktrees (and a preview left running in one of them) never
// contend for the same port.
export const ciPort = 43873;
export function localPort(checkout: string) {
  const digest = createHash("sha256").update(checkout).digest();
  return 43874 + (digest.readUInt16BE(0) % 1000);
}
const port = process.env.CI ? ciPort : localPort(process.cwd());

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  reporter: [["list"], ["json", { outputFile: "test-results/results.json" }]],
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://127.0.0.1:${port}`, screenshot: "only-on-failure" },
  webServer: {
    command: `node tests/helpers/serve-content.mjs ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 10000 },
  },
});
