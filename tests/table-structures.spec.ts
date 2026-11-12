import { test, expect } from "./helpers/test.ts";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
const base = "/sites/fable-patent";
test.beforeEach(({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
});
async function screenshot(
  page: Page,
  info: TestInfo,
  view: string,
  selector: string,
) {
  const directory =
    process.env.MOLNOTES_TABLE_SCREENS ?? info.outputPath("screens");
  await mkdir(directory, { recursive: true });
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: width === 1366 ? 900 : 844 });
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(directory, `${view}-${width}.png`) });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize({ width: 1366, height: 900 });
}

test("table groups and compound cells share library identity and keep local phone scrolling", async ({
  page,
}, info) => {
  await page.route("**/api/library", async (route) => {
    const response = await route.fetch();
    const library = await response.json();
    const key = Object.keys(library.renders).find((key) =>
      key.includes("cmp_table_sample"),
    )!;
    library.renders[key].minimumScale = 0.9;
    await route.fulfill({ response, json: library });
  });
  await page.goto("/sites/table-samples/start");
  const table = page.getByRole("table", {
    name: "条件优化",
    exact: true,
    includeHidden: true,
  });
  await expect(table.locator('th[scope="colgroup"]')).toHaveCount(2);
  await expect(table.locator('th[scope="colgroup"]').last()).toHaveAttribute(
    "colspan",
    "2",
  );
  await expect(table.locator('th[scope="row"]')).toHaveCount(3);
  await expect(table.locator('[data-compound="cmp_table_sample"]')).toHaveCount(
    2,
  );
  await expect(table.locator(".table-structure svg")).toHaveCount(3);
  const scales = await table
    .locator(".table-structure svg")
    .evaluateAll((elements) =>
      elements.map(
        (svg) =>
          svg.getBoundingClientRect().width / Number(svg.getAttribute("width")),
      ),
    );
  expect(Math.min(...scales)).toBeGreaterThanOrEqual(0.899);
  expect(Math.max(...scales) - Math.min(...scales)).toBeLessThan(0.001);

  await expect(table.locator("thead strong")).toHaveCount(1);
  await expect(
    table.locator("thead tr:last-child th").nth(2).locator("br"),
  ).toHaveCount(1);
  await expect(table.locator('tbody th[scope="rowgroup"]')).toHaveAttribute(
    "colspan",
    "5",
  );
  await expect(table.locator('tbody th[scope="rowgroup"] strong')).toHaveCount(
    1,
  );
  const layout = await table.evaluate((table) => {
    const groups = [...table.querySelectorAll<HTMLElement>(".group-label")];
    const cell = table.querySelector<HTMLElement>("tbody tr:last-child td")!;
    return {
      shortRules: groups.every(
        (label) =>
          getComputedStyle(label).borderBottomStyle === "solid" &&
          label.getBoundingClientRect().width <
            label.parentElement!.getBoundingClientRect().width,
      ),
      align: getComputedStyle(cell).textAlign,
      border: getComputedStyle(cell).borderTopStyle,
      font: getComputedStyle(cell).fontFamily,
    };
  });
  expect(layout.shortRules).toBeTruthy();
  expect(layout.align).toBe("center");
  expect(layout.border).toBe("none");
  expect(layout.font).not.toMatch(/monospace/);
  await screenshot(
    page,
    info,
    "optimization",
    'table:has(caption:text-is("条件优化"))',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await table.evaluate(
      (e) => e.parentElement!.scrollWidth > e.parentElement!.clientWidth,
    ),
  ).toBeTruthy();
  const artwork = await table
    .locator(".table-structure svg")
    .first()
    .innerHTML();
  await table.getByRole("button", { name: "放大结构" }).first().click();
  await expect(
    page.getByRole("dialog").locator(".library-canvas svg"),
  ).toBeVisible();
  expect(
    await page.getByRole("dialog").locator(".library-canvas svg").innerHTML(),
  ).toBe(artwork);
  await expect(table.locator(".table-structure svg")).toHaveCount(3);
  await screenshot(page, info, "structure-dialog", '[role="dialog"]');
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("record, SAR, detail and compare structures retain filters and CSV values", async ({
  page,
}, info) => {
  await page.goto(base + "/examples");
  await expect(
    page.locator(".record-collection .table-structure svg").first(),
  ).toBeVisible();
  await screenshot(page, info, "records", ".record-collection table");
  await page.getByLabel("子结构（SMILES 或 SMARTS）").fill("[#8]");
  await page.getByRole("button", { name: "筛选子结构" }).click();
  await page
    .getByRole("combobox", { name: "来源", exact: true })
    .selectOption("beta");
  await expect(page.locator(".record-collection tbody tr")).toHaveCount(4);
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "当前筛选 CSV" }).click();
  const file = await downloaded;
  const csv = await readFile((await file.path())!, "utf8");
  expect(csv).toContain('"Oc1ccccc1"');
  expect(csv.split("\r\n")).toHaveLength(5);
  await page.goto(base + "/sar/oxygen");
  await expect(page.locator(".case-card .table-structure svg")).toHaveCount(2);
  await page.goto(base + "/examples?source=alpha&activity=A");
  await expect(
    page.locator(".record-collection .table-structure svg"),
  ).toHaveCount(3);
  await screenshot(page, info, "sar", ".record-collection table");
  await page.goto(base + "/examples/1");
  await expect(
    page.locator(".record-fields .table-structure svg"),
  ).toBeVisible();
  await screenshot(page, info, "record-detail", ".record-fields");
  await page.goto(base + "/examples/compare?ids=1,2");
  await expect(
    page.locator(".compare-column .table-structure svg"),
  ).toHaveCount(2);
});

