import { expect, test } from "./helpers/test.ts";
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
  await mechanism.getByRole("button", { name: "下一步" }).click();
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

test("journal structures keep monochrome labels, equal screen bonds and only declared abbreviations", async ({
  page,
}) => {
  for (const [width, height] of [
    [1366, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/showcase/molecule");
    const full = page.getByRole("img", {
      name: "完整样品二维结构",
      exact: true,
    });
    const abbreviated = page.getByRole("group", {
      name: "缩写样品二维结构",
      exact: true,
    });
    await expect(full).toBeVisible({ timeout: 45_000 });
    await expect(abbreviated).toBeVisible();
    await expect(full.locator("text.atom-11")).toHaveCount(0);
    await expect
      .poll(async () =>
        (await abbreviated.locator("text.atom-11").allTextContents()).join(""),
      )
      .toBe("Boc");
    await expect(abbreviated.locator(".bond-11")).toHaveCount(0);
    const residue = await abbreviated
      .locator("g[aria-hidden]")
      .evaluate((node: SVGGElement) => {
        const full = node.getBBox();
        const boxes = [
          ...node.querySelectorAll<SVGGraphicsElement>(
            "path[class],text[class]",
          ),
        ].map((el) => el.getBBox());
        const left = Math.min(...boxes.map((b) => b.x)),
          right = Math.max(...boxes.map((b) => b.x + b.width));
        const top = Math.min(...boxes.map((b) => b.y)),
          bottom = Math.max(...boxes.map((b) => b.y + b.height));
        return Math.max(
          Math.abs(full.x - left),
          Math.abs(full.y - top),
          Math.abs(full.width - (right - left)),
          Math.abs(full.height - (bottom - top)),
        );
      });
    expect(residue).toBeLessThan(0.5);
    await expect(
      abbreviated.getByRole("button", { name: "原子 11", exact: true }),
    ).toHaveCount(0);
    const atom = abbreviated.getByRole("button", {
      name: "原子 8",
      exact: true,
    });
    await atom.click();
    await expect(atom).toHaveAttribute("aria-pressed", "true");
    const measurements = await page
      .locator(".molecule svg.structure")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const svg = node as SVGSVGElement;
          return [
            ...svg.querySelectorAll("g[aria-hidden] text, g[aria-hidden] path"),
          ].map((el) => {
            const style = getComputedStyle(el);
            return { fill: style.fill, stroke: style.stroke };
          });
        }),
      );
    for (const elements of measurements)
      for (const { fill, stroke } of elements) {
        expect(["none", "rgb(0, 0, 0)"]).toContain(fill);
        expect(["none", "rgb(0, 0, 0)"]).toContain(stroke);
      }
    const bondLength = async (path: ReturnType<typeof full.locator>) =>
      path.evaluate((el: SVGPathElement) => {
        const a = el.getPointAtLength(0),
          b = el.getPointAtLength(el.getTotalLength());
        const matrix = el.getScreenCTM()!;
        const p = new DOMPoint(a.x, a.y).matrixTransform(matrix),
          q = new DOMPoint(b.x, b.y).matrixTransform(matrix);
        return Math.hypot(p.x - q.x, p.y - q.y);
      });
    const small = page
      .getByRole("group", { name: "乙醇二维结构", exact: true })
      .locator("path.bond-0");
    const large = full.locator("path.bond-5");
    expect(await bondLength(small)).toBeCloseTo(await bondLength(large), 0);
    expect(await bondLength(large)).toBeCloseTo(21.6, 0);
    const oversized = page.getByRole("img", {
      name: "长链样品二维结构",
      exact: true,
    });
    const fit = await oversized.evaluate((el: SVGSVGElement) => ({
      natural: el.viewBox.baseVal.width * 1.5,
      actual: el.getBoundingClientRect().width,
      parent: el.parentElement!.getBoundingClientRect().width,
    }));
    expect(fit.actual).toBeLessThan(fit.natural);
    expect(fit.actual).toBeLessThanOrEqual(fit.parent);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("published notes keep authored coordinates at the shared scale and render their declared groups", async ({
  page,
}) => {
  await page.goto("/notes/reader-test/second");
  const a = page.getByRole("img", { name: "样品 A二维结构", exact: true });
  const b = page.getByRole("img", { name: "样品 B二维结构", exact: true });
  const short = page.getByRole("img", {
    name: "样品 B 缩写二维结构",
    exact: true,
  });
  await expect(a).toBeVisible({ timeout: 45_000 });
  await expect
    .poll(async () =>
      (await short.locator("text.atom-11").allTextContents()).join(""),
    )
    .toBe("Boc");
  await expect
    .poll(async () =>
      (await short.locator("text.atom-3").allTextContents()).join(""),
    )
    .toBe("CO2Et");
  const lengths = await Promise.all(
    [a.locator("path.bond-0"), b.locator("path.bond-5")].map((path) =>
      path.evaluate((el: SVGPathElement) => {
        const start = el.getPointAtLength(0),
          end = el.getPointAtLength(el.getTotalLength());
        const matrix = el.getScreenCTM()!;
        const a = new DOMPoint(start.x, start.y).matrixTransform(matrix),
          b = new DOMPoint(end.x, end.y).matrixTransform(matrix);
        return Math.hypot(a.x - b.x, a.y - b.y);
      }),
    ),
  );
  expect(lengths[0]).toBeCloseTo(lengths[1], 0);
  expect(lengths[0]).toBeCloseTo(21.6, 0);
});
