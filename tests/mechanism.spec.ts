import { expect, test } from "./helpers/test.ts";
test.setTimeout(90_000);
test("mapped mechanisms render full schemes, select electron steps, pause and land on the exact target", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.goto("/showcase/mechanisms");
  const sample = page.getByRole("region", {
    name: "羰基加成示例",
    exact: true,
  });
  const overview = sample.locator(".mechanism-overview");
  await expect(overview.locator(".mechanism-ink")).toHaveCount(2);
  await expect(
    overview
      .locator(".mechanism-structure")
      .first()
      .locator('[data-source="1"]')
      .first(),
  ).toBeAttached();
  await expect(overview.locator(".arrow-line")).toHaveAttribute(
    "data-arrow-kind",
    "equilibrium",
  );
  const target = await overview
    .locator(".mechanism-structure")
    .nth(1)
    .innerHTML();
  await overview.locator(".scheme-arrow").click();
  const detail = sample.locator(".mechanism-detail");
  await expect(detail).toBeVisible();
  await page.clock.runFor(1050);
  const moving = await detail
    .locator(".mechanism-ink")
    .getAttribute("data-progress");
  expect(Number(moving)).toBeGreaterThan(0);
  expect(Number(moving)).toBeLessThan(1);
  await sample.getByRole("button", { name: "暂停", exact: true }).click();
  const paused = await detail
    .locator(".mechanism-ink")
    .getAttribute("data-progress");
  await page.clock.runFor(400);
  expect(
    await detail.locator(".mechanism-ink").getAttribute("data-progress"),
  ).toBe(paused);
  await sample.getByRole("button", { name: "播放", exact: true }).click();
  await page.clock.runFor(1200);
  await expect(detail.locator(".mechanism-ink")).toHaveAttribute(
    "data-progress",
    "1",
  );
  expect(await detail.locator(".mechanism-structure").innerHTML()).toBe(target);
});
test("journal mechanisms expose transition brackets, fishhooks, responsive cycles and selected arcs", async ({
  page,
}) => {
  for (const [width, height] of [
    [1366, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/showcase/mechanisms");
    const sub = page.getByRole("region", { name: "亲核取代示例", exact: true });
    await expect(sub.locator("[data-transition-bracket]")).toBeAttached();
    await expect(
      sub.locator(".overall-reaction .reaction-scheme"),
    ).toBeVisible();
    const radical = page.getByRole("region", {
      name: "自由基示例",
      exact: true,
    });
    await expect(radical.locator('[data-electrons="1"]')).toHaveCount(2);
    const cycle = page.getByRole("region", {
      name: "催化循环示例",
      exact: true,
    });
    await expect(cycle.locator(".cycle-intermediate")).toHaveCount(4);
    const arc = cycle.locator(".arc-target").nth(1);
    await arc.focus();
    await page.keyboard.press("Enter");
    await expect(arc).toHaveAttribute("aria-pressed", "true");
    const body = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    }));
    expect(body.scroll).toBeLessThanOrEqual(body.width);
    for (const [name, locator] of [
      ["overview", sub],
      [
        "addition",
        page.getByRole("region", { name: "羰基加成示例", exact: true }),
      ],
      ["radical", radical],
      ["cycle", cycle],
    ] as const) {
      await locator.screenshot({
        path: test.info().outputPath(`${name}-${width}.png`),
      });
    }
  }
});
