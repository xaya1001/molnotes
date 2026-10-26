import { expect, test } from "@playwright/test";

test("a topic term opens the site definition", async ({ page }) => {
  await page.goto("/practice/sample/start");
  await page.getByRole("button", { name: "术语：样品" }).click();
  const card = page.getByRole("dialog", { name: "样品" });
  await expect(card.getByText("供观察的对象。", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/practice\/sample\/start$/);
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(page.getByRole("button", { name: "术语：样品" })).toBeFocused();
});

test("the site glossary lists every use and search and term cards lead to the entry", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "全站搜索" }).click();
  await page.getByRole("searchbox", { name: "搜索全站" }).fill("样品");
  const result = page.getByRole("link", { name: "样品 · sample" });
  await expect(result).toHaveAttribute("href", "/glossary/#%E6%A0%B7%E5%93%81");
  await result.click();

  const entry = page.locator("section.entry", {
    has: page.getByRole("heading", { name: "样品 · sample" }),
  });
  await expect(entry).toBeInViewport();
  const uses = entry.getByRole("list").getByRole("link");
  await expect(uses).toHaveCount(2);
  await expect(uses.nth(0)).toHaveAttribute("href", "/notes/reader-test/first");
  await expect(uses.nth(1)).toHaveAttribute("href", "/practice/sample/start");

  await uses.nth(0).click();
  await page.getByRole("button", { name: "术语：样品" }).click();
  await page.getByRole("dialog", { name: "样品" }).getByRole("link").click();
  await expect(page).toHaveURL(/\/glossary\/#%E6%A0%B7%E5%93%81$/);
});
