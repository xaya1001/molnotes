import { expect, test } from "./helpers/test.ts";

async function clock(page: import("@playwright/test").Page) {
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  await page.goto("/sites/minimal/steps");
}

test("process jumps, pauses in place, changes speed and completes the final step", async ({
  page,
}) => {
  await clock(page);
  const player = page.locator(".player").first();
  const rows = player.locator("tbody tr");
  expect(
    await player.locator("svg").evaluate((svg) => {
      const nodes = [...svg.querySelectorAll(".node rect")].map((el) =>
        el.getBoundingClientRect(),
      );
      return [...svg.querySelectorAll(".edge-label")].every((label, i) => {
        const box = label.getBoundingClientRect();
        return box.left > nodes[i].right && box.right < nodes[i + 1].left;
      });
    }),
  ).toBe(true);
  await rows.nth(1).click();
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "step");
  await page.clock.runFor(400);
  await player.getByRole("button", { name: "暂停", exact: true }).click();
  const radius = await player.locator(".pulse").getAttribute("r");
  await page.clock.runFor(4000);
  await expect(player.locator(".pulse")).toHaveAttribute("r", radius!);
  await expect(player.locator(".amount").nth(1)).toHaveText("90 g");
  await player.getByRole("button", { name: "播放", exact: true }).click();
  await player.getByRole("button", { name: "播放速度" }).click();
  await expect(player.locator(".pulse")).toHaveAttribute("r", radius!);
  await page.clock.runFor(2600);
  await expect(rows.nth(2)).toHaveAttribute("aria-current", "step");
  await page.clock.runFor(4800);
  await expect(rows.nth(3)).toHaveAttribute("aria-current", "step");
  await expect(
    player.getByRole("button", { name: "重播", exact: true }),
  ).toBeVisible();
  await expect(player.locator(".amount").last()).toHaveText("43.2 g");
  await player.getByRole("button", { name: "重播", exact: true }).click();
  await expect(rows.first()).toHaveAttribute("aria-current", "step");
  await player.getByRole("button", { name: "损耗批次" }).click();
  await expect(rows.first()).toHaveAttribute("aria-current", "step");
  await expect(
    player.getByRole("button", { name: "播放", exact: true }),
  ).toBeVisible();
});

test("blocked motion stops halfway without activating its receiver; exits update the total", async ({
  page,
}) => {
  await clock(page);
  const player = page.locator(".player").first();
  await player.getByRole("button", { name: "损耗批次" }).click();
  await player.getByRole("button", { name: "步骤 2", exact: true }).click();
  await page.clock.runFor(2300);
  await expect(player.locator(".node").nth(2)).not.toHaveClass(/active/);
  const point = await player.locator(".cutoff circle").evaluate((el) => ({
    x: Number(el.getAttribute("cx")),
    y: Number(el.getAttribute("cy")),
  }));
  const edge = await player.locator("g.active .edge").evaluate((el) => ({
    x: (Number(el.getAttribute("x1")) + Number(el.getAttribute("x2"))) / 2,
    y: (Number(el.getAttribute("y1")) + Number(el.getAttribute("y2"))) / 2,
  }));
  expect(point).toEqual(edge);
  await player.getByRole("button", { name: "步骤 3", exact: true }).click();
  await expect(player.locator(".loss-dot")).toHaveCount(1);
  await page.clock.runFor(2300);
  await expect(player.locator(".amount").nth(1)).toHaveText("80 g");
  await expect(player.locator(".bar .remaining")).toHaveAttribute(
    "style",
    /80%/,
  );
});

test("all frame blocks share keyboard and step navigation, and single frames hide controls", async ({
  page,
}) => {
  await clock(page);
  for (const player of [
    page.locator(".player").nth(1),
    page.locator(".player").nth(2),
  ]) {
    await expect(player.locator("tbody tr")).toHaveCount(2);
    const untitledStep = player.locator("tbody tr").nth(1).locator("td").nth(1);
    await expect(untitledStep.getByText(/\S/)).toBeVisible();
    await player.focus();
    await page.keyboard.press("ArrowRight");
    await expect(player.locator("tbody tr").nth(1)).toHaveAttribute(
      "aria-current",
      "step",
    );
    await page.keyboard.press("Escape");
    await expect(player.locator("tbody tr").first()).toHaveAttribute(
      "aria-current",
      "step",
    );
    await player.getByRole("button", { name: "下一步", exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(player.locator("tbody tr").nth(1)).toHaveAttribute(
      "aria-current",
      "step",
    );
  }
  for (const player of [
    page.locator(".player").nth(3),
    page.locator(".player").nth(4),
  ]) {
    await expect(player.locator(".controls, .trace")).toHaveCount(0);
  }
});

test("narrow containers stack nodes with readable SVG text, and reduced motion shows results", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/sites/minimal/steps");
  const player = page.locator(".player").first();
  await player.getByRole("button", { name: "步骤 3", exact: true }).click();
  await expect(player.locator(".transfer-dot, .loss-dot, .pulse")).toHaveCount(
    0,
  );
  await expect(player.locator(".amount").nth(2)).toHaveText("43.2 g");
  await expect(player.locator(".stage")).toHaveAttribute(
    "data-layout",
    "vertical",
  );
  expect(
    await player.locator("svg text").evaluateAll((elements) =>
      Math.min(
        ...elements.map((el) => {
          const text = el as SVGTextElement;
          const scale = text.getScreenCTM()!;
          return (
            parseFloat(getComputedStyle(text).fontSize) *
            Math.hypot(scale.a, scale.b)
          );
        }),
      ),
    ),
  ).toBeGreaterThanOrEqual(11);
  const nodes = await player.locator(".node rect").evaluateAll((elements) =>
    elements.map((el) => ({
      x: el.getBoundingClientRect().x,
      y: el.getBoundingClientRect().y,
    })),
  );
  expect(
    nodes.every(
      (node, i) =>
        Math.abs(node.x - nodes[0].x) < 1 &&
        (i === 0 || node.y > nodes[i - 1].y),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

test("hidden pages pause motion and the speed control cycles without resetting progress", async ({
  page,
}) => {
  await clock(page);
  const player = page.locator(".player").first();
  await player.focus();
  await page.keyboard.press("Space");
  await page.clock.runFor(500);
  const dot = player.locator(".transfer-dot");
  const x = await dot.getAttribute("cx");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(5000);
  await expect(dot).toHaveAttribute("cx", x!);
  const speed = player.getByRole("button", { name: "播放速度" });
  const initial = await speed.textContent();
  for (let i = 0; i < 4; i++) await speed.click();
  expect(await speed.textContent()).toBe(initial);
  await expect(dot).toHaveAttribute("cx", x!);
});
