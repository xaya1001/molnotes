import { test, expect, type Locator, type Page } from "./helpers/test.ts";
// Evidence capture is optional; all scrolling and layout/interaction assertions
// below run in both modes. Failures are captured by Playwright independently.
async function captureEvidence(page: Page, path: string) {
  if (process.env.MOLNOTES_CAPTURE_EVIDENCE === "1")
    await page.screenshot({ path });
}

test("shared data, matrix, spectrum, tabs and structure blocks render database content", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/sites/instruments/instruments");
  await expect(
    page.getByRole("heading", { name: "观察工具", exact: true }),
  ).toBeVisible();
  const tabs = page.getByRole("tablist").getByRole("tab");
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  // The selected tab is told apart from the others at a glance.
  const look = (index: number) =>
    tabs.nth(index).evaluate((tab) => getComputedStyle(tab).backgroundColor);
  expect(await look(0)).not.toBe(await look(1));
  await tabs.nth(0).focus();
  for (const [key, index] of [
    ["ArrowRight", 1],
    ["ArrowLeft", 0],
    ["End", 1],
    ["Home", 0],
  ] as const) {
    await page.keyboard.press(key);
    const selected = tabs.nth(index);
    await expect(selected).toBeFocused();
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await expect(selected).toHaveAttribute("tabindex", "0");
    await expect(tabs.nth(1 - index)).toHaveAttribute("tabindex", "-1");
    const panel = page.getByRole("tabpanel");
    await expect(panel).toHaveCount(1);
    await expect(panel).toHaveAttribute(
      "id",
      (await selected.getAttribute("aria-controls"))!,
    );
    await expect(panel).toHaveAttribute(
      "aria-labelledby",
      (await selected.getAttribute("id"))!,
    );
  }
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("tabpanel")).toBeFocused();
  await expect(page.getByText("演示峰表", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "三维结构", exact: true }),
  ).toContainText("合成测试坐标");
  await page.getByRole("button", { name: "加载三维结构", exact: true }).click();
  await expect(
    page.locator('[aria-label="1ABC 三维结构，可拖动旋转"] canvas'),
  ).toBeVisible();
  const pk = page.getByRole("region", { name: "预设消除模型", exact: true });
  const atp = page.getByRole("region", { name: "竞争参数", exact: true });
  await pk.getByRole("combobox").first().selectOption("2");
  await expect(pk.locator("dd")).toHaveText("长时样本 [C]");
  await expect(atp.getByRole("combobox")).toHaveValue("compound-x");
  await atp.getByRole("combobox").selectOption("compound-y");
  await expect(pk.getByRole("combobox").first()).toHaveValue("2");
  const ids = await page
    .locator("[id]")
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  expect(errors).toEqual([]);
});
test("unknown topic and missing resource are distinct errors", async ({
  request,
}) => {
  expect((await request.get("/sites/no-such-topic/")).status()).toBe(404);
  expect((await request.get("/sites/sample/static/missing.svg")).status()).toBe(
    404,
  );
});

test("tabs select an explicit default without changing item order", async ({
  page,
}) => {
  await page.route("**/api/topics/instruments", async (route) => {
    const response = await route.fetch();
    const content = await response.json();
    for (const chapter of content.content.chapters) {
      for (const block of chapter.blocks) {
        if (block.type === "tabs") block.default = block.items[1].id;
      }
    }
    await route.fulfill({ response, json: content });
  });
  await page.goto("/sites/instruments/tabs");
  const tabs = page.getByRole("tablist").getByRole("tab");
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "false");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await tabs.nth(0).click();
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
});

