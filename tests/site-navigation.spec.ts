import { expect, test, type Page } from "./helpers/test";

// Records are served per page, so other specs writing the shared test database never change them.
async function serveRecords(page: Page, records: object) {
  await page.route("**/api/records", (route) =>
    route.fulfill({ json: records }),
  );
}

// Topic pages read and write their records in the browser only; review.spec owns the shared ones.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/records/**", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ json: route.request().postDataJSON() })
      : route.fallback(),
  );
});

const sampleRecord = {
  version: 1,
  complete: ["start"],
  bookmarks: ["next"],
  notes: {},
  answers: { q1: 1 },
  diagnostic: {},
  predictions: {},
  problems: {},
  path: "all",
};

const sections = (page: Page) =>
  page.getByRole("navigation", { name: "栏目" }).getByRole("link");

test("every page shares the top bar and marks its own section", async ({
  page,
}) => {
  for (const [path, current] of [
    ["/", null],
    ["/notes/reader-test/first", "笔记"],
    ["/practice/sample/start", "练习"],
    ["/sites/instruments/", "案例"],
    ["/glossary/", "术语"],
    ["/review/", "复习"],
  ] as const) {
    await page.goto(path);
    await expect(
      page.getByRole("link", { name: "分子笔记", exact: true }),
    ).toHaveAttribute("href", "/");
    await expect(sections(page)).toHaveText([
      "笔记",
      "练习",
      "案例",
      "术语",
      "复习",
    ]);
    const marked = page
      .getByRole("navigation", { name: "栏目" })
      .locator('[aria-current="page"]');
    if (current) await expect(marked).toHaveText(current);
    else await expect(marked).toHaveCount(0);
    await expect(page).toHaveTitle(/ · 分子笔记$|^分子笔记$/);
  }
});

test("on a phone the sections fold into a menu and search keeps its icon", async ({
  page,
}) => {
  await serveRecords(page, { topics: {}, notes: {} });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/practice/sample/");
  await expect(sections(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "全站搜索" })).toBeVisible();
  const trigger = page.locator(".site-menu").getByRole("button");
  await trigger.focus();
  await trigger.press("ArrowDown");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("menu");
  const items = menu.getByRole("menuitem");
  await expect(items).toHaveCount(5);
  await expect(menu).toBeInViewport({ ratio: 1 });
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.setViewportSize({ width: 1366, height: 900 });
  await expect(menu).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await page.mouse.click(10, 150);
  await expect(menu).toBeHidden();
  await trigger.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(2)).toHaveAttribute("href", "/sites/instruments/");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sites\/instruments\/$/);
  for (const path of [
    "/",
    "/notes/reader-test/first",
    "/practice/sample/start",
  ]) {
    await page.goto(path);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  }
});

test("without records the home page offers the first note of each notebook", async ({
  page,
}) => {
  await serveRecords(page, { topics: {}, notes: {} });
  await page.goto("/");
  const start = page.getByRole("region", { name: "从第一篇开始" });
  await expect(start.getByRole("link")).toHaveText([
    "第一篇观察",
    "有出处的观察",
  ]);
  await expect(start.getByRole("link").first()).toHaveAttribute(
    "href",
    "/notes/reader-test/first",
  );
  await expect(page.getByRole("region", { name: "上次读到" })).toHaveCount(0);
});

test("with records the home page resumes the last note and sums progress", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await serveRecords(page, {
    topics: { sample: sampleRecord },
    notes: {
      "/notes/reader-test/first": { opened: 200, read: true },
      "/notes/cited-reading/sources": { opened: 100, read: false },
      "/notes/reader-test/second": { opened: 50, read: false },
    },
  });
  await page.addInitScript(() => {
    localStorage.setItem("notes/scroll:/notes/reader-test/first", "240");
    localStorage.setItem("notes/section:/notes/reader-test/first", "观察");
  });
  await page.goto("/");
  const resume = page.getByRole("region", { name: "上次读到" });
  await expect(
    resume.getByRole("link", { name: "第一篇观察" }),
  ).toHaveAttribute("href", "/notes/reader-test/first");
  await expect(resume).toContainText("观察");
  await expect(
    resume.getByRole("link", { name: /第二篇观察/ }),
  ).toHaveAttribute("href", "/notes/reader-test/second");
  const otherRecent = page.locator(".recent-list a");
  await expect(otherRecent).toHaveCount(2);
  expect(
    await otherRecent.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href")),
    ),
  ).toEqual(["/notes/cited-reading/sources", "/notes/reader-test/second"]);
  const progress = page.getByRole("region", { name: "笔记与练习" });
  const notebook = progress.getByRole("listitem").first();
  await expect(notebook).toContainText("1 / 2");
  await expect(
    notebook.getByRole("link", { name: "实验观察" }),
  ).toHaveAttribute("href", "/practice/sample/");
  await expect(notebook).toContainText("1 / 2 章 · 错题 1");
  await expect(
    page.getByRole("main").getByRole("link", { name: /^复习/ }),
  ).toContainText("错题 1 · 书签 1");
  await resume.getByRole("link", { name: "接着读" }).click();
  await expect(page).toHaveURL(/\/notes\/reader-test\/first$/);
});

test("site search opens on any page and groups notes, chapters and terms", async ({
  page,
}) => {
  await page.goto("/glossary/");
  await page.getByRole("button", { name: "全站搜索" }).click();
  const dialog = page.getByRole("dialog", { name: "搜索" });
  const box = dialog.getByRole("searchbox", { name: "搜索全站" });
  await expect(box).toBeFocused();
  await box.fill("ethanol");
  await expect(
    dialog.getByRole("region", { name: "笔记" }).getByRole("link"),
  ).toHaveAttribute("href", "/notes/reader-test/first?q=ethanol");
  await expect(
    dialog.getByRole("region", { name: "专题章节" }).getByRole("link"),
  ).toHaveAttribute("href", "/practice/sample/start");
  await box.fill("样品");
  await expect(
    dialog.getByRole("region", { name: "术语" }).getByRole("link"),
  ).toHaveAttribute("href", "/glossary/#%E6%A0%B7%E5%93%81");
  // Problem statements stay out of the index so search never reveals a question.
  await box.fill("identical objects");
  await expect(dialog.getByRole("region")).toHaveCount(0);
  await page.goto("/sites/instruments/");
  await page.getByRole("button", { name: "全站搜索" }).click();
  await page.getByRole("searchbox", { name: "搜索全站" }).fill("观察工具");
  await expect(
    page
      .getByRole("dialog", { name: "搜索" })
      .getByRole("region", { name: "专题章节" })
      .getByRole("link"),
  ).toHaveCount(1);
});

test("home and review load without search and fetch it only when opened", async ({
  page,
}) => {
  let searchRequests = 0;
  await page.route("**/api/index", async (route) => {
    searchRequests++;
    await route.fulfill({ status: 503, json: { error: "search unavailable" } });
  });
  for (const path of ["/", "/review/"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(searchRequests).toBe(0);
  }
  await page.getByRole("button", { name: "全站搜索" }).click();
  await expect.poll(() => searchRequests).toBe(1);
  await expect(page.getByRole("dialog")).toBeVisible();
});
