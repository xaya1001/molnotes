import { putRecords } from "./helpers/records";
import { test, expect } from "./helpers/test";
test.describe.configure({ mode: "serial" });
test.beforeEach(async ({ request }) => {
  await putRecords(request, "/api/records/topics/sample", {
    data: {
      version: 1,
      complete: [],
      bookmarks: [],
      notes: {},
      answers: {},
      diagnostic: {},
      predictions: {},
      problems: {},
      path: "all",
    },
  });
});
test("prediction survives reload and a fresh browser; review exports the shared records", async ({
  page,
  browser,
}) => {
  await page.goto("/practice/sample/start");
  await expect(
    page.getByRole("heading", { name: "样品预测", exact: true }),
  ).toBeVisible();
  const exercise = page.getByTestId("prediction-start");
  await exercise.getByRole("radio", { name: "A", exact: true }).check();
  await exercise.getByRole("button", { name: "提交预测" }).click();
  await expect(exercise).toContainText("A 有两个，B 有一个。");
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/records/topics/sample")).json())
          .predictions.start?.option,
      { intervals: [100] },
    )
    .toBe(0);
  await page.reload();
  await expect(exercise).toContainText("A 有两个，B 有一个。");
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.goto(new URL("/practice/sample/start", page.url()).href);
    await expect(other.getByTestId("prediction-start")).toContainText(
      "A 有两个，B 有一个。",
    );
  } finally {
    await context.close();
  }
  await page.goto("/review/");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出/ }).click();
  expect((await download).suggestedFilename()).toMatch(/molnotes-records/);
});

test("failed saves preserve the answer and can be retried", async ({
  page,
}) => {
  await page.goto("/practice/sample/start");
  await page.route("**/api/records/topics/sample", async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({ status: 503, json: { error: "暂时无法保存" } });
    else await route.continue();
  });
  const exercise = page.getByTestId("prediction-start");
  await exercise.getByRole("radio", { name: "B", exact: true }).check();
  await exercise.getByRole("button", { name: "提交预测" }).click();
  await expect(page.getByRole("alert")).toContainText("未保存");
  await expect(exercise).toContainText("A 有两个，B 有一个。");
  await page.unroute("**/api/records/topics/sample");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(exercise).toContainText("A 有两个，B 有一个。");
  expect(
    (await (await page.request.get("/api/records/topics/sample")).json())
      .predictions.start.option,
  ).toBe(1);
});

test("typing a chapter note saves the complete text in one debounced request", async ({
  page,
}) => {
  // Opening the chapter saves it as the most recent one first.
  const opened = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith("/api/records/topics/sample"),
  );
  await page.goto("/practice/sample/start");
  await opened;
  const note = page.getByRole("textbox", { name: "我的笔记" });
  await expect(note).toBeVisible();
  let writes = 0;
  page.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      request.url().endsWith("/api/records/topics/sample")
    )
      writes++;
  });
  await note.pressSequentially("compare samples", { delay: 15 });
  expect(writes).toBe(0);
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/records/topics/sample")).json())
          .notes.start,
      { intervals: [100] },
    )
    .toBe("compare samples");
  expect(writes).toBe(1);
  await page.reload();
  await expect(note).toHaveValue("compare samples");
});

