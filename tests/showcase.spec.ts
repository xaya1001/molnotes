import { expect, test, type Page } from "./helpers/test";

const pages = [
  ["/showcase/", "工具箱示例"],
  ["/showcase/elements", "正文元素"],
  ["/showcase/steps", "分步图示"],
  ["/showcase/curves", "公式与曲线"],
  ["/showcase/molecule", "二维分子结构"],
  ["/showcase/data", "数据表与散点"],
  ["/showcase/matrix", "预测矩阵"],
  ["/showcase/protein", "蛋白三维结构"],
  ["/showcase/structure", "结构量距"],
  ["/showcase/video", "讲解视频"],
] as const;

function pageHeading(page: Page, name: string) {
  return page.getByRole("heading", { level: 1, name, exact: true });
}

test("every showcase page opens directly from its path", async ({ page }) => {
  for (const [path, title] of pages) {
    await page.goto(path);
    await expect(pageHeading(page, title)).toBeVisible();
    const expectedTitle =
      title === "工具箱示例"
        ? "工具箱示例 · 分子笔记"
        : `${title} · 工具箱示例 · 分子笔记`;
    await expect(page).toHaveTitle(expectedTitle);
    await expect(
      page.getByRole("navigation", { name: "专题目录" }).getByRole("link", {
        name: title === "工具箱示例" ? "概览" : title,
      }),
    ).toHaveAttribute("aria-current", "page");
  }
});

test("the pager moves through sections, focuses the new heading and keeps history", async ({
  page,
}) => {
  await page.goto("/showcase/elements");
  await page.getByRole("link", { name: /下一节\s*分步图示/ }).click();
  await expect(page).toHaveURL(/\/showcase\/steps$/);
  await expect(pageHeading(page, "分步图示")).toBeFocused();
  await expect(page.getByRole("status").last()).toHaveText("已打开：分步图示");
  await page.goBack();
  await expect(pageHeading(page, "正文元素")).toBeFocused();
  await page.getByRole("link", { name: /上一节\s*概览/ }).click();
  await expect(page).toHaveURL(/\/showcase\/$/);
});

test("an unknown path shows a not-found page inside the topic", async ({
  page,
}) => {
  await page.goto("/showcase/no-such-page");
  await expect(pageHeading(page, "页面不存在")).toBeVisible();
  await page.getByRole("link", { name: "回到本专题首页" }).click();
  await expect(pageHeading(page, "工具箱示例")).toBeVisible();
});

test("showcase pages fit a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [path] of pages) {
    await page.goto(path);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
  }
});

test("the dialog returns focus to the control that opened it", async ({
  page,
}) => {
  await page.goto("/showcase/elements");
  const opener = page.getByRole("button", { name: "查看补充说明" });
  await opener.focus();
  await opener.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole("button");
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.press("Enter");
  await close.click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("the step scene and curve respond to their controls", async ({ page }) => {
  await page.goto("/showcase/steps");
  await expect(page.getByText("步骤 1 / 3")).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByText("对象 A 接近对象 B")).toBeVisible();
  await expect(page.getByText("步骤 2 / 3")).toBeVisible();

  await page.goto("/showcase/curves");
  await page.getByRole("slider", { name: /斜率/ }).fill("4");
  await expect(page.getByText("斜率 k：4")).toBeVisible();
  await expect(
    page.getByRole("img", { name: "y 随 x 变化的曲线" }),
  ).toBeVisible();
});

test("figures open in a zoomable viewer and report images that fail", async ({
  page,
}) => {
  await page.goto("/showcase/molecule");
  const figure = page.getByRole("img", { name: /乙醇的二维结构/ });
  await expect
    .poll(() =>
      figure.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  // The closed viewer must not hold a second copy, which would load every
  // page image eagerly and make src-based locators ambiguous.
  await expect(page.locator('img[src$="ethanol.svg"]')).toHaveCount(1);
  const opener = page.getByRole("button", { name: /放大查看/ });
  await opener.click();
  const viewer = page.getByRole("dialog", { name: /乙醇/ });
  const image = viewer.getByRole("img");
  const fitted = (await image.boundingBox())!.width;
  await viewer.getByRole("button", { name: "放大图片" }).click();
  expect((await image.boundingBox())!.width).toBeGreaterThan(fitted);
  await viewer.getByRole("button", { name: "适应窗口" }).click();
  expect((await image.boundingBox())!.width).toBeCloseTo(fitted, 0);
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(opener).toBeFocused();

  await page.route("**/ethanol.svg", (route) => route.abort());
  await page.reload();
  await page.getByRole("button", { name: /放大查看/ }).click();
  await expect(
    page.getByRole("dialog", { name: /乙醇/ }).getByRole("alert"),
  ).toHaveText(/图片无法加载/);
});

test("media demos load inside their frames", async ({ page }) => {
  await page.goto("/showcase/video");
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.duration),
    )
    .toBe(5);

  await page.goto("/showcase/protein");
  await page.getByRole("button", { name: "加载三维结构" }).click();
  await expect(page.getByText(/结构已加载/)).toBeVisible({ timeout: 15_000 });
  const proteinCanvas = page.locator(".structure-canvas canvas");
  await expect(proteinCanvas).toBeVisible();
  expect(
    await proteinCanvas.evaluate((canvas) => {
      const parent = canvas.parentElement!.getBoundingClientRect();
      const image = canvas.getBoundingClientRect();
      return (
        image.left >= parent.left - 1 &&
        image.top >= parent.top - 1 &&
        image.right <= parent.right + 1 &&
        image.bottom <= parent.bottom + 1
      );
    }),
  ).toBe(true);
});

