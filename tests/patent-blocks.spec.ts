import { putRecords } from "./helpers/records.ts";
import { test, expect } from "./helpers/test.ts";
import { readFile } from "node:fs/promises";
const base = "/sites/fable-patent";
const endpoint = "/api/records/topics/fable-patent";
const empty = {
  version: 1,
  complete: [],
  bookmarks: [],
  notes: {},
  answers: {},
  diagnostic: {},
  predictions: {},
  pins: {},
  recordNotes: {},
};

test.beforeEach(async ({ page, request }) => {
  page.on("pageerror", (e) => {
    throw e;
  });
  expect(
    (await putRecords(request, endpoint, { data: empty })).ok(),
  ).toBeTruthy();
});
test("directory, chapter and generated detail paths open", async ({ page }) => {
  for (const [path, title] of [
    ["/start", "虚构记录总览"],
    ["/examples", "全部实施例"],
    ["/claims/1", "Claim 1"],
    ["/claims/compare?ids=1,2", "权利要求并排比较"],
    ["/examples/compare", "实施例并排比较"],
    ["/sar/oxygen", "构效关系案例"],
    ["/synthesis/intermediates/A", "中间体 A"],
    ["/sources", "原文与证据"],
    ["/examples/999", "编号不存在"],
    ["/not-found", "页面不存在"],
  ]) {
    await page.goto(base + path);
    await expect(
      page.getByRole("heading", { level: 1, name: title, exact: true }),
    ).toBeVisible();
  }
});
test("record details show molecules, ranges, source notes, lazy body and navigation", async ({
  page,
  browser,
}) => {
  await page.goto(base + "/examples/1");
  await expect(page.getByText("A · ≤10 单位", { exact: true })).toBeVisible();
  await expect(page.getByText("样品 1 的虚构制备正文。")).toBeVisible();
  await expect(
    page.getByText("另一来源的读数为 B，保留两个读数。"),
  ).toBeVisible();
  await expect(page.locator(".molecule svg").first()).toBeVisible();
  const image = page.getByRole("img", { name: "原文 p.1" });
  await expect(image).toBeVisible();
  await image.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "本条分析笔记" }).fill("核对原图");
  await expect
    .poll(
      async () =>
        (await (await page.request.get(endpoint)).json()).recordNotes[
          "examples/1"
        ],
      { intervals: [100] },
    )
    .toBe("核对原图");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "本条分析笔记" })).toHaveValue(
    "核对原图",
  );
  const ctx = await browser.newContext();
  try {
    const other = await ctx.newPage();
    await other.goto(new URL(base + "/examples/1", page.url()).href);
    await expect(
      other.getByRole("textbox", { name: "本条分析笔记" }),
    ).toHaveValue("核对原图");
  } finally {
    await ctx.close();
  }
  await page.getByRole("link", { name: "下一条", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "实施例 2", exact: true }),
  ).toBeFocused();
});
test("all list filters, ordering, paging and view restore from URL", async ({
  page,
}) => {
  await page.goto(base + "/examples");
  const count = page.locator(".result-count");
  await expect(count).toHaveText("匹配 12 / 12 条");
  await page.getByRole("searchbox", { name: "记录搜索" }).fill("1");
  await expect(count).toHaveText("匹配 1 / 12 条");
  await expect(page).toHaveURL(/q=1/);
  await page.getByRole("button", { name: "清除筛选" }).click();
  await page
    .getByRole("combobox", { name: "读数甲筛选", exact: true })
    .selectOption("A");
  await expect(count).toHaveText("匹配 5 / 12 条");
  await page.reload();
  await expect(count).toHaveText("匹配 5 / 12 条");
  for (const [value, n] of [
    ["unlisted", 1],
    ["blank", 1],
    ["dash", 1],
  ]) {
    await page
      .getByRole("combobox", { name: "读数甲筛选", exact: true })
      .selectOption(String(value));
    await expect(count).toHaveText(`匹配 ${n} / 12 条`);
  }
  await page.getByRole("button", { name: "清除筛选" }).click();
  await page.getByRole("button", { name: "下一页 →" }).click();
  await expect(page).toHaveURL(/page=2/);
  await page.reload();
  await expect(page.getByRole("navigation", { name: "分页" })).toContainText(
    "2 / 2",
  );
  await page
    .getByRole("combobox", { name: "浏览方式", exact: true })
    .selectOption("cards");
  await expect(page).toHaveURL(/view=cards/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "实施例 1", exact: true }),
  ).toBeVisible();
  await page.getByLabel("样品量最小值").fill("40");
  await page.getByLabel("样品量最大值").fill("60");
  await expect(count).toHaveText("匹配 3 / 12 条");
  await page
    .getByRole("combobox", { name: "排序", exact: true })
    .selectOption("amount");
  await page
    .getByRole("combobox", { name: "顺序", exact: true })
    .selectOption("desc");
  await page.reload();
  await expect(page.locator(".cards h3").first()).toHaveText("实施例 6");
});
test("substructure filtering, source grouping and CSV use current results", async ({
  page,
}) => {
  await page.goto(base + "/examples");
  await page.getByLabel("子结构（SMILES 或 SMARTS）").fill("[#8]");
  await page.getByRole("button", { name: "筛选子结构" }).click();
  await expect(page.locator(".result-count")).toHaveText("匹配 7 / 12 条");
  await page
    .getByRole("combobox", { name: "来源", exact: true })
    .selectOption("beta");
  await expect(page.locator(".result-count")).toHaveText("匹配 4 / 12 条");
  await page.reload();
  await expect(page.locator(".result-count")).toHaveText("匹配 4 / 12 条");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "当前筛选 CSV" }).click();
  const file = await download;
  const csv = await readFile((await file.path())!, "utf8");
  expect(csv).toContain('"smiles"');
  expect(csv).toContain('"Oc1ccccc1"');
  expect(csv.split("\r\n")).toHaveLength(5);
  await page.getByLabel("子结构（SMILES 或 SMARTS）").fill("C(");
  await page.getByRole("button", { name: "筛选子结构" }).click();
  await expect(page.getByRole("alert")).toContainText("无法解析");
  await expect(page.locator(".result-count")).toHaveText("匹配 0 / 12 条");
});
test("pins reject a seventh pick, follow pages and group comparison by source", async ({
  page,
}) => {
  await page.goto(base + "/examples/compare?ids=1,2,3,4,5,6");
  await expect(page.locator(".compare-column")).toHaveCount(6);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(endpoint)).json()).pins.examples
          ?.length ?? 0,
      { intervals: [100] },
    )
    .toBe(6);
  await page.goto(base + "/examples/7");
  await page.getByRole("button", { name: "进入并排比较" }).click();
  await expect(page.getByRole("alert")).toContainText("最多 6 条");
  const tray = page.getByRole("complementary", { name: "实施例比较区" });
  await tray.getByRole("button", { name: "移除 6", exact: true }).click();
  await page.getByRole("button", { name: "加入比较", exact: true }).click();
  await tray.getByRole("link", { name: "并排比较 →" }).click();
  await expect(page.locator(".compare-column")).toHaveCount(6);
  await expect(
    page.getByRole("heading", { name: "来源乙", exact: true }),
  ).toBeVisible();
  await expect(tray).toHaveCount(0);
  await page.getByRole("button", { name: "移除 7", exact: true }).click();
  await expect(page.locator(".compare-column")).toHaveCount(5);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(endpoint)).json()).pins.examples.length,
      { intervals: [100] },
    )
    .toBe(5);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await page.route("**" + endpoint, async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const response = await route.fetch();
    entered();
    await gate;
    await route.fulfill({ response });
  });
  await page.reload();
  await expect(page.locator(".compare-column")).toHaveCount(5);
  await pending;
  const input = page.getByRole("textbox", { name: "比较编号", exact: true });
  await input.fill("1,2,3,4,5,6,7");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(endpoint) &&
      response.request().method() === "PUT",
  );
  release();
  await saved;
  await expect(input).toHaveValue("1,2,3,4,5,6,7");
  await page.getByRole("button", { name: "更新比较" }).click();
  await expect(page.getByRole("alert")).toContainText("最多 6 条");
  await expect(page.locator(".compare-column")).toHaveCount(5);
});
test("original page rectangle, zoom, keyboard and paragraph lookup", async ({
  page,
}) => {
  await page.goto(base + "/examples/1");
  await page
    .locator(
      `a[href="${base}/sources/pages/1?source=alpha&rect=40,80,300,240"]`,
    )
    .click();
  await expect(page.locator(".page-highlight")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "原始 PDF 第 1 页" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "放大原页" }).click();
  await expect(page.getByText("125%", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("heading", { name: "PDF 2 / 3", exact: true }),
  ).toBeVisible();
  await page.goto(base + "/sources/pages/900");
  await expect(page).toHaveURL(base + "/sources/pages/3");
  await page.goto(base + "/sources/pages/1?source=beta&rect=119,421,476,842");
  const highlight = page.locator(".page-highlight");
  await expect(highlight).toBeVisible();
  const image = page.getByRole("img", { name: "原始 PDF 第 1 页" });
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalHeight))
    .toBe(842);
  const frame = await image.boundingBox();
  const marked = await highlight.boundingBox();
  expect((marked!.x - frame!.x) / frame!.width).toBeCloseTo(0.2, 2);
  expect((marked!.y - frame!.y) / frame!.height).toBeCloseTo(0.5, 2);
  expect(marked!.width / frame!.width).toBeCloseTo(0.6, 2);
  expect(marked!.height / frame!.height).toBeCloseTo(0.5, 2);
  await page.goto(base + "/sources/pages/1?source=beta&rect=0,0,600,820");
  await expect(
    page.getByRole("heading", { name: "PDF 1 / 3", exact: true }),
  ).toBeVisible();
  await expect(highlight).toHaveCount(0);
  await page.getByRole("searchbox", { name: "原文检索" }).fill("[0005]");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "PDF 2 / 3", exact: true }),
  ).toBeVisible();
  await page.getByRole("searchbox", { name: "原文检索" }).fill("binding");
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await expect(page.locator(".search-hits a")).toContainText("binding");
  const q = '<em>"binding" & test</em>';
  await page.goto(base + "/search?q=" + encodeURIComponent(q));
  await expect(page.locator("main h1")).toHaveText(`“${q}”`);
  await expect(page.locator("main h1 em")).toHaveCount(0);
});
test("claims filter, dependency links, compare and three scope outcomes", async ({
  page,
}) => {
  await page.goto(base + "/claims/1");
  await page.getByRole("searchbox", { name: "权利要求检索" }).fill("2");
  await page
    .getByRole("navigation", { name: "权利要求列表" })
    .getByRole("link", { name: "Claim 2 · 虚构范围 2" })
    .click();
  await page.getByRole("button", { name: "并排查看" }).click();
  await expect(page.locator(".claim-detail")).toHaveCount(2);
  await page.getByLabel("化学模式匹配 SMILES").fill("CCO");
  await page.getByRole("button", { name: "匹配子结构" }).click();
  for (const [index, status] of [
    [0, "matched"],
    [1, "not-matched"],
    [2, "unmodeled"],
  ] as const)
    await expect(page.locator(".verdicts article").nth(index)).toHaveAttribute(
      "data-match-status",
      status,
    );
  await page.getByLabel("化学模式匹配 SMILES").fill("C(");
  await page.getByRole("button", { name: "匹配子结构" }).click();
  await expect(page.getByRole("alert")).toContainText("无法解析");
  await expect(page.locator(".verdicts")).toHaveCount(0);
});
test("SAR pairs and matrix link to the counted records; evidence and conditions stay visible", async ({
  page,
}) => {
  await page.goto(base + "/sar/oxygen");
  await expect(page.locator(".case-card")).toHaveCount(1);
  await expect(page.locator(".case-card .columns article")).toHaveCount(2);
  const cell = page.locator(".matrix a").first();
  const label = await cell.getAttribute("aria-label");
  const count = Number(/：(\d+)/.exec(label!)![1]);
  await cell.click();
  await expect(page.locator(".result-count")).toHaveText(
    `匹配 ${count} / 12 条`,
  );
  await page.goto(base + "/start");
  await expect(page.getByRole("table", { name: "检测条件" })).toContainText(
    "15 °C",
  );
  await expect(page.getByRole("table", { name: "检测条件" })).toContainText(
    "7 单位辅因子",
  );
  const overviewCount = page
    .getByRole("table", { name: "读数甲分档计数" })
    .getByRole("link", { name: "5", exact: true });
  await overviewCount.click();
  await expect(page.locator(".result-count")).toHaveText("匹配 5 / 12 条");
  for (const id of [2, 4]) {
    await page.goto(base + `/examples/${id}`);
    await expect(page.getByText("B · >10 单位", { exact: true })).toBeVisible();
  }
  await page.goto(base + "/sources");
  await expect(
    page.getByText("样品 1 的另一来源读数为 B；两种读数分别保留。"),
  ).toBeVisible();
});
test("server rejects invalid record ids; failed saves preserve notes and retry", async ({
  page,
  request,
}) => {
  expect(
    (
      await putRecords(request, endpoint, {
        data: { ...empty, pins: { examples: [999] } },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await putRecords(request, endpoint, {
        data: { ...empty, recordNotes: { "examples/999": "x" } },
      })
    ).status(),
  ).toBe(400);
  await page.goto(base + "/examples/1");
  await page.route("**" + endpoint, async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({ status: 503, json: { error: "不可用" } });
    else await route.continue();
  });
  await page.getByRole("textbox", { name: "本条分析笔记" }).fill("仍在页面");
  await expect(page.getByRole("alert")).toContainText("未保存");
  await expect(page.getByRole("textbox", { name: "本条分析笔记" })).toHaveValue(
    "仍在页面",
  );
  await page.unroute("**" + endpoint);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "本条分析笔记" })).toHaveValue(
    "仍在页面",
  );
});
test("failed initial records are disclosed and can be retried without overwriting", async ({
  page,
}) => {
  await page.route("**" + endpoint, (route) =>
    route.fulfill({
      status: 200,
      json: { ...empty, recordNotes: { bad: "x" } },
    }),
  );
  await page.goto(base + "/examples/1");
  await expect(page.getByRole("alert")).toContainText("读取失败");
  await expect(page.getByRole("textbox", { name: "本条分析笔记" })).toHaveCount(
    0,
  );
  await page.unroute("**" + endpoint);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "实施例 1", exact: true }),
  ).toBeVisible();
});
test("all patent views fit narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/",
    "/examples",
    "/examples/1",
    "/examples/compare?ids=1,7",
    "/sar",
    "/claims/1",
    "/sources",
    "/sources/pages/1",
  ]) {
    await page.goto(base + path);
    await expect(page.locator("main h1")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  }
  await expect(
    page.getByRole("link", { name: "分子笔记", exact: true }),
  ).toBeVisible();
});

