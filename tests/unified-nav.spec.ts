import { test, expect } from "./helpers/test";
import { mkdir } from "node:fs/promises";

const empty = {
  version: 1,
  complete: [],
  bookmarks: [],
  notes: {},
  answers: {},
  diagnostic: {},
  predictions: {},
  problems: {},
};
test("section links resume saved chapters and opening a chapter saves its timestamp", async ({
  page,
}) => {
  const records: Record<string, unknown> = {};
  await page.route("**/api/records", (route) =>
    route.fulfill({ json: { topics: records, notes: {} } }),
  );
  await page.route("**/api/records/topics/*", (route) => {
    const slug = route.request().url().split("/").at(-1)!;
    if (route.request().method() === "PUT")
      records[slug] = route.request().postDataJSON();
    return route.fulfill({
      json: records[slug] ?? empty,
      headers: { etag: '"test"' },
    });
  });
  await page.goto("/");
  const sections = page.locator(".site-sections a");
  await expect(sections.nth(1)).toHaveAttribute("href", "/practice/sample/");
  await expect(sections.nth(2)).toHaveAttribute("href", "/sites/instruments/");
  await page.goto("/practice/sample/next");
  await expect
    .poll(
      () =>
        (records.sample as { recent?: { chapter: string } })?.recent?.chapter,
    )
    .toBe("next");
  await page.goto("/sites/minimal/start");
  await expect
    .poll(
      () =>
        (records.minimal as { recent?: { chapter: string } })?.recent?.chapter,
    )
    .toBe("start");
  await page.goto("/notes/reader-test/first");
  await expect(sections.nth(1)).toHaveAttribute(
    "href",
    "/practice/sample/next",
  );
  await expect(sections.nth(2)).toHaveAttribute("href", "/sites/minimal/start");
});

test("topic home marks chapter states and chapter sources include only referenced entries", async ({
  page,
}) => {
  await page.route("**/api/records/topics/cited-sources", (route) =>
    route.fulfill({
      json: { ...empty, complete: ["start"], bookmarks: ["start"] },
      headers: { etag: '"test"' },
    }),
  );
  await page.route("**/api/topics/cited-sources", async (route) => {
    const topic = await (await route.fetch()).json();
    topic.content.sources.push({
      id: 99,
      title: "Unused",
      kind: "test",
      note: "unused",
    });
    topic.content.sourcesIntro = {
      title: "Scope",
      paragraphs: ["Model limits"],
    };
    await route.fulfill({ json: topic });
  });
  await page.goto("/sites/cited-sources/");
  const chapter = page.locator(
    'article nav a[href="/sites/cited-sources/start"]',
  );
  await expect(chapter.locator('[data-state="read"]')).toHaveCount(1);
  await expect(chapter.locator('[data-state="bookmarked"]')).toHaveCount(1);
  await expect(page.locator("article .prose > p")).toHaveCount(1);
  await chapter.click();
  const sources = page.locator("details.note-sources");
  await expect(sources).not.toHaveAttribute("open");
  await sources.locator("summary").click();
  await expect(sources.locator("section")).toHaveCount(1);
  await expect(sources.getByRole("button")).toHaveCount(2);
});

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`navigation layouts at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const directory = process.env.MOLNOTES_NAV_SCREENSHOTS;
    if (directory) await mkdir(directory, { recursive: true });
    async function capture(name: string) {
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(viewport.width);
      if (directory)
        await page.screenshot({
          path: `${directory}/${viewport.width}-${name}.png`,
        });
    }
    for (const [name, path] of [
      ["notes", "/notes/reader-test/first"],
      ["practice", "/practice/sample/start"],
      ["case", "/sites/cited-sources/start"],
      ["home", "/sites/cited-sources/"],
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await capture(name);
      if (viewport.width === 390) {
        await page
          .locator(
            name === "notes"
              ? '.notes-subbar button[aria-haspopup="dialog"]'
              : '.topic-topbar button[aria-haspopup="dialog"]',
          )
          .click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page
          .getByRole("dialog")
          .evaluate((el) =>
            Promise.all(
              el.getAnimations().map((animation) => animation.finished),
            ),
          );
        await capture(`${name}-drawer`);
      }
      const shelf = page.locator(".sidebar-shelf");
      await expect(shelf.locator(".shelf-book")).toHaveCount(1);
      const toggle = shelf.getByRole("button");
      if (await toggle.count()) {
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await capture(`${name}-shelf`);
      }
    }
  });
}

test("topic navigation loads the index only when expanding a multi-topic practice shelf", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (request) =>
    requested.push(new URL(request.url()).pathname),
  );
  for (const path of ["/sites/minimal/start", "/practice/sample/start"]) {
    await page.goto(path);
    await expect(page.locator("article")).toBeVisible();
    const toggle = page.locator(".sidebar-shelf").getByRole("button");
    if (await toggle.count()) await toggle.click();
    await page.waitForLoadState("networkidle");
    expect(requested).not.toContain("/api/index");
  }
  await page.route("**/api/catalog", async (route) => {
    const catalog = await (await route.fetch()).json();
    catalog.sites.find(
      (site: { slug: string }) => site.slug === "minimal",
    ).group = "练习";
    await route.fulfill({ json: catalog });
  });
  await page.reload();
  const toggle = page.locator(".sidebar-shelf").getByRole("button");
  await expect(toggle).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(requested).not.toContain("/api/index");
  const loaded = page.waitForResponse("**/api/index");
  await toggle.click();
  await loaded;
  await expect(page.locator(".shelf-book")).toHaveCount(2);
});

test("chapter source anchors expand sources on entry and within the chapter", async ({
  page,
}) => {
  await page.route("**/api/topics/cited-sources", async (route) => {
    const topic = await (await route.fetch()).json();
    topic.content.chapters[0].blocks.unshift({
      type: "callout",
      text: "Reference",
      link: { to: "/sites/cited-sources/start#source-1", text: "Source" },
    });
    await route.fulfill({ json: topic });
  });
  await page.goto("/sites/cited-sources/start#source-1");
  const sources = page.locator("details.note-sources");
  const target = sources.locator("#source-1");
  await expect(sources).toHaveAttribute("open");
  await expect(target).toBeInViewport();
  await page.goto("/sites/cited-sources/");
  await page
    .locator('article nav a[href="/sites/cited-sources/start"]')
    .click();
  await expect(sources).not.toHaveAttribute("open");
  await page
    .locator('article a[href="/sites/cited-sources/start#source-1"]')
    .click();
  await expect(sources).toHaveAttribute("open");
  await expect(target).toBeInViewport();
});
