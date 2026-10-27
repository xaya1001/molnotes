import assert from "node:assert/strict";
import { test } from "node:test";
import { defineTimeline, timelineText } from "../src/ui/diagrams/model.ts";

const two = [
  { date: 2003, text: "起步" },
  { date: 2014, text: "获批" },
];

test("an axis ticks by year, at listed years, not at all, or by month under a year", () => {
  assert.deepEqual(
    defineTimeline({ events: two }).ticks.map((t) => t.text),
    ["2004", "2006", "2008", "2010", "2012", "2014"],
  );
  assert.deepEqual(
    defineTimeline({ axis: { ticks: [2003, 2006, 2013] }, events: two }).ticks,
    [
      { at: 2003, text: "2003" },
      { at: 2006, text: "2006" },
      { at: 2013, text: "2013" },
    ],
  );
  assert.deepEqual(
    defineTimeline({ axis: { ticks: "none" }, events: two }).ticks,
    [],
  );
  // Dates within a year get a monthly axis and dates without the year.
  const months = defineTimeline({
    events: [
      { date: "2026-04-01", text: "甲" },
      { date: "2026-08-13", text: "乙" },
      { date: "2026-10", show: "十月", text: "丙" },
    ],
  });
  assert.deepEqual(
    months.ticks.map((t) => t.text),
    ["4 月", "5 月", "6 月", "7 月", "8 月", "9 月", "10 月", "11 月"],
  );
  assert.deepEqual(
    months.lanes[0].events.map((e) => e.show),
    ["4 月 1 日", "8 月 13 日", "十月"],
  );
  // Across a new year the January tick names the year, and dates keep theirs.
  const across = defineTimeline({
    axis: { from: "2025-11", to: "2026-03", ticks: "month" },
    events: [{ date: "2026-02-03", text: "甲" }],
  });
  assert.deepEqual(
    across.ticks.map((t) => t.text),
    ["11 月", "12 月", "2026 年", "2 月", "3 月"],
  );
  assert.equal(across.lanes[0].events[0].show, "2026 年 2 月 3 日");
  for (const [axis, message] of [
    [{ ticks: [2001] }, /tick 2001 is outside the axis/],
    [{ ticks: [2005.5] }, /whole years/],
    [{ ticks: "weekly" }, /ticks must be/],
    [{ every: 2, ticks: "none" }, /either every or ticks/],
    [{ even: true, ticks: "none" }, /even takes no/],
  ])
    assert.throws(() => defineTimeline({ axis, events: two }), message);
});

test("events carry a mark shape, markers an accent and a line below, and a legend names the marks", () => {
  const timeline = defineTimeline({
    events: [
      { date: 1983, mark: "diamond", text: "病毒被找到" },
      { date: 1991, mark: "ring", accent: true, text: "凑合的筛子" },
      { date: 1998, text: "药" },
    ],
    markers: [{ date: "1989-02", below: "结构", accent: true }],
    legend: [
      { mark: "diamond", text: "被找到" },
      { mark: ["dot", "ring"], accent: true, text: "筛子" },
    ],
  });
  assert.deepEqual(
    timeline.lanes[0].events.map((e) => [e.mark, e.accent]),
    [
      ["diamond", false],
      ["ring", true],
      ["dot", false],
    ],
  );
  assert.deepEqual(timeline.markers, [
    {
      at: 1989 + 31 / 365,
      show: "1989 年 2 月",
      text: "",
      below: "结构",
      accent: true,
    },
  ]);
  assert.deepEqual(timeline.legend, [
    { marks: ["diamond"], accent: false, text: "被找到" },
    { marks: ["dot", "ring"], accent: true, text: "筛子" },
  ]);
  assert.ok(timelineText(timeline).includes("结构"));
  assert.ok(timelineText(timeline).includes("筛子"));
  assert.throws(
    () => defineTimeline({ events: [{ date: 1983, mark: "star", text: "x" }] }),
    /mark must be one of dot, diamond, square, ring/,
  );
  assert.throws(
    () => defineTimeline({ events: two, legend: [{ mark: [], text: "x" }] }),
    /legend 1 mark must not be empty/,
  );
  assert.throws(
    () => defineTimeline({ events: two, legend: [{ mark: "dot" }] }),
    /legend 1 text must be text/,
  );
});