test("dataset-driven labs use published options, defaults and reset", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/sites/instruments/datasets");
  const pk = page.getByRole("region", { name: "预设消除模型", exact: true });
  const select = pk.getByRole("combobox").first();
  await expect(select.locator("option")).toHaveCount(3);
  await expect(select).toHaveValue("1");
  await select.selectOption("2");
  await expect(pk.locator("dd")).toHaveText("长时样本 [C]");
  await pk.getByRole("button").click();
  await expect(select).toHaveValue("1");
  await expect(pk.locator("dd")).toHaveText("中时样本 [B]");
  const panel = page.getByRole("region", { name: "多终点比较", exact: true });
  const endpoint = panel.getByRole("combobox");
  await expect(endpoint).toHaveValue("signal");
  await expect(endpoint.locator("option")).toHaveCount(2);
  await expect(
    panel.locator("tbody tr").first().locator("td").last(),
  ).toHaveText("3.00");
  await endpoint.selectOption("growth");
  await expect(
    panel.locator("tbody tr").first().locator("td").last(),
  ).toHaveText("5.00");
  await panel.getByRole("button").click();
  await expect(endpoint).toHaveValue("signal");
  await expect(
    panel.locator("tbody tr").first().locator("td").last(),
  ).toHaveText("3.00");
  await expect(pk.getByRole("alert")).toHaveCount(0);
  await expect(panel.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`long lab readouts remain readable at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/sites/instruments/readouts");
    const lab = page.getByRole("region", { name: "路线核算", exact: true });
    await expect(lab.locator("dt")).toHaveCount(2);
    await expect(lab.locator("dd")).toHaveCount(2);
    await expect(lab.getByRole("spinbutton")).toHaveValue("100");
    await lab.getByRole("spinbutton").fill("50");
    await expect(
      lab.locator("tbody tr").nth(2).locator("td").nth(2),
    ).toHaveText("20.0%");
    const readouts = lab.locator("dl");
    await readouts.scrollIntoViewIfNeeded();
    await captureEvidence(page, testInfo.outputPath("readouts.png"));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    const boxes = await readouts.evaluate((dl) => {
      const boundary = dl.getBoundingClientRect();
      return [...dl.children].map((child) => {
        const box = child.getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          start: boundary.left,
          end: boundary.right,
          overflow: child.scrollWidth > child.clientWidth + 1,
        };
      });
    });
    for (const box of boxes) {
      expect(box.left).toBeGreaterThanOrEqual(box.start - 1);
      expect(box.right).toBeLessThanOrEqual(box.end + 1);
      expect(box.overflow).toBe(false);
    }
    for (let i = 0; i < boxes.length; i += 2) {
      if (viewport.width < 640)
        expect(boxes[i + 1].top).toBeGreaterThanOrEqual(boxes[i].bottom);
      else expect(boxes[i + 1].left).toBeGreaterThanOrEqual(boxes[i].right);
    }
  });
}

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`ATP datasets drive controls and comparisons at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto("/sites/instruments/atp");
    const atp = page.getByRole("region", { name: "竞争参数", exact: true });
    const select = atp.getByRole("combobox");
    const step = atp.getByRole("slider");
    await expect(select.locator("option")).toHaveCount(2);
    await expect(select).toHaveValue("compound-x");
    await expect(step).toHaveValue("1");
    const rows = atp.locator("table").first().locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(2).locator("td").nth(3)).toHaveText("18.0");
    await select.selectOption("compound-y");
    await expect(rows.nth(2).locator("td").nth(3)).toHaveText("3.00");
    await step.fill("2");
    await expect(rows.nth(2).locator("td").nth(3)).toHaveText("201");
    await atp.getByRole("button").click();
    await expect(select).toHaveValue("compound-x");
    await expect(step).toHaveValue("1");
    await atp.evaluate((el) =>
      window.scrollBy(0, el.getBoundingClientRect().top - 120),
    );
    await captureEvidence(page, testInfo.outputPath("atp-controls.png"));
    await atp.locator("table").last().scrollIntoViewIfNeeded();
    await captureEvidence(page, testInfo.outputPath("atp-comparison.png"));
    const drug = page.getByRole("region", { name: "竞争浓度", exact: true });
    await expect(drug.getByRole("slider")).toHaveValue("3");
    await drug.getByRole("slider").fill("1");
    await expect(
      drug.locator("tbody tr").nth(2).locator("td").last(),
    ).toHaveText("18.0");
    await expect(drug.locator('[role="status"]')).toContainText("6.0");
    await drug.evaluate((el) =>
      window.scrollBy(0, el.getBoundingClientRect().top - 120),
    );
    await captureEvidence(page, testInfo.outputPath("drug-comparison.png"));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    await expect(atp.getByRole("alert")).toHaveCount(0);
    await expect(drug.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`correlation metadata preserves cohorts and table interaction at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto("/sites/instruments/correlation");
    const lab = page.getByRole("region", { name: "相关性读数", exact: true });
    const inputs = lab.getByRole("combobox");
    await expect(inputs).toHaveCount(3);
    await expect(inputs.nth(0).locator("option")).toHaveCount(4);
    await expect(inputs.nth(0)).toHaveValue("alpha");
    await expect(inputs.nth(1)).toHaveValue("beta");
    await expect(inputs.nth(2)).toHaveValue("yes");
    const result = lab.locator('[role="status"]');
    await expect(result).toContainText("1.00（n = 3）");
    await inputs.nth(2).selectOption("no");
    await expect(result).toContainText("1.00（n = 4）");
    await expect(result).toContainText("1.00（n = 5）");
    const explorer = page.getByRole("region", {
      name: "配对数据",
      exact: true,
    });
    await expect(explorer.locator("tbody tr")).toHaveCount(7);
    await explorer.locator("thead button").nth(1).click();
    await expect(explorer.locator("thead th").nth(1)).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await explorer
      .locator("tbody")
      .getByRole("button", { name: "样本 6", exact: true })
      .click();
    await expect(explorer.locator("tbody tr.chosen")).toHaveCount(1);
    await explorer.getByRole("radio").first().check();
    await explorer
      .getByRole("combobox", { name: "横轴", exact: true })
      .selectOption("outside");
    await expect(result).toContainText("1.00（n = 4）");
    await explorer.evaluate((el) =>
      window.scrollBy(0, el.getBoundingClientRect().top - 120),
    );
    await captureEvidence(page, testInfo.outputPath("correlation-table.png"));
    await explorer.locator('svg[role="group"]').scrollIntoViewIfNeeded();
    await captureEvidence(page, testInfo.outputPath("correlation-plot.png"));
    await lab.evaluate((el) =>
      window.scrollBy(0, el.getBoundingClientRect().top - 120),
    );
    await captureEvidence(page, testInfo.outputPath("correlation-shared.png"));
    await inputs.nth(2).selectOption("yes");
    await inputs.nth(1).selectOption("outside");
    await expect(result).toContainText("1.00（n = 5）");
    await captureEvidence(
      page,
      testInfo.outputPath("correlation-pairwise.png"),
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    await expect(lab.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

const settleChart = async (chart: Locator) => {
  let previous = "",
    stable = 0;
  await expect
    .poll(
      async () => {
        const svg = await chart.locator("svg").innerHTML();
        stable = svg === previous ? stable + 1 : 0;
        previous = svg;
        return stable;
      },
      { timeout: 5000, intervals: [100] },
    )
    .toBeGreaterThanOrEqual(3);
};
const scatterPoints = (chart: Locator) =>
  chart.locator("svg path").evaluateAll((paths) =>
    paths.flatMap((path) => {
      const shape = path as SVGPathElement,
        box = shape.getBBox();
      // The rendered diamond point has a closed unit path; legend symbols are larger.
      if (
        box.width !== 2 ||
        box.height !== 2 ||
        !shape.getAttribute("d")?.endsWith("Z")
      )
        return [];
      const visible = shape.getBoundingClientRect();
      return [
        { x: visible.x + visible.width / 2, y: visible.y + visible.height / 2 },
      ];
    }),
  );
for (const viewport of [
  { width: 1366, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`typed measured overlays update charts at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto("/sites/instruments/overlays");
    const ternary = page.getByRole("region", {
      name: "三体实测叠加",
      exact: true,
    });
    const select = ternary.getByRole("combobox"),
      chart = ternary.locator(".line-chart");
    await expect(select).toHaveValue("none");
    await expect(select.locator("option")).toHaveCount(3);
    await expect.poll(async () => (await scatterPoints(chart)).length).toBe(0);
    const initial = await ternary.locator("dd").allTextContents();
    await ternary.evaluate((el) =>
      window.scrollBy(0, el.getBoundingClientRect().top - 120),
    );
    await captureEvidence(page, testInfo.outputPath("ternary-controls.png"));
    await select.selectOption("signal");
    await expect.poll(async () => (await scatterPoints(chart)).length).toBe(3);
    expect(await ternary.locator("dd").allTextContents()).toEqual(initial);
    await chart.scrollIntoViewIfNeeded();
    await settleChart(chart);
    const signal = await scatterPoints(chart);
    expect(signal[0].x).toBeLessThan(signal[1].x);
    expect(signal[1].x).toBeLessThan(signal[2].x);
    expect(signal[1].y).toBeLessThan(signal[2].y);
    expect(signal[2].y).toBeLessThan(signal[0].y);
    await captureEvidence(page, testInfo.outputPath("signal-overlay.png"));
    await select.selectOption("decrease");
    await expect.poll(async () => (await scatterPoints(chart)).length).toBe(3);
    await chart.scrollIntoViewIfNeeded();
    await settleChart(chart);
    const decrease = await scatterPoints(chart);
    expect(decrease[1].y).toBeLessThan(decrease[0].y);
    expect(decrease[0].y).toBeLessThan(decrease[2].y);
    await captureEvidence(page, testInfo.outputPath("decrease-overlay.png"));
    await ternary.getByRole("button").click();
    await expect(select).toHaveValue("none");
    await expect.poll(async () => (await scatterPoints(chart)).length).toBe(0);
    const kinetics = page.getByRole("region", {
      name: "时间实测叠加",
      exact: true,
    });
    const time = kinetics.getByRole("combobox"),
      timeChart = kinetics.locator(".line-chart");
    await expect(time).toHaveValue("none");
    const initialTime = await kinetics.locator("dd").allTextContents();
    await time.selectOption("time-and-washout");
    await expect
      .poll(async () => (await scatterPoints(timeChart)).length)
      .toBe(6);
    expect(await kinetics.locator("dd").allTextContents()).toEqual(initialTime);
    await kinetics.evaluate((el) =>
      window.scrollBy(0, el.getBoundingClientRect().top - 120),
    );
    await captureEvidence(page, testInfo.outputPath("time-controls.png"));
    await timeChart.scrollIntoViewIfNeeded();
    await settleChart(timeChart);
    const measured = await scatterPoints(timeChart);
    expect(measured[3].x).toBeCloseTo(measured[1].x, 1);
    expect(measured[3].y).toBeCloseTo(measured[2].y, 1);
    expect(measured[5].x).toBeGreaterThan(measured[4].x);
    expect(measured[5].y).toBeLessThan(measured[0].y);
    await captureEvidence(page, testInfo.outputPath("time-overlay.png"));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    await expect(ternary.getByRole("alert")).toHaveCount(0);
    await expect(kinetics.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`chair reference data preserves bounds and temperature lookup at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto("/sites/instruments/chair");
    const lab = page.getByRole("region", { name: "两态构象参考", exact: true });
    const inputs = lab.getByRole("spinbutton");
    await expect(inputs.nth(0)).toHaveValue("5");
    await expect(inputs.nth(1)).toHaveValue("298.15");
    await expect(lab.locator("dd")).toContainText("7.5");
    await lab.evaluate((el) =>
      window.scrollBy(0, el.getBoundingClientRect().top - 120),
    );
    await captureEvidence(page, testInfo.outputPath("chair-reference.png"));
    await lab.getByRole("button").nth(0).click();
    await expect(inputs.nth(0)).toHaveValue("0");
    await expect(lab.locator("dd")).toContainText("50%");
    await lab.getByRole("button").nth(1).click();
    await expect(inputs.nth(0)).toHaveValue("20");
    await expect(lab.locator("dd")).toContainText("> 1000");
    await expect(lab.locator("dd")).toContainText(">99%");
    await captureEvidence(page, testInfo.outputPath("chair-bound.png"));
    await inputs.nth(1).fill("300");
    await expect(lab.locator("dd")).toHaveCount(0);
    await expect(lab.locator('[role="status"]')).toBeVisible();
    await captureEvidence(page, testInfo.outputPath("chair-off-reference.png"));
    await lab.getByRole("button").last().click();
    await expect(inputs.nth(0)).toHaveValue("5");
    await expect(inputs.nth(1)).toHaveValue("298.15");
    await expect(lab.locator("dd")).toHaveCount(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    await expect(lab.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`radical datasets preserve predictions and reveal reset at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto("/sites/instruments/radical");
    const estimate = page.getByRole("region", {
      name: "逐氢因子样本",
      exact: true,
    });
    const choices = estimate.getByRole("combobox");
    await expect(choices.nth(0)).toHaveValue("sample-b");
    await expect(choices.nth(0).locator("option")).toHaveCount(3);
    await expect(choices.nth(1)).toHaveValue("X");
    await expect(choices.nth(1).locator("option")).toHaveCount(2);
    await expect(estimate.locator("dd")).toHaveText(["75.0%", "25.0%"]);
    await estimate.evaluate((el) =>
      window.scrollBy(0, el.getBoundingClientRect().top - 100),
    );
    await captureEvidence(page, testInfo.outputPath("radical-controls.png"));
    await estimate.getByRole("button").first().click();
    await expect(estimate.locator("dd")).toHaveCount(4);
    await expect(estimate.locator("dd").nth(3)).toContainText(
      "(40/2) ÷ (60/6) = 2",
    );
    await estimate.getByRole("spinbutton").nth(1).fill("5");
    await expect(estimate.locator("dd")).toHaveText(["37.5%", "62.5%"]);
    await choices.nth(1).selectOption("Y");
    await estimate.getByRole("button").first().click();
    await expect(estimate.locator("dd").nth(3)).toContainText(">98%");
    await expect(estimate.locator("dd").nth(3)).toContainText("147");
    if (viewport.width === 390)
      await page.evaluate(() => window.scrollBy(0, 300));
    await captureEvidence(page, testInfo.outputPath("radical-reference.png"));
    await choices.nth(0).selectOption("sample-c");
    await expect(estimate.locator("dd")).toHaveCount(3);
    await estimate.getByRole("button").first().click();
    await expect(estimate.locator("dd")).toHaveCount(3);
    const offered = page.getByRole("region", {
      name: "提供因子样本",
      exact: true,
    });
    await expect(offered.getByRole("combobox").nth(0)).toHaveValue("sample-c");
    await expect(offered.locator("dd")).toHaveCount(0);
    await offered.getByRole("button").first().click();
    await expect(offered.locator("dd")).toHaveText(["27.3%", "54.5%", "18.2%"]);
    await offered.getByRole("combobox").nth(1).selectOption("Y");
    await expect(offered.locator("dd")).toHaveCount(0);
    await offered.getByRole("button").first().click();
    await expect(offered.locator("dd")).toHaveText(["0.2%", "30.7%", "69.1%"]);
    await offered.evaluate((el) =>
      window.scrollBy(0, el.getBoundingClientRect().top - 100),
    );
    await captureEvidence(page, testInfo.outputPath("radical-offered.png"));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    await expect(estimate.getByRole("alert")).toHaveCount(0);
    await expect(offered.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`pKa datasets preserve solvent scales and ordered readings at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto("/sites/instruments/pka");
    const dmso = page.getByRole("region", {
      name: "酸碱标尺样本 dmso",
      exact: true,
    });
    const water = page.getByRole("region", {
      name: "酸碱标尺样本 water",
      exact: true,
    });
    for (const lab of [dmso, water]) {
      await expect(lab.getByRole("combobox").nth(0)).toHaveValue("donor-a");
      await expect(lab.getByRole("combobox").nth(1)).toHaveValue("base-a");
      await expect(lab.locator("dd")).toHaveCount(1);
    }
    expect(
      await dmso
        .getByRole("combobox")
        .nth(0)
        .locator("option")
        .evaluateAll((options) =>
          options.map((option) => option.getAttribute("value")),
        ),
    ).toEqual(["donor-c", "donor-a", "donor-b"]);
    await expect(
      water.getByRole("combobox").nth(0).locator("option"),
    ).toHaveCount(2);
    await expect(dmso.locator("dd")).toContainText("+4.0，K = 1.0×10⁴");
    await dmso.evaluate((el) =>
      window.scrollBy({
        top: el.getBoundingClientRect().top - 110,
        behavior: "instant",
      }),
    );
    await captureEvidence(page, testInfo.outputPath("pka-dmso.png"));
    await expect(water.locator("dd")).toContainText("−5.0，K = 1.0×10⁻⁵");
    await water.evaluate((el) =>
      window.scrollBy({
        top: el.getBoundingClientRect().top - 110,
        behavior: "instant",
      }),
    );
    await captureEvidence(page, testInfo.outputPath("pka-water.png"));
    await dmso.getByRole("combobox").nth(0).selectOption("donor-b");
    await dmso.getByRole("combobox").nth(1).selectOption("base-b");
    await expect(dmso.locator("dd")).toContainText([
      "+1.0，K = 1.0×10¹",
      "+2.0，K = 1.0×10²",
      "+0.0，K = 1.0×10⁰",
      "+1.0，K = 1.0×10¹",
    ]);
    await dmso.evaluate((el) =>
      window.scrollBy({
        top: el.getBoundingClientRect().top - 110,
        behavior: "instant",
      }),
    );
    await captureEvidence(page, testInfo.outputPath("pka-multiple.png"));
    await dmso.getByRole("button").last().click();
    await expect(dmso.getByRole("combobox").nth(0)).toHaveValue("donor-a");
    await expect(dmso.getByRole("combobox").nth(1)).toHaveValue("base-a");
    await expect(dmso.locator("dd")).toHaveCount(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    for (const lab of [dmso, water])
      await expect(lab.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Hammett datasets preserve exercise reveal and rendered rate slope at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto("/sites/instruments/hammett");
    const exercise = page.getByRole("region", {
      name: "取代效应样本 sigma",
      exact: true,
    });
    await expect(exercise.getByRole("combobox").nth(0)).toHaveValue("group-a");
    await expect(exercise.getByRole("combobox").nth(1)).toHaveValue("para");
    await expect(
      exercise.getByRole("combobox").nth(0).locator("option"),
    ).toHaveCount(3);
    await expect(exercise.getByRole("status")).toHaveCount(1);
    await exercise.getByRole("spinbutton").fill("0.3");
    await exercise.getByRole("button").last().click();
    await expect(exercise.getByRole("status")).toHaveCount(2);
    await expect(exercise.getByRole("status").last()).toContainText(
      "5 − 4.7 = 0.3",
    );
    await exercise.evaluate((el) =>
      window.scrollBy({
        top: el.getBoundingClientRect().top - 110,
        behavior: "instant",
      }),
    );
    await captureEvidence(page, testInfo.outputPath("hammett-exercise.png"));
    await exercise.getByRole("combobox").nth(1).selectOption("meta");
    await expect(exercise.getByRole("status")).toHaveCount(1);
    await exercise.getByRole("button").last().click();
    await expect(exercise.getByRole("status").last()).toContainText(
      "5 − 5.1 = -0.1",
    );
    await exercise.getByRole("button").first().click();
    await expect(exercise.getByRole("combobox").nth(1)).toHaveValue("para");
    await expect(exercise.getByRole("spinbutton")).toHaveValue("0");
    await expect(exercise.getByRole("status")).toHaveCount(1);
    const rate = page.getByRole("region", {
      name: "取代效应样本 rate",
      exact: true,
    });
    await expect(rate.getByRole("combobox").nth(0)).toHaveValue("reaction-a");
    await expect(rate.getByRole("combobox").nth(1)).toHaveValue("group-a");
    await expect(rate.getByRole("combobox").nth(2)).toHaveValue("meta");
    await expect(rate.getByRole("status")).toContainText("10^-0.40");
    const chart = rate.locator(".line-chart");
    await chart.scrollIntoViewIfNeeded();
    await settleChart(chart);
    const line = chart.locator('svg path[fill="none"][stroke-width="2"]');
    await expect(line).toHaveCount(1);
    const endpoints = async () =>
      line.evaluate((path) => {
        const values = path
          .getAttribute("d")!
          .match(/-?\d+(?:\.\d+)?/g)!
          .map(Number);
        return { firstY: values[1], lastY: values.at(-1)! };
      });
    const positive = await endpoints();
    expect(positive.firstY).toBeGreaterThan(positive.lastY);
    await rate.evaluate((el) =>
      window.scrollBy({
        top: el.getBoundingClientRect().top - 110,
        behavior: "instant",
      }),
    );
    await captureEvidence(page, testInfo.outputPath("hammett-positive.png"));
    await rate.getByRole("combobox").nth(0).selectOption("reaction-b");
    await expect(rate.getByRole("status")).toContainText("10^0.60");
    await settleChart(chart);
    const negative = await endpoints();
    expect(negative.firstY).toBeLessThan(negative.lastY);
    await captureEvidence(page, testInfo.outputPath("hammett-negative.png"));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    for (const lab of [exercise, rate])
      await expect(lab.getByRole("alert")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
