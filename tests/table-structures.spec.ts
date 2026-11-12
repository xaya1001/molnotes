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
  await page.goto("/sites/table-samples/start");
  const table = page.getByRole("table", { name: "条件优化", exact: true });
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
  await table.getByRole("button", { name: "放大结构" }).first().click();
  await expect(
    page.getByRole("dialog").locator(".library-canvas svg"),
  ).toBeVisible();
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
