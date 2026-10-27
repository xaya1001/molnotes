import { expect, test } from "./helpers/test";

test("a timeline places dates in proportion and labels apart; narrow screens read it as a list", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/showcase/diagrams");
  const lanes = page.locator("figure.timeline").first();
  await expect(lanes.locator("svg circle").first()).toBeAttached();
  const ticks = await lanes
    .locator(".timeline-tick")
    .evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.map((n) => [n.textContent!.trim(), Number(n.getAttribute("x"))]),
      ),
    );
  const dots = await lanes
    .locator("svg circle")
    .evaluateAll((nodes) => nodes.map((n) => Number(n.getAttribute("cx"))));
  // Lane 2 starts with its 2012 event, after lane 1's three events.
  expect(dots[3]).toBeCloseTo(ticks["2012"], 1);
  // The undated event sits midway between 2014 and 2017.
  expect(dots[4]).toBeCloseTo(
    ticks["2014"] + (1.5 * (ticks["2016"] - ticks["2014"])) / 2,
    0,
  );
  const boxes = await lanes.locator(".timeline-label").evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return [r.left, r.top, r.right, r.bottom];
    }),
  );
  for (const [i, a] of boxes.entries())
    for (const b of boxes.slice(i + 1))
      expect(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]).toBe(
        true,
      );

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(lanes.locator(".timeline-list li")).toHaveCount(10);
  await expect(lanes.locator("svg")).toHaveCount(0);
});

// The showcase's joining flow: three sources join, a side exit, a question that splits.
const branching = {
  nodes: [
    { id: "start", text: "样品", kind: "end" },
    { id: "a", text: "来源甲" },
    { id: "b", text: "来源乙" },
    { id: "c", text: "来源丙" },
    { id: "pool", text: "合并后复测" },
    { id: "out", text: "剔除干扰", kind: "note", tone: "muted" },
    { id: "ask", text: "活性仍在？", kind: "ask" },
    { id: "keep", text: "进入下一轮", kind: "end", tone: "accent" },
    { id: "drop", text: "放弃", tone: "muted" },
  ],
  edges: [
    "start > a",
    "start > b",
    "start > c",
    { from: ["a", "b", "c"], to: "pool" },
    { from: "pool", to: "out", side: true },
    "pool > ask",
    { from: "ask", to: "keep", text: "是" },
    { from: "ask", to: "drop", text: "否" },
  ],
};

test("a flow runs across a wide page and down a phone, its side exit beside its source", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/showcase/diagrams");
  const flow = page.locator("figure.flow").nth(1);
  await expect(flow.locator(".flow-node")).toHaveCount(9);
  await expect(flow.locator(".flow-node--ask")).toHaveCount(1);
  await expect(flow.locator(".flow-label")).toHaveCount(2);
  const boxes = async () =>
    Object.fromEntries(
      await flow.locator(".flow-node").evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.querySelector(".flow-box")!.getBoundingClientRect();
          return [n.textContent!.trim(), [r.left, r.top, r.right, r.bottom]];
        }),
      ),
    );
  for (const [width, along] of [
    [1366, 0],
    [390, 1],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await expect(flow).toHaveClass(
      width === 1366 ? /flow--right/ : /flow--down/,
    );
    const b = await boxes();
    // Each step lies past the one before it along the flow.
    for (const [from, to] of [
      ["样品", "来源乙"],
      ["来源乙", "合并后复测"],
      ["合并后复测", "活性仍在？"],
      ["活性仍在？", "放弃"],
    ])
      expect(b[from][along + 2]).toBeLessThan(b[to][along]);
    // The side exit hangs off its source and takes no step of its own.
    const out = b["剔除干扰"];
    const pool = b["合并后复测"];
    expect(out[along]).toBeLessThan(pool[along + 2]);
    expect(pool[along]).toBeLessThan(out[along + 2]);
  }
});

test("the preview page finds no layout problems in the sample flows", async ({
  page,
}) => {
  const chain = {
    over: "从取样到回到同一位病人：几个星期",
    nodes: [
      { id: "take", text: "取样", tag: "病人" },
      { id: "split", text: "分离细胞" },
      { id: "change", text: "改造" },
      { id: "grow", text: "体外扩增 9 到 11 天", tone: "accent" },
      { id: "test", text: "检测" },
      { id: "back", text: "回输", tag: "病人" },
      { id: "follow", text: "随访" },
    ],
    edges: [
      "take > split > change > grow > test > back",
      { from: "back", to: "follow", dashed: true },
    ],
    note: "每位病人一批，没有库存",
  };
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(
      (values) => {
        window.__previewFigures = values.map((value, i) => ({
          where: `flow ${i + 1}`,
          kind: "flow",
          value,
          caption: "",
        }));
      },
      [chain, branching],
    );
    await page.goto("/showcase/preview");
    await page.waitForFunction(() => window.__previewResult);
    expect(await page.evaluate(() => window.__previewResult)).toEqual([
      { where: "flow 1", warnings: [] },
      { where: "flow 2", warnings: [] },
    ]);
    // The chain wraps into rows rather than one column down the page.
    const rows = await page
      .locator("figure.flow")
      .first()
      .locator(".flow-box")
      .evaluateAll((boxes) =>
        boxes.map((b) => {
          const r = b.getBoundingClientRect();
          return Math.round(r.top + r.height / 2);
        }),
      );
    expect(new Set(rows).size).toBeLessThan(rows.length);
  }
});

