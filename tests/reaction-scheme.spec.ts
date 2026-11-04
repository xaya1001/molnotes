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
  const scope = page.locator(".substrate-scope");
  await expect(scope.locator("tbody tr")).toHaveCount(3);
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