test("open responses and prediction mistakes enter review and leave after correction", async ({
  page,
  browser,
}) => {
  await page.goto("/practice/sample/next");
  const problem = page.getByTestId("problem-compare-zh");
  const reveal = problem.getByRole("button").first();
  await expect(reveal).toHaveAttribute("aria-expanded", "false");
  await expect(problem.locator(".problem-answer")).toHaveCount(0);
  await problem.getByRole("textbox").fill("在同一区域计数，相差一个。");
  await reveal.click();
  await expect(problem.locator(".problem-answer")).toBeVisible();
  await problem.getByRole("group").getByRole("button").nth(1).click();
  await expect(
    problem.getByRole("group").getByRole("button").nth(1),
  ).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/records/topics/sample")).json())
          .problems["compare-zh"],
      { intervals: [100] },
    )
    .toEqual({ response: "在同一区域计数，相差一个。", rating: "unknown" });
  await page.reload();
  await expect(problem.getByRole("textbox")).toHaveValue(
    "在同一区域计数，相差一个。",
  );
  await reveal.click();
  await expect(
    problem.getByRole("group").getByRole("button").nth(1),
  ).toHaveAttribute("aria-pressed", "true");
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.goto(new URL("/practice/sample/next", page.url()).href);
    await expect(
      other.getByTestId("problem-compare-zh").getByRole("textbox"),
    ).toHaveValue("在同一区域计数，相差一个。");
  } finally {
    await context.close();
  }
  await page.goto("/practice/sample/start");
  const prediction = page.getByTestId("prediction-start");
  await expect(page.locator("#counting-evidence")).toHaveCount(0);
  await prediction.getByRole("radio").nth(1).check();
  await prediction.getByRole("button").click();
  await expect(prediction.locator("#counting-evidence blockquote")).toHaveText(
    "Sample A: two objects. Sample B: one object.",
  );
  await expect(prediction.locator(".option-explanations > li")).toHaveCount(2);
  await expect(prediction.locator('[data-correct="true"]')).toHaveCount(1);
  await expect(prediction.locator('[data-chosen="true"]')).toHaveCount(1);
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/records/topics/sample")).json())
          .predictions.start?.option,
      { intervals: [100] },
    )
    .toBe(1);
  await page.goto("/review/");
  await expect(page.locator(".mistake")).toHaveCount(2);
  await expect(
    page.getByTestId("mistake-prediction-start").locator(".mistake-question"),
  ).toHaveText([
    "在同一观察范围内计数：A 有两个，B 有一个。",
    "哪个样品更多？",
  ]);
  const openMistake = page.getByTestId("mistake-problem-compare-zh");
  await expect(openMistake.locator("dd")).toHaveText(
    "在同一区域计数，相差一个。",
  );
  await expect(
    page.getByTestId("mistake-prediction-start").locator("dd"),
  ).toHaveText(["B", "A"]);
  await openMistake.getByRole("link").click();
  await problem.getByRole("button").first().click();
  await problem.getByRole("group").getByRole("button").first().click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/records/topics/sample")).json())
          .problems["compare-zh"].rating,
      { intervals: [100] },
    )
    .toBe("know");
  await page.goto("/practice/sample/start");
  await prediction.getByRole("button").click();
  await prediction.getByRole("radio").first().check();
  await prediction.getByRole("button").click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/records/topics/sample")).json())
          .predictions.start?.option,
      { intervals: [100] },
    )
    .toBe(0);
  await page.goto("/review/");
  await expect(page.locator(".mistake")).toHaveCount(0);
});

test("open response saves can be retried and the server rejects invalid entries", async ({
  page,
}) => {
  await page.goto("/practice/sample/next");
  await page.route("**/api/records/topics/sample", async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({ status: 503, json: { error: "unavailable" } });
    else await route.continue();
  });
  const problem = page.getByTestId("problem-compare-en");
  await problem.getByRole("textbox").fill("Count each object once.");
  await problem.getByRole("button").first().click();
  await problem.getByRole("group").getByRole("button").nth(1).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute("**/api/records/topics/sample");
  await page.getByRole("alert").getByRole("button").click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(problem.getByRole("textbox")).toHaveValue(
    "Count each object once.",
  );
  const record = await (
    await page.request.get("/api/records/topics/sample")
  ).json();
  for (const problems of [
    { invalid: { response: "x" } },
    { "compare-en": { response: "x", rating: "bad" } },
  ]) {
    const result = await putRecords(
      page.request,
      "/api/records/topics/sample",
      {
        data: { ...record, problems },
      },
    );
    expect(result.status()).toBe(400);
  }
});

