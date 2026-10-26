import { expect, test, type Page } from "@playwright/test";

const toc = (page: Page) => page.getByRole("navigation", { name: "专题目录" });
const current = (page: Page) => toc(page).locator('[aria-current="page"]');

test("topic sections stay visible across navigation and reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/showcase/elements");
  const sections = toc(page).locator(".sidebar-group");
  await expect(sections.getByRole("heading")).toHaveCount(2);
  await expect(toc(page).getByRole("link")).toHaveCount(11);
  await expect(toc(page).getByRole("button")).toHaveCount(0);
  await toc(page).locator('a[href="/showcase/steps"]').click();
  await expect(current(page)).toHaveAttribute("href", "/showcase/steps");
  await page.reload();
  await expect(toc(page).getByRole("link")).toHaveCount(11);
});

test("the current entry is scrolled into view, and the sidebar folds into a rail that is remembered", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.goto("/showcase/video");
  await expect(current(page)).toHaveAttribute("href", "/showcase/video");
  await expect(current(page)).toBeInViewport({ ratio: 1 });

  const main = page.locator("#topic-main");
  const width = (await main.boundingBox())!.width;
  await page.getByRole("button", { name: "收起目录" }).click();
  await expect(toc(page)).toBeHidden();
  await expect
    .poll(async () => (await main.boundingBox())!.width)
    .toBeGreaterThan(width);
  await page.reload();
  await expect(toc(page)).toBeHidden();
  await page.getByRole("button", { name: "展开目录" }).click();
  await expect(current(page)).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "收起目录" })).toBeFocused();
});

test("the filter narrows entries as the reader types, Escape clears it, and arrows and Enter open an entry", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/showcase/elements");
  const filter = page.getByRole("searchbox", { name: "筛选章节" });
  const links = toc(page).getByRole("link");
  await expect(links).toHaveCount(11);
  await filter.fill("曲线");
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute("href", "/showcase/curves");
  await filter.press("Escape");
  await expect(filter).toHaveValue("");
  await expect(links).toHaveCount(11);

  await filter.press("ArrowDown");
  await expect(links.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(links.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/showcase\/$/);

  await filter.fill("蛋白");
  await filter.press("Enter");
  await expect(page).toHaveURL(/\/showcase\/protein$/);
});

test("on a phone the 目录 button opens a bottom sheet at the current entry that closes on choice, outside tap, swipe and Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 520 });
  await page.goto("/showcase/video");
  await expect(toc(page)).toBeHidden();
  const button = page.getByRole("button", { name: "目录", exact: true });
  const sheet = page.getByRole("dialog", { name: "专题目录" });

  await button.click();
  await expect(sheet).toBeVisible();
  await expect(current(page)).toBeFocused();
  await expect(current(page)).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(button).toBeFocused();

  await button.click();
  await sheet.evaluate((element) =>
    Promise.all(element.getAnimations().map((motion) => motion.finished)),
  );
  await page.mouse.click(195, 20);
  await expect(sheet).toBeHidden();

  await button.click();
  await sheet.evaluate((element) =>
    Promise.all(element.getAnimations().map((motion) => motion.finished)),
  );
  const handle = (await sheet.locator(".sheet-handle").boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 160, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(sheet).toBeHidden();

  await button.click();
  await sheet.getByRole("link", { name: /概览/ }).click();
  await expect(sheet).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 1, name: "工具箱示例" }),
  ).toBeFocused();
});

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`topic shelf shares group progress and navigates between applications at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const record = {
      version: 1,
      complete: ["start", "start", "retired"],
      bookmarks: [],
      notes: {},
      answers: {},
      diagnostic: {},
      predictions: {},
      problems: {},
      path: "all",
    };
    await page.route("**/api/records", (route) =>
      route.fulfill({ json: { topics: { sample: record }, notes: {} } }),
    );
    await page.route("**/api/records/topics/sample", (route) =>
      route.fulfill({
        json:
          route.request().method() === "PUT"
            ? route.request().postDataJSON()
            : { ...record, complete: ["start"] },
      }),
    );
    await page.goto("/practice/sample/start");
    const open = async () => {
      if (viewport.width < 960)
        await page
          .locator('.topic-topbar button[aria-haspopup="dialog"]')
          .click();
    };
    await open();
    const shelf = page.getByRole("navigation", { name: "专题书架" });
    await expect(shelf.locator(".shelf-book")).toHaveCount(1);
    await expect(
      shelf.locator('[aria-current="true"] .shelf-progress'),
    ).toHaveText("1/2 · 错 0");
    if (viewport.width < 960) await page.keyboard.press("Escape");
    const read = page
      .getByRole("region", { name: "本章记录" })
      .getByRole("button")
      .first();
    await expect(read).toHaveAttribute("aria-pressed", "true");
    await read.click();
    await open();
    await expect(
      shelf.locator('[aria-current="true"] .shelf-progress'),
    ).toHaveText("0/2 · 错 0");
    if (viewport.width < 960) await page.keyboard.press("Escape");
    await read.click();
    await open();
    await page.goto("/sites/minimal/start");
    await open();
    await expect(shelf.locator(".shelf-book")).toHaveCount(1);
    await shelf.getByRole("button").click();
    await expect(shelf.locator(".shelf-book")).toHaveCount(4);
    await expect(shelf.getByRole("heading")).toHaveCount(3);
    await shelf.locator('a[href="/sites/instruments/"]').click();
    await expect(page).toHaveURL(/\/sites\/instruments\/$/);
    await open();
    await expect(shelf.locator('[aria-current="true"]')).toHaveAttribute(
      "href",
      "/sites/instruments/",
    );
    await expect(shelf.locator(".shelf-book")).toHaveCount(1);
  });
}

test("an expanded phone shelf uses at most half the drawer and scrolls separately", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/catalog", async (route) => {
    const catalog = await (await route.fetch()).json();
    const sample = catalog.sites.find(
      (site: { slug: string }) => site.slug === "sample",
    );
    catalog.sites = [
      sample,
      ...Array.from({ length: 19 }, (_, i) => ({
        ...sample,
        slug: `shelf-${i}`,
        title: `专题 ${i}`,
      })),
    ];
    await route.fulfill({ json: catalog });
  });
  await page.goto("/practice/sample/start");
  await page.locator('.topic-topbar button[aria-haspopup="dialog"]').click();
  const sheet = page.getByRole("dialog", { name: "专题目录" });
  await sheet.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );
  const shelf = sheet.locator(".section-sidebar-shelf");
  await expect(shelf.locator(".shelf-book")).toHaveCount(1);
  const toggle = shelf.getByRole("button");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const contentId = await toggle.getAttribute("aria-controls");
  await expect(shelf.locator(`[id="${contentId}"]`)).toBeVisible();
  await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(shelf.locator(".shelf-book")).toHaveCount(1);
  await expect(toggle).toBeFocused();
  await toggle.press("Enter");
  await expect(shelf.locator(".shelf-book")).toHaveCount(20);
  expect((await shelf.boundingBox())!.height).toBeLessThanOrEqual(
    (await sheet.boundingBox())!.height / 2,
  );
  const entries = sheet.locator(".section-sidebar-scroll");
  const before = await entries.boundingBox();
  const list = shelf.locator(".shelf-list");
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await entries.boundingBox()).toEqual(before);
  await expect(shelf.locator(".shelf-book").last()).toBeInViewport({
    ratio: 1,
  });
  await page.keyboard.press("Escape");
  await page.locator('.topic-topbar button[aria-haspopup="dialog"]').click();
  await expect(shelf.locator(".shelf-book")).toHaveCount(1);
});