test("the structure lab measures from the coordinate file and fits a 390 px screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/showcase/structure");
  const lab = page.getByRole("region", { name: "三维结构" });
  await expect(lab.getByRole("link", { name: "RCSB PDB 181L" })).toBeVisible();
  const preset = lab.getByRole("button", { name: /3\.58 Å\s+苯 C5 … A99/ });
  await expect(preset).toBeVisible();
  await lab.getByRole("button", { name: "加载三维结构" }).click();
  await expect(lab.getByText(/拖动旋转/)).toContainText(
    "绿：苯；橙：空腔内壁残基",
    { timeout: 15_000 },
  );
  await expect(lab.locator("canvas")).toBeVisible();
  await expect(lab.getByLabel("标出 A99 / V111 / L118")).toBeChecked();
  await preset.click();
  await expect(lab.getByRole("list", { name: "已量的距离" })).toContainText(
    "3.58 Å",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("the data explorer sorts, keeps bounds marked and leaves missing cells out of the plot", async ({
  page,
}) => {
  await page.goto("/showcase/data");
  const explorer = page.getByRole("region", { name: "8 个样品的数据探索" });
  const rows = explorer.locator("tbody tr");
  const row = (name: string) =>
    rows.filter({ has: page.getByRole("button", { name, exact: true }) });
  await expect(rows).toHaveCount(8);
  await expect(row("苯酚")).toContainText(">10,000");
  await expect(row("乙酸")).toContainText("<50");
  await expect(row("乙醛")).toContainText("未测");
  await expect(row("丙酮")).toContainText("第二张表 110");
  await expect(row("乙醇")).not.toContainText("第二张表");

  await explorer.getByRole("button", { name: /^演示活性 A/ }).click();
  await expect(
    rows.first().getByRole("button", { name: "苯", exact: true }),
  ).toBeVisible();
  await expect(
    rows.last().getByRole("button", { name: "苯酚", exact: true }),
  ).toBeVisible();
  await explorer.getByRole("button", { name: /^演示活性 A/ }).click();
  await expect(
    rows.first().getByRole("button", { name: "苯酚", exact: true }),
  ).toBeVisible();
  await explorer.getByRole("button", { name: /^演示活性 B/ }).click();
  await expect(
    rows.first().getByRole("button", { name: "乙酸", exact: true }),
  ).toBeVisible();
  await expect(
    rows.last().getByRole("button", { name: "乙醛", exact: true }),
  ).toBeVisible();
  await explorer.getByRole("button", { name: /^演示活性 B/ }).click();
  await expect(
    rows.last().getByRole("button", { name: "乙醛", exact: true }),
  ).toBeVisible();

  const points = explorer.locator('svg g[role="button"]');
  await expect(points).toHaveCount(7);
  await expect(explorer.locator("polygon.mark.open")).toHaveCount(1);
  await expect(
    explorer.getByText("1 个样品在这两列里缺值或没有画出"),
  ).toBeVisible();
  await explorer.getByRole("combobox", { name: "纵轴" }).selectOption("b");
  await expect(points).toHaveCount(7);
  await expect(explorer.locator("polygon.mark.open")).toHaveCount(2);
  await expect(explorer.locator("circle.ring")).toHaveCount(2);
  const acetone = explorer.getByRole("button", { name: /^丙酮/ }).last();
  await expect(acetone).toHaveAccessibleName(/演示活性 B 1,100/);
  await explorer.getByRole("radio", { name: "第二张表的值" }).check();
  await expect(acetone).toHaveAccessibleName(/演示活性 B 110/);
  await expect(explorer.locator("circle.ring")).toHaveCount(2);

  await explorer
    .getByLabel("官能团")
    .selectOption({ label: "羰基与羧酸（3）" });
  await expect(rows).toHaveCount(3);
  await row("丙酮").getByRole("button", { name: "丙酮", exact: true }).click();
  const detail = explorer.getByRole("region", { name: "所选样品" });
  await expect(detail.getByRole("heading", { name: "丙酮" })).toBeVisible();
  await expect(detail).toContainText("第二张表 演示表 B，原写 110 nM");
  await expect(detail).toContainText("第一张表写 1.1 µM，第二张表写 110 nM");
  await expect(detail).toContainText("演示备注");
  await expect(detail.getByRole("img", { name: "丙酮二维结构" })).toBeVisible({
    timeout: 15_000,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("the prediction matrix opens after every required cell and never fills an untested one", async ({
  page,
}) => {
  await page.goto("/showcase/matrix");
  const grid = page.getByRole("region", { name: "演示矩阵" });
  async function predict(id: string, option: string) {
    const card = page.getByTestId(`matrix-${id}`);
    await card.getByRole("radio", { name: option, exact: true }).check();
    await card.getByRole("button", { name: "提交预测", exact: true }).click();
    return card;
  }
  await expect(grid).toHaveCount(0);
  await expect(page.getByText("A with X: turned blue.")).toHaveCount(0);
  const first = await predict("a:x", "变色");
  await expect(first.getByText("判断符合证据")).toBeVisible();
  await expect(first.getByText("A with X: turned blue.")).toBeVisible();
  await expect(first.getByRole("radio", { name: "变色" })).toBeDisabled();
  const second = await predict("b:y", "变色");
  await expect(second.getByText("再看证据")).toBeVisible();
  await expect(grid).toHaveCount(0);
  const third = await predict("c:z", "不变");
  await expect(third.getByText("再看证据")).toBeVisible();
  await expect(third.getByText("原文：未测")).toBeVisible();
  await expect(third.getByText("演示数据里没有做这一组。")).toBeVisible();

  await expect(grid).toBeVisible();
  await expect(grid.locator("tbody tr")).toHaveCount(3);
  await expect(grid.locator("tbody button")).toHaveCount(9);
  await expect(
    grid.getByRole("button", { name: "样品 A 对 试剂 X：变色" }),
  ).toContainText("你猜对");
  await expect(
    grid.getByRole("button", { name: "样品 C 对 试剂 Z：未测" }),
  ).toContainText("你猜错");
  await expect(
    grid.getByRole("button", { name: "样品 C 对 试剂 Z：未测" }),
  ).not.toContainText("不变");
  await expect(
    grid.getByRole("button", { name: /^样品 B 对 试剂 Z/ }),
  ).toContainText("仅见于图");
  await grid.getByRole("button", { name: "样品 C 对 试剂 Z：未测" }).click();
  const detail = grid.getByRole("region", { name: "所选格子的证据" });
  await expect(detail).toContainText("演示数据里没有做这一组。");
  await expect(detail).not.toContainText("turned blue");
  await grid.getByRole("button", { name: "样品 A 对 试剂 Z：变色" }).click();
  await expect(detail).toContainText("只做了一次，没有重复。");
  await expect(detail).toContainText("演示表 1，第 1 页");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });

  await first.getByRole("button", { name: "重新判断" }).click();
  await expect(grid).toHaveCount(0);
  await expect(first.getByRole("radio", { name: "变色" })).not.toBeChecked();
  await expect(first.getByRole("radio", { name: "变色" })).toBeEnabled();
  await page.reload();
  await expect(page.getByTestId("matrix-a:x")).toBeVisible();
  await expect(
    page.getByTestId("matrix-a:x").getByRole("radio", { name: "变色" }),
  ).not.toBeChecked();
});
