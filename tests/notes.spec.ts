import { putRecords } from "./helpers/records.ts";
import { test, expect } from "./helpers/test.ts";
test("aligned structures keep a triple-bond centre linear", async ({
  page,
}) => {
  await page.goto("/notes/reader-test/second");
  const svg = page.getByRole("img", { name: "样品 C二维结构" });
  await expect(svg.locator("path.bond-6").first()).toBeAttached({
    timeout: 45_000,
  });
  const angle = await svg.evaluate((element) => {
    const direction = (selector: string) => {
      const path = element.querySelector(selector)!;
      const values = [
        ...path
          .getAttribute("d")!
          .matchAll(/[ML]\s+(-?[\d.]+)[,\s]+(-?[\d.]+)/g),
      ].map((m) => [Number(m[1]), Number(m[2])]);
      return [values[1][0] - values[0][0], values[1][1] - values[0][1]];
    };
    const a = direction("path.bond-5"),
      b = direction("path.bond-6");
    return (
      (Math.acos(
        Math.min(
          1,
          Math.abs(
            (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b)),
          ),
        ),
      ) *
        180) /
      Math.PI
    );
  });
  expect(angle).toBeLessThan(5);
});

test("vertical bond to nitrogen retains visible length", async ({ page }) => {
  await page.goto("/notes/reader-test/second");
  const svg = page.getByRole("img", { name: "样品 E二维结构" });
  await expect(svg.locator("path.bond-1").first()).toBeAttached({
    timeout: 45_000,
  });
  const visible = await svg.evaluate((element) => {
    const points = (selector: string) =>
      [...element.querySelectorAll(selector)].flatMap((path) =>
        [
          ...path
            .getAttribute("d")!
            .matchAll(/[ML]\s+(-?[\d.]+)[,\s]+(-?[\d.]+)/g),
        ].map((m) => ({ x: Number(m[1]), y: Number(m[2]) })),
      );
    const wedge = points("path.bond-1"),
      adjoining = points("path.bond-0");
    const origin = adjoining.reduce((a, b) => (a.y > b.y ? a : b));
    return Math.max(...wedge.map((p) => Math.abs(p.y - origin.y))) / 14.4;
  });
  expect(visible).toBeGreaterThanOrEqual(0.4);
});

