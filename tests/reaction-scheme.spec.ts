import { test, expect } from "./helpers/test.ts";
const screens =
  process.env.MOLNOTES_SCHEME_SCREENSHOTS ??
  "test-results/reaction-scheme-screens";
test("schemes render all steps, wrap at arrows and select explanations by keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/sites/minimal/schemes");
  const scheme = page.locator(".reaction-scheme").first();
  await expect(scheme.locator(".scheme-arrow")).toHaveCount(4);
  await expect(scheme.locator("svg.structure")).toHaveCount(6);
  await expect(scheme.locator(".scheme-arrow[aria-pressed=true]")).toHaveCount(
    1,
  );
  const arrows = scheme.locator(".scheme-arrow");
  for (let i = 0; i < 4; i++) {
    const arrow = arrows.nth(i);
    const above = await arrow.locator(".reagents").boundingBox(),
      line = await arrow.locator(".arrow-line").boundingBox(),
      below = await arrow.locator(".conditions").boundingBox();
    expect(above!.y + above!.height).toBeLessThanOrEqual(line!.y + 1);
    expect(below!.y).toBeGreaterThanOrEqual(line!.y + line!.height - 1);
    expect(
      await scheme
        .locator(".scheme-step")
        .nth(i)
        .evaluate((el) =>
          el.firstElementChild?.classList.contains("scheme-arrow"),
        ),
    ).toBe(true);
  }
  const ys = await scheme
    .locator(".scheme-step")
    .evaluateAll((elements) =>
      elements.map((e) => e.getBoundingClientRect().top),
    );
  expect(new Set(ys.map((y) => Math.round(y))).size).toBeGreaterThan(1);
  expect(
    await scheme
      .locator(".compound-number")
      .evaluateAll((es) => es.map((e) => getComputedStyle(e).fontWeight)),
  ).toEqual(Array(6).fill("700"));
  await scheme.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screens}/scheme-desktop.png` });
  await arrows.nth(2).focus();
  await page.keyboard.press("Enter");
  await expect(arrows.nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(scheme.locator(".scheme-explanation")).toHaveAttribute(
    "data-selected-step",
    "2",
  );
  await page.screenshot({ path: `${screens}/scheme-selected-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await scheme.scrollIntoViewIfNeeded();
  for (let i = 0; i < 4; i++) {
    const step = scheme.locator(".scheme-step").nth(i);
    expect(
      await step.evaluate((el) => getComputedStyle(el).flexDirection),
    ).toBe("column");
    const a = await step.locator(".scheme-arrow").boundingBox(),
      p = await step.locator(".scheme-compounds").boundingBox();
    expect(p!.y).toBeGreaterThanOrEqual(a!.y + a!.height);
  }
  const compounds = scheme.locator(".scheme-compounds").nth(2);
  const plus = await compounds.locator(".plus").boundingBox();
  const before = await compounds.locator(".molecule").first().boundingBox();
  const after = await compounds.locator(".molecule").last().boundingBox();
  expect(plus!.y).toBeGreaterThan(before!.y + before!.height);
  expect(plus!.y + plus!.height).toBeLessThan(after!.y);
  expect(
    Math.abs(plus!.x + plus!.width / 2 - (before!.x + before!.width / 2)),
  ).toBeLessThan(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${screens}/scheme-phone.png` });
});
test("retrosynthesis and substrate scopes expose the complete scheme and expandable row product", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/sites/minimal/schemes");
  await page.locator('[aria-label="合成方案"] .controls button').nth(1).click();
  const retro = page.locator(".reaction-scheme").first();
  await expect(retro.locator(".arrow-line.retro line")).toHaveCount(2);
  await retro.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screens}/retro-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await retro.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screens}/retro-phone.png` });
  await page.setViewportSize({ width: 1366, height: 900 });
  const scope = page.locator(".substrate-scope");
  await expect(scope.locator("tbody tr")).toHaveCount(3);
  await expect(
    scope.locator("svg.structure text").filter({ hasText: "R¹" }),
  ).toHaveCount(2);
  await scope.locator("summary").nth(1).click();
  await expect(scope.locator("details[open] svg.structure")).toHaveCount(1);
  await scope.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screens}/scope-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await scope.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${screens}/scope-phone.png` });
  await page.goto("/showcase/molecule");
  const scheme = page.locator(".reaction-scheme").first();
  await expect(scheme.locator("svg.structure")).toHaveCount(6);
  await page.setViewportSize({ width: 1366, height: 900 });
  await scheme.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screens}/after-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await scheme.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${screens}/after-phone.png` });
});

test("preview reports default-layout fallback when a declared core cannot align", async ({
  page,
}) => {
  const { schemeRoutes } = await import("../src/showcase/data/reactions.ts");
  const route = { ...schemeRoutes[0], core: "N1NNNN1" };
  await page.addInitScript((value) => {
    window.__previewFigures = [
      { where: "sample", kind: "route", value: [value], caption: "" },
    ];
  }, route);
  await page.goto("/showcase/preview");
  await expect
    .poll(() => page.evaluate(() => window.__previewResult?.length))
    .toBe(1);
  expect(
    await page.evaluate(() => window.__previewResult![0].warnings.length),
  ).toBeGreaterThan(0);
  await expect(page.locator(".reaction-scheme svg.structure")).toHaveCount(6);
});

test("collision fallback renders separated atom labels and warns in preview", async ({
  page,
}) => {
  const { readFileSync } = await import("node:fs");
  const routes = JSON.parse(
    readFileSync("tests/fixtures/reaction-collision.json", "utf8"),
  );
  await page.addInitScript((value) => {
    window.__previewFigures = [
      { where: "sample", kind: "route", value, caption: "" },
    ];
  }, routes);
  await page.goto("/showcase/preview");
  await expect
    .poll(() => page.evaluate(() => window.__previewResult?.length))
    .toBe(1);
  const product = page.locator(".scheme-step .molecule").last();
  await expect(product.locator("svg.structure")).toHaveCount(1);
  const collision = await product.locator("text").evaluateAll((elements) => {
    const grouped = new Map<
      string,
      { text: string; left: number; right: number; top: number; bottom: number }
    >();
    for (const element of elements) {
      const atom = /atom-(\d+)/.exec(element.getAttribute("class") ?? "")?.[1];
      if (atom === undefined) continue;
      const box = element.getBoundingClientRect(),
        old = grouped.get(atom);
      grouped.set(atom, {
        text: (old?.text ?? "") + element.textContent,
        left: Math.min(old?.left ?? box.left, box.left),
        right: Math.max(old?.right ?? box.right, box.right),
        top: Math.min(old?.top ?? box.top, box.top),
        bottom: Math.max(old?.bottom ?? box.bottom, box.bottom),
      });
    }
    const labels = [...grouped.values()]
      .filter((label) => label.text === "Cl" || label.text === "O")
      .map((label) => ({ text: label.text, rect: label }));
    if (!labels.some((label) => label.text === "Cl"))
      throw new Error("Missing halogen labels");
    return labels.some((a) =>
      labels.some(
        (b) =>
          a.text !== b.text &&
          a.rect.left < b.rect.right &&
          b.rect.left < a.rect.right &&
          a.rect.top < b.rect.bottom &&
          b.rect.top < a.rect.bottom,
      ),
    );
  });
  expect(collision).toBe(false);
  expect(
    await page.evaluate(() => window.__previewResult![0].warnings.length),
  ).toBeGreaterThan(0);
});