test("record tables stack values and names and paginate twelve rows", async ({
  page,
}) => {
  await page.route("**/api/topics/fable-patent", async (route) => {
    const response = await route.fetch();
    const topic = await response.json();
    const collection = topic.content.data.collections.examples;
    collection.fields = collection.fields.filter((f: { key: string }) =>
      ["name", "smiles", "amount", "activity", "binding"].includes(f.key),
    );
    collection.fields.find((f: { key: string }) => f.key === "name").placement =
      "identifier";
    collection.fields.push({
      key: "readings",
      label: "IC50\n(nM)",
      kind: "text",
    });
    collection.fields.push({
      key: "annotation",
      label: "Details",
      kind: "text",
    });
    for (const record of collection.records) {
      record.annotation = "A long experimental annotation at 25 °C for 2 h";
      record.name = record.id === 1 ? "Sample A" : "";
      record.readings = "0.7\n8.2";
    }
    const extra = { ...collection.records[0], id: "2a", name: "Sample B" };
    collection.records.push(extra);
    collection.structureFigures[extra.id] = collection.structureFigures["1"];
    await route.fulfill({ response, json: topic });
  });
  await page.goto(base + "/examples");
  const rows = page.locator(".record-collection tbody tr");
  await expect(rows).toHaveCount(12);
  const first = rows.filter({
    has: page.locator('th[scope="row"] a[href$="/1"]'),
  });
  await expect(first.locator(".record-identifier strong")).toHaveCount(1);
  await expect(first.locator(".identifier-name")).toHaveCount(1);
  await expect(first.locator("td").nth(4).locator("br")).toHaveCount(1);
  await expect(first.locator("td").nth(4)).toHaveCSS("text-align", "center");
  await expect(first.locator("td").nth(5)).toHaveCSS("text-align", "start");
  await expect(
    first.locator("td").nth(5).locator(".quantity").first(),
  ).toHaveCSS("white-space", "nowrap");
  await expect(first.locator("td").last().getByRole("button")).toHaveCSS(
    "white-space",
    "nowrap",
  );
  await expect(page.locator(".record-collection thead th").first()).toHaveCSS(
    "font-weight",
    "600",
  );

  for (const table of await page.locator(".record-collection table").all()) {
    expect(
      await table.evaluate(
        (e) => e.parentElement!.scrollWidth <= e.parentElement!.clientWidth,
      ),
    ).toBeTruthy();
  }
  await page.getByRole("button", { name: "下一页 →" }).click();
  await expect(rows).toHaveCount(1);
  expect(
    await rows
      .locator("th a")
      .evaluate(
        (e) =>
          e.getBoundingClientRect().height <=
          parseFloat(getComputedStyle(e).lineHeight),
      ),
  ).toBeTruthy();
  await page
    .getByRole("combobox", { name: "浏览方式", exact: true })
    .selectOption("cards");
  await expect(page.locator(".cards article")).toHaveCount(6);
  await page
    .getByRole("combobox", { name: "浏览方式", exact: true })
    .selectOption("table");
  await page.getByRole("searchbox", { name: "记录搜索" }).fill("2a");
  await expect(rows).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "分页" })).toHaveCount(0);
});

test("columns keep shared alignment and readable short text while comparisons stay together", async ({
  page,
}) => {
  await page.route("**/api/topics/table-samples", async (route) => {
    const response = await route.fetch();
    const topic = await response.json();
    topic.content.chapters[0].blocks = [
      {
        type: "table",
        caption: "Samples",
        columns: ["ID", "Description", "Series", "Readout"],
        rowHeader: true,
        rows: [
          [
            "1",
            "A long experimental annotation under several conditions",
            "甲基取代",
            "≥ 95%",
          ],
          ["2", "Short", "n", "≤ 20%"],
          ["3", "Brief", "含氟·甲基", "<0.1"],
          ["4", "Text", "甲基取代", "> 5 nM"],
          ["5", "Word", "n", "~ 3"],
        ],
      },
    ];
    await route.fulfill({ response, json: topic });
  });
  await page.goto("/sites/table-samples/start");
  const table = page.getByRole("table");
  await table.evaluate((table) => {
    table.parentElement!.style.width = "360px";
  });
  const rows = table.locator("tbody tr");
  await expect
    .soft(rows.nth(1).locator("td").first())
    .toHaveCSS("text-align", "start");
  const series = rows.first().locator("td").nth(1);
  const width = await series.evaluate((cell) => {
    const style = getComputedStyle(cell);
    return {
      actual: cell.getBoundingClientRect().width,
      minimum:
        4 * parseFloat(style.fontSize) +
        parseFloat(style.paddingLeft) +
        parseFloat(style.paddingRight),
    };
  });
  expect.soft(width.actual).toBeGreaterThanOrEqual(width.minimum);
  await expect.soft(table.locator(".quantity")).toHaveCount(5);
  for (const quantity of await table.locator(".quantity").all())
    await expect(quantity).toHaveCSS("white-space", "nowrap");
  expect(
    await table.evaluate(
      (e) => e.parentElement!.scrollWidth > e.parentElement!.clientWidth,
    ),
  ).toBeTruthy();
});