test("global shortcuts jump to records and help restores focus", async ({
  page,
}) => {
  await page.goto(base + "/start");
  const search = page.getByRole("searchbox", { name: "全局检索或编号跳转" });
  await expect(search).toBeVisible();
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await search.fill("Claim 2");
  await search.press("Enter");
  await expect(page).toHaveURL(base + "/claims/2");
  await search.fill("p3");
  await search.press("Enter");
  await expect(page).toHaveURL(/sources\/pages\/3/);
  const help = page.getByRole("button", { name: "导航与快捷键" });
  await help.click();
  await expect(page.getByRole("dialog", { name: "导航与比较" })).toBeVisible();
  await page.getByRole("button", { name: "关闭弹窗" }).click();
  await expect(help).toBeFocused();
});

test("assay filtering and attributed comparison retain measurement and evidence context", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(base + "/examples");
  await page
    .getByRole("combobox", { name: "活性测量测定", exact: true })
    .selectOption("alpha-potency");
  await page
    .getByRole("spinbutton", { name: "活性测量最大值", exact: true })
    .fill("25");
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page
    .locator("td details")
    .last()
    .evaluate((e: HTMLDetailsElement) => (e.open = true));
  await page
    .locator(".table-scroll")
    .first()
    .evaluate((e) => (e.scrollLeft = e.scrollWidth));
  await page.locator("table").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("activity-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".table-scroll")
    .first()
    .evaluate((e) => (e.scrollLeft = e.scrollWidth));
  await page.locator("table").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("activity-mobile.png") });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(base + "/examples/compare?ids=1,2");
  await expect(page.locator(".compare-column")).toHaveCount(2);
  await page
    .locator(".compare-column details")
    .evaluateAll((es) =>
      es.forEach((e) => ((e as HTMLDetailsElement).open = true)),
    );
  await expect(
    page.locator(".compare-column details a").first(),
  ).toHaveAttribute("href", /sources\/pages\/1/);
  const fields = page.getByRole("group", { name: "比较字段", exact: true });
  const boxes = fields.getByRole("checkbox");
  for (let i = 0; i < (await boxes.count()); i++)
    if (
      !["potency", "scaffold"].includes(
        (await boxes.nth(i).getAttribute("value"))!,
      )
    )
      await boxes.nth(i).uncheck();
  await page.locator(".compare-column").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("compare-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".compare-column").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("compare-mobile.png") });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("connected routes compare branches and expose procedure and yield evidence", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(base + "/synthesis/fable?routes=a,b");
  await expect(
    page.locator(".synthesis-network .route-columns > article"),
  ).toHaveCount(2);
  await expect(
    page
      .locator(".synthesis-network .route-columns > article")
      .nth(1)
      .locator("li"),
  ).toHaveCount(3);
  await expect(page.locator(".synthesis-network .callout a")).toHaveAttribute(
    "href",
    base + "/examples/2",
  );
  await expect(page.locator(".route-columns > article").nth(1)).toHaveAttribute(
    "data-step-count",
    "3",
  );
  await expect(page.locator(".route-columns > article").nth(1)).toHaveAttribute(
    "data-longest-path",
    "2",
  );
  await page.screenshot({ path: testInfo.outputPath("routes-desktop.png") });
  await page.locator(".steps li").first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("route-detail-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".steps li").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("routes-mobile.png") });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page
    .getByRole("combobox", { name: "反应策略", exact: true })
    .selectOption("核心构建");
  await expect(
    page.locator(".synthesis-network .route-columns > article"),
  ).toHaveCount(2);
  const picks = page.locator(
    '.synthesis-network fieldset input[type="checkbox"]',
  );
  await picks.nth(0).uncheck();
  await picks.nth(1).uncheck();
  await expect(page.locator(".route-columns > article")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".route-columns > article")).toHaveCount(0);
  await picks.nth(0).check();
  await expect(page.locator(".route-columns > article")).toHaveCount(1);
});
