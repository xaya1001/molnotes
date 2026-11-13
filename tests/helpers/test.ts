import { test as base } from "@playwright/test";
export * from "@playwright/test";

// Each worker talks to its own server and records file.
export const test = base.extend({
  baseURL: async ({}, use, testInfo) => {
    const port =
      process.env.TEST_SERVER_PORTS!.split(",")[testInfo.parallelIndex];
    await use(`http://127.0.0.1:${port}/`);
  },
});
