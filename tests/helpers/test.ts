import { test as base } from "@playwright/test";
export * from "@playwright/test";

// Each worker talks to its own server and records file (see
// playwright.config.ts), so specs in parallel workers never share records.
export const test = base.extend({
  baseURL: async ({ baseURL }, use, testInfo) => {
    const url = new URL(baseURL!);
    url.port = String(Number(url.port) + testInfo.parallelIndex);
    await use(url.href);
  },
});
