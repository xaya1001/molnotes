import { test, expect } from "./helpers/test.ts";
const screens =
  process.env.MOLNOTES_SCHEME_SCREENSHOTS ??
  "test-results/reaction-scheme-screens";

test("substrate scopes expose the complete scheme and expandable row product", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/sites/minimal/schemes");
  const scope = page.locator(".substrate-scope");
  await expect(scope.locator("tbody tr")).toHaveCount(3);
  await expect(
    scope.locator("svg.structure text").filter({ hasText: "R¹" }),
  ).toHaveCount(2);
  await scope.locator("summary").nth(1).click();
  await expect(scope.locator("details[open] svg.structure")).toHaveCount(1);
  await scope.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screens}/scope-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await scope.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${screens}/scope-phone.png` });
});
