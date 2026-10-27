import { test, expect, type Page } from "./helpers/test.ts";

const viewer = (page: Page) => page.getByRole("dialog");
const pageImage = (page: Page, n: number) =>
  viewer(page).getByRole("img", { name: `样本手册，PDF 第 ${n} 页` });

test("a note citation opens its pages with one neighbour each side and the marked region", async ({
  page,
}) => {
  await page.goto("/notes/cited-reading/sources");
  await page
    .getByRole("main")
    .getByRole("button", { name: "PDF 第 2–3 页" })
    .first()
    .click();
  await expect(viewer(page).getByRole("heading", { level: 2 })).toHaveText(
    "样本手册",
  );
  await expect(viewer(page).locator(".cited-meta")).toContainText(
    "PDF 第 2–3 页（印刷页 12–13）",
  );
  await expect(pageImage(page, 2)).toBeVisible();
  const pager = viewer(page).getByRole("navigation", { name: "翻页" });
  const current = viewer(page).locator(".cited-page");
  await expect(current).toContainText("12");
  await expect(current.locator(".cited-flag")).toHaveCount(1);
  const highlight = viewer(page).locator(".page-highlight");
  await expect(highlight).toBeVisible();
  const frame = (await pageImage(page, 2).boundingBox())!;
  const marked = (await highlight.boundingBox())!;
  expect((marked.x - frame.x) / frame.width).toBeCloseTo(72 / 612, 2);
  expect((marked.y - frame.y) / frame.height).toBeCloseTo(300 / 792, 2);
  expect(marked.width / frame.width).toBeCloseTo(468 / 612, 2);

  const previous = pager.getByRole("button", { name: "← 上一页" });
  const next = pager.getByRole("button", { name: "下一页 →" });
  await previous.click();
  await expect(pageImage(page, 1)).toBeVisible();
  await expect(current).toContainText("11");
  await expect(current.locator(".cited-flag")).toHaveCount(0);
  await expect(highlight).toHaveCount(0);
  await expect(previous).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await next.click();
  await expect(pageImage(page, 4)).toBeVisible();
  await expect(next).toBeDisabled();
  await viewer(page).getByRole("button", { name: "关闭原文" }).click();
  await expect(viewer(page)).toBeHidden();
});

test("an archived page citation shows the cleaned article with its original link and date", async ({
  page,
}) => {
  await page.goto("/notes/cited-reading/sources");
  await page.locator("summary", { hasText: "资料来源" }).click();
  await page.getByRole("button", { name: "读一张轨道图" }).click();
  const article = viewer(page).locator("article");
  await expect(article.getByRole("heading", { level: 3 })).toHaveText(
    "样本课程：读一张轨道图",
  );
  await expect(article.locator("sub")).toHaveText("2");
  await expect(
    article.locator("script, iframe, [style], [onclick]"),
  ).toHaveCount(0);
  await expect(article.getByRole("img", { name: "Fig1.png" })).toBeVisible();
  await expect(
    viewer(page).getByRole("link", { name: "原网页" }),
  ).toHaveAttribute("href", "https://example.org/lesson-1");
  await expect(viewer(page)).toContainText("2026-10-01");
  await expect(viewer(page)).not.toContainText("chapter-1.html");
});

test("an epub citation shows its chapter and opens at the cited section", async ({
  page,
}) => {
  await page.goto("/notes/cited-reading/sources");
  await page.locator("summary", { hasText: "资料来源" }).click();
  await page.getByRole("button", { name: "细节一节" }).click();
  await expect(viewer(page).getByRole("heading", { level: 2 })).toHaveText(
    "样本读本",
  );
  await expect(viewer(page).locator(".cited-location")).toContainText(
    "第 2 章 通路",
  );
  const article = viewer(page).locator("article");
  const section = article.locator('[data-section~="2"]');
  await expect(section).toHaveClass(/cited-target/);
  await expect(section).toBeInViewport();
  const chapter = article.getByRole("heading", { level: 3 }).first();
  await expect(chapter).not.toBeInViewport();
  await expect(
    article.locator("script, iframe, [style], [onclick]"),
  ).toHaveCount(0);
  await viewer(page).getByRole("button", { name: "关闭原文" }).click();

  // The chapter citation opens at the top, with the figure and inline images in place.
  await page.getByRole("button", { name: "第 2 章" }).click();
  await expect(chapter).toBeInViewport();
  await expect(article.locator(".cited-target")).toHaveCount(0);
  const figure = article.getByRole("img", { name: "通路示意图" });
  await expect(figure).toBeVisible();
  await expect
    .poll(() => figure.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(480);
  // The step icon stays on the first line of its paragraph.
  const step = (await article.locator("p img").first().boundingBox())!;
  const paragraph = (await article.locator("p").first().boundingBox())!;
  expect(step.y - paragraph.y).toBeLessThan(step.height);
});

test("topic sources, excerpts and reading items open the same viewer", async ({
  page,
}) => {
  await page.goto("/sites/cited-sources/start");
  await page.getByRole("button", { name: "PDF 第 2 页方框" }).click();
  await expect(pageImage(page, 2)).toBeVisible();
  await expect(viewer(page).locator(".page-highlight")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "PDF 第 3–4 页" }).click();
  await expect(pageImage(page, 3)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator("details.note-sources > summary").click();
  await page
    .getByRole("main")
    .getByRole("button", { name: "PDF 第 2–3 页（印刷页 12–13）" })
    .click();
  await expect(pageImage(page, 2)).toBeVisible();
});

test("the viewer zooms on a phone without page-level horizontal scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/notes/cited-reading/sources");
  await page
    .getByRole("main")
    .getByRole("button", { name: "PDF 第 2–3 页" })
    .first()
    .click();
  await expect(pageImage(page, 2)).toBeVisible();
  const width = async () => (await pageImage(page, 2).boundingBox())!.width;
  const before = await width();
  await viewer(page).getByRole("button", { name: "放大原页" }).click();
  await expect(viewer(page).getByText("125%", { exact: true })).toBeVisible();
  await expect.poll(width).toBeCloseTo(before * 1.25, 0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await viewer(page).getByRole("button", { name: "关闭原文" }).click();
  await page.locator("summary", { hasText: "资料来源" }).click();
  await page.getByRole("button", { name: "读一张轨道图" }).click();
  await expect(viewer(page).locator("article img")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
