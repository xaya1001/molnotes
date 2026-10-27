import { expect, test } from "./helpers/test";
test.setTimeout(90_000);
test("molecule selection supports mouse and keyboard; result is absent until submission", async ({
  page,
}) => {
  await page.goto("/showcase/molecule");
  const exercise = page.getByRole("region", { name: "先预测再揭晓" }).first();
  const atom = exercise.getByRole("button", { name: "原子 2", exact: true });
  await expect(atom).toBeVisible({ timeout: 45_000 });
  await expect(exercise.getByText(/图中标出的是氧原子/)).toHaveCount(0);
  await expect(exercise.locator("#demo-evidence")).toHaveCount(0);
  await atom.click();
  await expect(atom).toHaveAttribute("aria-pressed", "true");
  await atom.focus();
  await page.keyboard.press("Space");
  await expect(atom).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Enter");
  await exercise.getByRole("button", { name: "提交预测" }).click();
  await expect(
    exercise.getByText(/图中标出的是氧原子；你的选择与之一致/),
  ).toBeVisible();
  await expect(exercise.getByText(/索引|原子 2/)).toHaveCount(0);
  await expect(exercise.locator("#demo-evidence")).toBeVisible();
  const cut = page.getByRole("region", { name: "先预测再揭晓" }).nth(1);
  await cut
    .getByRole("button", { name: "键 1（原子 1–2）", exact: true })
    .click();
  await cut.getByRole("button", { name: "提交预测" }).click();
  await expect(
    cut.getByText(/图中标出的是 C–O 键；你的选择与之一致/),
  ).toBeVisible();
  const variants = page.getByRole("region", { name: "改一个基团" });
  await expect(variants).toContainText("78.11");
  await variants.getByRole("combobox").selectOption("1");
  await expect(variants).toContainText("94.11");
  await expect(variants).toContainText("20.23");
  const mechanism = page.getByRole("region", { name: "分步机理" });
  await expect(mechanism.locator(".electron-arrow")).toHaveCount(1);
  await mechanism.getByRole("button", { name: "下一帧" }).click();
  await expect(mechanism.locator(".electron-arrow")).toHaveCount(2);
});
test("structures label specified stereocentres", async ({ page }) => {
  await page.goto("/showcase/molecule");
  const lactic = page.getByRole("img", { name: "L-乳酸二维结构", exact: true });
  await expect(lactic.locator(".CIP_Code").first()).toBeAttached({
    timeout: 45_000,
  });
});
test("WASM failure leaves the SMILES and an actionable error", async ({
  page,
}) => {
  await page.route(
    (url) => url.pathname.endsWith(".wasm") && !url.searchParams.has("import"),
    (route) => route.abort(),
  );
  await page.goto("/showcase/molecule");
  const exercise = page.getByRole("region", { name: "先预测再揭晓" }).first();
  await expect(exercise.getByRole("alert")).toBeVisible({ timeout: 45_000 });
  await expect(exercise.getByRole("alert")).toContainText("CCO");
  await expect(
    exercise.getByRole("button", { name: "重试结构加载" }),
  ).toBeVisible();
  await page.unrouteAll();
  await exercise.getByRole("button", { name: "重试结构加载" }).click();
  await expect(
    exercise.getByRole("button", { name: "原子 2", exact: true }),
  ).toBeVisible({ timeout: 45_000 });
});

test("pages without molecular content do not request RDKit or WASM", async ({
  page,
}) => {
  const resources: string[] = [];
  page.on("request", (request) => resources.push(request.url()));
  await page.goto("/", { waitUntil: "networkidle" });
  expect(
    resources.filter((url) => /RDKit_minimal|\.wasm(?:\?|$)/.test(url)),
  ).toEqual([]);
});

test("molecule canvases crop whitespace without enlarging small molecules on desktop and mobile", async ({
  page,
}) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/showcase/molecule");
    const route = page.getByRole("region", { name: "分步合成路线" });
    await route
      .getByRole("button", { name: "乙酰化示意", exact: true })
      .click();
    const small = route.getByRole("img", { name: "乙酸二维结构", exact: true });
    const large = route.getByRole("img", {
      name: "阿司匹林二维结构",
      exact: true,
    });
    await expect(small).toBeVisible({ timeout: 45_000 });
    await expect(large).toBeVisible({ timeout: 45_000 });
    const measure = async (svg: typeof small) =>
      svg.evaluate((node: SVGSVGElement) => {
        const box = node.getBBox();
        const view = node.viewBox.baseVal;
        return {
          spareWidth: view.width - box.width,
          spareHeight: view.height - box.height,
          scale: node.getBoundingClientRect().width / view.width,
        };
      });
    await expect
      .poll(async () => (await measure(small)).spareWidth)
      .toBeLessThan(30);
    const a = await measure(small),
      b = await measure(large);
    expect(a.spareHeight).toBeLessThan(30);
    expect(a.spareWidth).toBeGreaterThanOrEqual(20);
    expect(a.spareHeight).toBeGreaterThanOrEqual(20);
    expect(Math.abs(a.scale - b.scale)).toBeLessThan(0.01);
    await route.screenshot({
      path: test.info().outputPath(`cropped-route-${width}.png`),
    });
  }
});