test("two-letter silicon label is centred on its bonds", async ({ page }) => {
  await page.goto("/notes/reader-test/second");
  const svg = page.getByRole("img", { name: "样品 F二维结构" });
  await expect(svg.locator("text.atom-1").first()).toBeAttached({
    timeout: 45_000,
  });
  const offset = await svg.evaluate((element) => {
    const lines = [
      ...element.querySelectorAll(
        "path.bond-0, path.bond-1, path.bond-2, path.bond-3",
      ),
    ].map((path) =>
      [
        ...path
          .getAttribute("d")!
          .matchAll(/[ML]\s+(-?[\d.]+)[,\s]+(-?[\d.]+)/g),
      ].map((m) => ({ x: Number(m[1]), y: Number(m[2]) })),
    );
    const [a, b] = lines[0];
    const second = lines.slice(1).sort((first, second) => {
      const cross = ([c, d]: typeof first) =>
        Math.abs((b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x));
      return cross(second) - cross(first);
    })[0];
    const [c, d] = second,
      ux = b.x - a.x,
      uy = b.y - a.y,
      vx = d.x - c.x,
      vy = d.y - c.y;
    const t = ((c.x - a.x) * vy - (c.y - a.y) * vx) / (ux * vy - uy * vx);
    const atom = { x: a.x + t * ux, y: a.y + t * uy };
    const text = [...element.querySelectorAll<SVGTextElement>("text.atom-1")];
    const canvas = document.createElement("canvas").getContext("2d")!;
    canvas.font = `${text[0].style.fontSize} Arial, Helvetica, sans-serif`;
    const glyphs = text.map((n) => ({
      node: n,
      metric: canvas.measureText(n.textContent ?? ""),
    }));
    const x =
      (Math.min(
        ...glyphs.map(
          ({ node, metric }) =>
            Number(node.getAttribute("x")) - metric.actualBoundingBoxLeft,
        ),
      ) +
        Math.max(
          ...glyphs.map(
            ({ node, metric }) =>
              Number(node.getAttribute("x")) + metric.actualBoundingBoxRight,
          ),
        )) /
      2;
    const y =
      Number(text[0].getAttribute("y")) +
      (glyphs[0].metric.actualBoundingBoxDescent -
        glyphs[0].metric.actualBoundingBoxAscent) /
        2;
    return { x: Math.abs(x - atom.x), y: Math.abs(y - atom.y) };
  });
  expect(offset.x).toBeLessThan(1);
  expect(offset.y).toBeLessThan(1);
});
test("read, inspect a term and retain reading state across browser contexts", async ({
  page,
  browser,
}) => {
  await page.goto("/notes/reader-test/first");
  await expect(
    page.getByRole("heading", { name: "第一篇观察", exact: true }),
  ).toBeVisible();
  await expect(page.locator("figcaption", { hasText: "乙醇" })).toHaveCount(1);
  await page.getByRole("button", { name: "术语：样品" }).click();
  await expect(page.getByText("供观察的对象。", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/records/notes")).json())[
          "/notes/reader-test/first"
        ]?.read,
    )
    .toBe(true);
  await page.reload();
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.goto(new URL("/notes/reader-test/", page.url()).href);
    await expect(
      other.getByText("写于 2026-10-16 · 读过", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
test("mobile reading keeps sources collapsed, supports search and avoids horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/notes/reader-test/first?q=ethanol");
  await expect(
    page.getByRole("heading", { name: "第一篇观察", exact: true }),
  ).toBeVisible();
  await expect(page.locator("details.note-sources")).not.toHaveAttribute(
    "open",
  );
  await expect(
    page.getByText("中性测试样本。", { exact: true }),
  ).not.toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.getByText("资料来源", { exact: true }).first().click();
  await expect(page.getByText("中性测试样本。", { exact: true })).toBeVisible();
});
test("a timeline fence shows as a figure inside the note", async ({ page }) => {
  await page.goto("/notes/reader-test/second");
  const figure = page.locator(".note-diagram figure.timeline");
  await expect(figure.locator(".timeline-label")).toHaveText([
    /2024 年 3 月\s*第一组读数/,
    /2025 年 9 月\s*第二组读数/,
  ]);
  await expect(figure.locator(".timeline-label.timeline--accent")).toHaveCount(
    1,
  );
});
test("the notebook shelf switches sets while the entry filter stays within the current set", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/notes/reader-test/second");
  const sidebar = page.getByRole("navigation", { name: "笔记目录" });
  const shelf = page.getByRole("navigation", { name: "笔记书架" });
  const books = shelf.getByRole("link");
  await expect(books).toHaveCount(1);
  await shelf.getByRole("button").click();
  await expect(books).toHaveCount(2);
  await expect(shelf.locator('[aria-current="true"]')).toHaveAttribute(
    "href",
    "/notes/reader-test/",
  );
  const second = sidebar.locator('[aria-current="page"]');
  await expect(second).toHaveAttribute("href", "/notes/reader-test/second");
  await expect(second.locator(".sidebar-number")).toHaveText("02");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(second.locator('[data-state="read"]')).toHaveCount(1);
  const filter = page.getByRole("searchbox", { name: "筛选篇目" });
  await filter.fill("第一");
  await expect(sidebar.locator(".sidebar-item")).toHaveCount(1);
  await expect(sidebar.locator(".sidebar-item")).toHaveAttribute(
    "href",
    "/notes/reader-test/first",
  );
  await filter.fill("ethanol");
  await sidebar.locator('.notes-hits a[href*="/reader-test/first"]').click();
  await expect(page).toHaveURL(/\/notes\/reader-test\/first\?q=ethanol$/);
  await filter.press("Escape");
  await expect(page).toHaveURL(/\/notes\/reader-test\/first$/);
  await filter.fill("有出处");
  await expect(sidebar.getByRole("link")).toHaveCount(0);
  await expect(books).toHaveCount(2);
  await books.nth(1).click();
  await expect(page).toHaveURL(/\/notes\/cited-reading\/$/);
  await expect(filter).toHaveValue("");
  await expect(books).toHaveCount(1);
  await expect(shelf.locator('[aria-current="true"]')).toHaveAttribute(
    "href",
    "/notes/cited-reading/",
  );
  await expect(sidebar.getByRole("link")).toHaveCount(2);
  await expect(sidebar.getByRole("link").last()).toHaveAttribute(
    "href",
    "/notes/cited-reading/sources",
  );
});

test("author addresses use the unknown-page path without creating reading records", async ({
  page,
}) => {
  await page.goto("/notes/reader-test/author/plan");
  await expect(page.locator(".note-article")).toHaveCount(0);
  await expect(page.locator("main article > p a")).toHaveAttribute(
    "href",
    "/notes/",
  );
  expect(
    Object.keys(await (await page.request.get("/api/records/notes")).json()),
  ).not.toContain("/notes/reader-test/author/plan");
  expect(
    (await page.request.get("/api/notes/reader-test/author/plan")).status(),
  ).toBe(404);
});

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`shelf and current entries remain accessible at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/records/notes", (route) =>
      route.fulfill({
        json: {
          "/notes/reader-test/first": { opened: 200, read: true },
          "/notes/cited-reading/sources": { opened: 100, read: true },
        },
      }),
    );
    await page.goto("/notes/cited-reading/sources");
    if (viewport.width < 960)
      await page
        .locator('.notes-subbar button[aria-haspopup="dialog"]')
        .click();
    const shelf = page.locator(".sidebar-shelf");
    await expect(shelf.getByRole("link")).toHaveCount(1);
    await shelf.getByRole("button").click();
    await expect(shelf.getByRole("link")).toHaveCount(2);
    await expect(shelf.locator('[aria-current="true"]')).toHaveAttribute(
      "href",
      "/notes/cited-reading/",
    );
    await expect(shelf.locator(".shelf-progress")).toHaveText(["1/1", "1/2"]);
    await expect(
      page.locator('.section-sidebar-scroll [aria-current="page"]'),
    ).toBeInViewport({ ratio: 1 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (viewport.width < 960) {
      await shelf.locator('a[href="/notes/reader-test/"]').click();
      await expect(page.getByRole("dialog", { name: "笔记目录" })).toBeHidden();
      await expect(page).toHaveURL(/\/notes\/reader-test\/$/);
    }
  });
}

test("a long current notebook scrolls its entries without moving the shelf or filter", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/notes", async (route) => {
    const response = await route.fetch();
    const notebook = await response.json();
    const sample = notebook.notes.find(
      (note: { path: string }) => note.path === "/notes/reader-test/second",
    );
    for (let order = 3; order <= 30; order++)
      notebook.notes.push({
        ...sample,
        slug: `entry-${order}`,
        path: `/notes/reader-test/entry-${order}`,
        title: `观察记录 ${order}`,
        order,
      });
    await route.fulfill({ json: notebook });
  });
  await page.goto("/notes/reader-test/entry-30");
  await page.locator('.notes-subbar button[aria-haspopup="dialog"]').click();
  await page
    .getByRole("dialog")
    .evaluate((element) =>
      Promise.all(element.getAnimations().map((motion) => motion.finished)),
    );
  const current = page.locator('.section-sidebar-scroll [aria-current="page"]');
  await expect(current).toBeInViewport({ ratio: 1 });
  const shelf = page.locator(".sidebar-shelf");
  const filter = page.getByRole("searchbox", { name: "筛选篇目" });
  const before = [await shelf.boundingBox(), await filter.boundingBox()];
  const scroller = page.locator(".section-sidebar-scroll");
  expect(
    await scroller.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  await scroller.evaluate((element) => {
    element.scrollTop = 0;
  });
  expect([await shelf.boundingBox(), await filter.boundingBox()]).toEqual(
    before,
  );
  await expect(shelf.getByRole("link").last()).toBeInViewport({ ratio: 1 });
});

test("notebook requests metadata and current body only, retries body, then lazily searches direct query links", async ({
  page,
}) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "GET")
      requested.push(new URL(request.url()).pathname);
  });
  let fail = true;
  await page.route("**/api/notes/reader-test/first", async (route) => {
    if (fail) {
      fail = false;
      await route.fulfill({ status: 503, json: { error: "offline" } });
    } else await route.continue();
  });
  await page.goto("/notes/reader-test/first");
  await expect(page.getByRole("alert")).toBeVisible();
  expect(requested).not.toContain("/api/index");
  expect(requested).not.toContain("/api/notes/reader-test/second");
  await page.getByRole("alert").getByRole("button").click();
  await expect(page.locator(".compiled-prose")).toBeVisible();
  if (process.env.MOLNOTES_VISUAL_DIR) {
    await expect(page.locator(".note-molecules svg.structure")).toBeVisible();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(process.env.MOLNOTES_VISUAL_DIR, { recursive: true });
    for (const [label, width, height] of [
      ["desktop", 1366, 900],
      ["mobile", 390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${process.env.MOLNOTES_VISUAL_DIR}/${label}-notebook-body.png`,
      });
    }
    await page.setViewportSize({ width: 1366, height: 900 });
  }
  const metadata = await (await page.request.get("/api/notes")).json();
  expect(
    metadata.notes.every(
      (note: Record<string, unknown>) => !("html" in note) && !("text" in note),
    ),
  ).toBe(true);
  await page.goto("/notes/reader-test/first?q=ethanol");
  await expect(
    page.locator('.notes-hits a[href*="/reader-test/first"]'),
  ).toHaveCount(1);
  await expect(page.locator("mark[data-match]").first()).toBeVisible();
  expect(requested).toContain("/api/index");
  await page.locator(".pager a").click();
  await expect(page).toHaveURL(/\/notes\/reader-test\/second$/);
  await expect(page.locator(".compiled-prose")).toBeVisible();
  expect(requested).toContain("/api/notes/reader-test/second");
});

