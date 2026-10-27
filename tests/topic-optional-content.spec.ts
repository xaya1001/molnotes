import { expect, test } from "./helpers/test";

test("chapters render when glossary and quiz are omitted", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sites/minimal/start");
  const prose = page.locator("article .prose");
  await expect(prose.locator(":scope > h2")).toHaveCount(1);
  await expect(prose.locator(":scope > p").first()).toBeVisible();
  await expect(prose.locator(":scope > ul > li")).toHaveCount(2);
  expect(errors).toEqual([]);
});