test("answered English and Chinese problems and review fit reading viewports", async ({
  page,
}) => {
  const { mkdir } = await import("node:fs/promises");
  const output = process.env.MOLNOTES_VISUAL_DIR;
  if (output) await mkdir(output, { recursive: true });
  await page.goto("/practice/sample/next");
  for (const id of ["compare-zh", "compare-en"]) {
    const problem = page.getByTestId(`problem-${id}`);
    await problem
      .getByRole("textbox")
      .fill(
        id === "compare-zh"
          ? "相同观察范围内逐一计数，多一个。"
          : "Count each visible object once and record any uncertainty.",
      );
    await problem.getByRole("button").first().click();
    await problem.getByRole("group").getByRole("button").nth(1).click();
  }
  await expect
    .poll(
      async () =>
        Object.keys(
          (await (await page.request.get("/api/records/topics/sample")).json())
            .problems,
        ).length,
      { intervals: [100] },
    )
    .toBe(2);
  for (const [label, width, height] of [
    ["desktop", 1366, 900],
    ["mobile", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const id of ["compare-zh", "compare-en"]) {
      const problem = page.getByTestId(`problem-${id}`);
      await expect(problem).toHaveAttribute(
        "lang",
        id.endsWith("en") ? "en" : "zh",
      );
      await problem.evaluate((element) =>
        element.scrollIntoView({ block: "start" }),
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (output)
        await page.screenshot({ path: `${output}/${label}-${id}-prompt.png` });
      await problem.locator(".problem-rating").scrollIntoViewIfNeeded();
      if (output)
        await page.screenshot({ path: `${output}/${label}-${id}-answer.png` });
    }
  }
  await page.goto("/review/");
  await expect(page.locator(".mistake")).toHaveCount(2);
  for (const [label, width, height] of [
    ["desktop", 1366, 900],
    ["mobile", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.locator("#mistakes-title").scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (output)
      await page.screenshot({ path: `${output}/${label}-review.png` });
    await page
      .getByTestId("mistake-problem-compare-en")
      .scrollIntoViewIfNeeded();
    if (output)
      await page.screenshot({ path: `${output}/${label}-review-en.png` });
  }
});

test("structure prediction mistakes remain visible alongside saved matrix answers", async ({
  page,
  request,
}) => {
  const seed = {
    version: 1,
    complete: [],
    bookmarks: [],
    notes: {},
    answers: {},
    diagnostic: {},
    predictions: {
      instruments: { selected: [0] },
      grid: { cells: { "a:x": 0 } },
    },
    problems: {},
  };
  const result = await putRecords(request, "/api/records/topics/instruments", {
    data: seed,
  });
  expect(result.ok()).toBe(true);
  try {
    await page.goto("/review/");
    const mistake = page.getByTestId("mistake-prediction-instruments");
    await expect(mistake).toBeVisible();
    await expect(mistake.locator("dl")).toHaveCount(0);
    await expect(mistake.getByRole("link")).toHaveAttribute(
      "href",
      "/sites/instruments/instruments",
    );
    await putRecords(request, "/api/records/topics/instruments", {
      data: {
        ...seed,
        predictions: { ...seed.predictions, instruments: { selected: [2] } },
      },
    });
    await page.reload();
    await expect(mistake).toHaveCount(0);
  } finally {
    await putRecords(request, "/api/records/topics/instruments", {
      data: { ...seed, predictions: {} },
    });
  }
});

test("the topic sidebar marks each chapter's read state, bookmark and open mistakes", async ({
  page,
  request,
}) => {
  const empty = {
    version: 1,
    complete: [],
    bookmarks: [],
    notes: {},
    answers: {},
    diagnostic: {},
    predictions: {},
    problems: {},
    path: "all",
  };
  await putRecords(request, "/api/records/topics/sample", {
    data: {
      ...empty,
      complete: ["start"],
      bookmarks: ["next"],
      answers: { q1: 1 },
      predictions: { start: { option: 1 } },
      problems: { "compare-zh": { response: "", rating: "unknown" } },
    },
  });
  try {
    await page.goto("/practice/sample/next");
    const toc = page.getByRole("navigation", { name: "专题目录" });
    const start = toc.getByRole("link", { name: /样品预测/ });
    const next = toc.getByRole("link", { name: /继续观察/ });
    await expect(start.locator('[data-state="read"]')).toHaveCount(1);
    await expect(start.locator('[data-state="bookmarked"]')).toHaveCount(0);
    await expect(start.locator('[data-state="mistakes"]')).toContainText("2");
    await expect(next.locator('[data-state="read"]')).toHaveCount(0);
    await expect(next.locator('[data-state="bookmarked"]')).toHaveCount(1);
    await expect(next.locator('[data-state="mistakes"]')).toContainText("1");
    await expect(next).toHaveAttribute("aria-current", "page");
  } finally {
    await putRecords(request, "/api/records/topics/sample", { data: empty });
  }
});

test("two tabs retain same-field input and explicitly resolve without losing unrelated remote edits", async ({
  page,
  context,
}) => {
  const endpoint = "/api/records/topics/sample";
  const opened = (tab: typeof page) =>
    tab.waitForResponse(
      (response) =>
        response.url().endsWith(endpoint) &&
        response.request().method() === "PUT" &&
        response.ok(),
    );
  await Promise.all([opened(page), page.goto("/practice/sample/start")]);
  const other = await context.newPage();
  await Promise.all([opened(other), other.goto("/practice/sample/start")]);
  const first = page.getByRole("textbox", { name: "我的笔记" }),
    second = other.getByRole("textbox", { name: "我的笔记" });
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await first.fill("first tab");
  await expect
    .poll(
      async () => (await (await page.request.get(endpoint)).json()).notes.start,
      { intervals: [100] },
    )
    .toBe("first tab");
  await second.fill("second tab unsaved");
  await expect(other.getByRole("alert")).toBeVisible();
  await expect(second).toHaveValue("second tab unsaved");
  if (process.env.MOLNOTES_VISUAL_DIR) {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(process.env.MOLNOTES_VISUAL_DIR, { recursive: true });
    for (const [label, width, height] of [
      ["desktop", 1366, 900],
      ["mobile", 390, 844],
    ] as const) {
      await other.setViewportSize({ width, height });
      await other.getByRole("alert").scrollIntoViewIfNeeded();
      await other.screenshot({
        path: `${process.env.MOLNOTES_VISUAL_DIR}/${label}-topic-conflict.png`,
      });
    }
  }

  const latest = await (await page.request.get(endpoint)).json();
  await putRecords(page.request, endpoint, {
    data: { ...latest, bookmarks: ["next"] },
  });
  await other.getByRole("alert").getByRole("button").click();
  await expect(other.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(
      async () => (await (await page.request.get(endpoint)).json()).notes.start,
      { intervals: [100] },
    )
    .toBe("second tab unsaved");
  expect((await (await page.request.get(endpoint)).json()).bookmarks).toEqual([
    "next",
  ]);
  await other.close();
});

test("input during a merged save retains remote fields and pauses for explicit resolution", async ({
  page,
}) => {
  const endpoint = "/api/records/topics/sample";
  await page.goto("/practice/sample/start");
  const note = page.getByRole("textbox", { name: "我的笔记" });
  await expect(note).toBeVisible();
  const latest = await (await page.request.get(endpoint)).json();
  await putRecords(page.request, endpoint, {
    data: {
      ...latest,
      notes: { start: "remote note", next: "remote unrelated" },
    },
  });
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  await page.route("**" + endpoint, async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    if (response.ok() && !held) {
      held = true;
      entered();
      await gate;
    }
    await route.fulfill({ response });
  });
  // A chapter completion changes independently from the remote note.
  await page.getByRole("button", { name: "标记已读", exact: true }).click();
  await waiting;
  await note.fill("typed during response");
  release();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(note).toHaveValue("typed during response");
  await page.getByRole("alert").getByRole("button").click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect
    .poll(
      async () => (await (await page.request.get(endpoint)).json()).notes.start,
      { intervals: [100] },
    )
    .toBe("typed during response");
  expect((await (await page.request.get(endpoint)).json()).notes.next).toBe(
    "remote unrelated",
  );
});

test("records incompatible with republished content fail explicitly before editing", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT") writes.push(request.url());
  });
  await page.route("**/api/records/topics/sample", async (route) => {
    const response = await route.fetch();
    const saved = await response.json();
    await route.fulfill({
      response,
      json: { ...saved, complete: ["removed-chapter"] },
    });
  });
  await page.goto("/practice/sample/start");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "我的笔记" })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("unsent topic notes recover after leaving and reloading, then save on retry", async ({
  page,
}) => {
  const endpoint = "/api/records/topics/sample";
  await page.route("**" + endpoint, (route) =>
    route.request().method() === "PUT" ? route.abort() : route.fallback(),
  );
  await page.goto("/practice/sample/start");
  const note = page.getByRole("textbox", { name: "我的笔记" });
  await note.fill("pending across navigation");
  await page.goto("/review/");
  // Recovery saves the draft, then opening the chapter saves its new visit.
  // Keep both offline before restoring the network and using the retry button.
  const returningAt = Date.now();
  const visitFailed = page.waitForEvent("requestfailed", {
    predicate: (request) =>
      request.method() === "PUT" &&
      request.url().endsWith(endpoint) &&
      request.postDataJSON().recent?.opened >= returningAt,
  });
  await page.goto("/practice/sample/start");
  await visitFailed;
  await expect(note).toHaveValue("pending across navigation");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute("**" + endpoint);
  await page.getByRole("alert").getByRole("button").click();
  await expect
    .poll(
      async () => (await (await page.request.get(endpoint)).json()).notes.start,
      { intervals: [100] },
    )
    .toBe("pending across navigation");
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem("molnotes/pending:/api/records/topics/sample"),
      ),
    )
    .toBeNull();
});
