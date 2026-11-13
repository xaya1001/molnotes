import { expect, test } from "./helpers/test.ts";

test("each worker connects to its assigned test server", async ({
  page,
  baseURL,
}, testInfo) => {
  const ports = process.env.TEST_SERVER_PORTS!.split(",");
  expect(new URL(baseURL!).port).toBe(ports[testInfo.parallelIndex]);
  const response = await page.goto("/");
  expect(response?.ok()).toBe(true);
});