test("async body restores a direct hash and device reading position", async ({
  page,
}) => {
  const response = await page.request.get("/api/notes/reader-test/first");
  const body = await response.json();
  const section = body.sections.at(-1).id;
  await page.route("**/api/notes/reader-test/first", async (route) => {
    const result = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await route.fulfill({ response: result });
  });
  await page.goto(`/notes/reader-test/first#${encodeURIComponent(section)}`);
  await expect(page.locator(`details:has(#${section})`)).toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator(`#${section}`)).toBeInViewport();
  await page.addInitScript(() =>
    localStorage.setItem("notes/scroll:/notes/reader-test/first", "160"),
  );
  await page.goto("/notes/reader-test/first");
  await expect(page.locator(".compiled-prose")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(100);
});

test("two notebook tabs preserve opened and read entries for different notes", async ({
  page,
  context,
}) => {
  const endpoint = "/api/records/notes";
  await putRecords(page.request, endpoint, { data: {} });
  await page.goto("/notes/reader-test/first");
  await expect(page.locator(".compiled-prose")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(endpoint)).json())[
          "/notes/reader-test/first"
        ]?.opened ?? 0,
    )
    .toBeGreaterThan(0);
  const other = await context.newPage();
  try {
    await other.goto("/notes/reader-test/second");
    await expect(other.locator(".compiled-prose")).toBeVisible();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(endpoint)).json())[
            "/notes/reader-test/second"
          ]?.opened ?? 0,
      )
      .toBeGreaterThan(0);
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect
      .poll(
        async () =>
          (await (await page.request.get(endpoint)).json())[
            "/notes/reader-test/first"
          ]?.read,
      )
      .toBe(true);
    await other.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await expect
      .poll(
        async () =>
          (await (await page.request.get(endpoint)).json())[
            "/notes/reader-test/second"
          ]?.read,
      )
      .toBe(true);
    const saved = await (await page.request.get(endpoint)).json();
    for (const slug of ["first", "second"]) {
      expect(saved[`/notes/reader-test/${slug}`].opened).toBeGreaterThan(0);
      expect(saved[`/notes/reader-test/${slug}`].read).toBe(true);
    }
  } finally {
    await other.close();
  }
});