test("notes and an aligned column stand beside the main line on a wide page and fold under it on a phone", async ({
  page,
}) => {
  const flow = {
    direction: "down",
    nodes: [
      { id: "start", text: "起点：两个读数相差很多", kind: "end" },
      { id: "one", text: "第一步：换一种条件复测一次" },
      {
        id: "oneSays",
        text: "读数跟着变：差距来自条件，不是分子本身的问题",
        kind: "note",
      },
      { id: "two", text: "第二步：测另一项性质，算出比值" },
      { id: "ex0", text: "例：起点的两个读数相差两百倍", tone: "muted" },
      { id: "ex1", text: "例：换条件以后相差缩小到三十倍", tone: "muted" },
      { id: "ex2", text: "例：比值明显偏大，找到可疑位点", tone: "accent" },
    ],
    edges: [
      "start > one > two",
      { from: "one", to: "oneSays", side: true },
      "ex0 > ex1 > ex2",
    ],
  };
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((value) => {
      window.__previewFigures = [
        { where: "fold", kind: "flow", value, caption: "" },
      ];
    }, flow);
    await page.goto("/showcase/preview");
    await page.waitForFunction(() => window.__previewResult);
    expect(await page.evaluate(() => window.__previewResult)).toEqual([
      { where: "fold", warnings: [] },
    ]);
    const box = async (text: string) =>
      page
        .locator(".flow-box", { hasText: text })
        .evaluate((n) => n.getBoundingClientRect().toJSON());
    const one = await box("第一步");
    const says = await box("读数跟着变");
    if (width === 1366) expect(says.left).toBeGreaterThan(one.right);
    else {
      expect(says.top).toBeGreaterThan(one.bottom);
      expect(says.left).toBeGreaterThan(one.left);
    }
  }
});

test("the preview page finds no layout problems in a crowded dated timeline", async ({
  page,
}) => {
  // Eight events in twelve years, four of them within four years, with long
  // labels and an undated pair: the case where leaders used to cross labels.
  const timeline = {
    axis: { from: 1964, to: 1976, every: 2 },
    events: [
      { date: 1964, text: "建立动物模型（麻醉大鼠，测化合物抑制多少胃酸）" },
      {
        date: "1968-01",
        show: "1968 年初",
        text: "主管决定：再给一年",
        accent: true,
      },
      { between: [1968, 1970], text: "回头看最初的类似物：部分激动" },
      { date: 1970, text: "第一个拮抗剂：只阻断不激动，注射有效，口服不行" },
      {
        between: [1970, 1972],
        text: "第二个化合物：可以口服；出现副作用，放弃",
      },
      { date: 1972, text: "受体命名（在人身上证明）\n候选化合物合成" },
      { date: 1976, text: "候选化合物上市", accent: true },
    ],
    spans: [
      { from: 1964, to: 1968, text: "4 年，200 多个类似物，没有一个达标" },
    ],
    brackets: [{ from: 1964, to: 1976, text: "12 年" }],
  };
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((value) => {
      window.__previewFigures = [
        { where: "sample", kind: "timeline", value, caption: "" },
      ];
    }, timeline);
    await page.goto("/showcase/preview");
    await page.waitForFunction(() => window.__previewResult);
    expect(await page.evaluate(() => window.__previewResult)).toEqual([
      { where: "sample", warnings: [] },
    ]);
  }
});

test("a monthly timeline with shapes, a legend and an accented marker lays out cleanly at both widths", async ({
  page,
}) => {
  // Dense dates within one year in two lanes: month ticks, every mark shape,
  // a marker with a line under the axis.
  const timeline = {
    markers: [{ date: "2023-06-15", below: "中期分析", accent: true }],
    lanes: [
      {
        label: "试验甲",
        events: [
          { date: "2023-02-01", mark: "diamond", text: "首例入组" },
          { date: "2023-02-20", text: "第一批数据，比预想的早" },
          { date: "2023-03-05", mark: "ring", text: "方案修订" },
          {
            date: "2023-09-12",
            mark: "square",
            accent: true,
            text: "达到终点",
          },
        ],
      },
      {
        label: "试验乙",
        events: [
          { date: "2023-01-10", mark: "diamond", text: "首例入组" },
          { date: "2023-07-01", mark: "ring", text: "暂停入组（安全性审查）" },
          { date: "2023-07-20", mark: "ring", text: "恢复入组" },
          { date: "2023-11-30", mark: "square", text: "未达终点" },
        ],
      },
    ],
    legend: [
      { mark: "diamond", text: "开始" },
      { mark: "ring", text: "调整" },
      { mark: "square", text: "结果" },
    ],
  };
  for (const width of [1366, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((value) => {
      window.__previewFigures = [
        { where: "sample", kind: "timeline", value, caption: "" },
      ];
    }, timeline);
    await page.goto("/showcase/preview");
    await page.waitForFunction(() => window.__previewResult);
    expect(await page.evaluate(() => window.__previewResult)).toEqual([
      { where: "sample", warnings: [] },
    ]);
    const figure = page.locator("figure.timeline");
    await expect(figure.locator(".timeline-legend-item")).toHaveCount(3);
    if (width === 1366) {
      await expect(figure.locator(".timeline-tick")).toHaveText([
        "2023 年",
        "2 月",
        "3 月",
        "4 月",
        "5 月",
        "6 月",
        "7 月",
        "8 月",
        "9 月",
        "10 月",
        "11 月",
        "12 月",
      ]);
      await expect(
        figure.locator(".timeline-lines rect.timeline-dot"),
      ).toHaveCount(4);
      await expect(
        figure.locator(".timeline-lines .timeline-dot--ring"),
      ).toHaveCount(3);
      await expect(
        figure.locator(".timeline-marker.timeline--accent").first(),
      ).toBeAttached();
    } else {
      await expect(figure.locator("li.timeline-row--diamond")).toHaveCount(2);
      await expect(figure.locator("li.timeline-row--ring")).toHaveCount(3);
      await expect(
        figure.locator("li.timeline-row--marker.timeline--accent"),
      ).toHaveCount(2);
    }
  }
});
