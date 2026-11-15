import test from "node:test";
import assert from "node:assert/strict";
import { defineEnergy } from "../src/ui/diagrams/energy.ts";

const points = ["0 A", "90 TS1", "−25 B"];
const path = (name: string, peak: number, extra = {}) => ({
  name,
  points: ["0 A", `${peak} TS1`, "-25 B"],
  ...extra,
});
test("energy normalizes paths, signed decimals, marks and their default labels", () => {
  const model = defineEnergy({
    points: ["0 A", "90.5 TS1", "−25.2 B"],
    rds: "TS1",
    scale: true,
    unit: "kcal/mol",
    axis: "自由能 G",
    marks: [
      { from: "A", to: "TS1" },
      { from: "A", to: "B" },
    ],
  });
  assert.deepEqual(model, {
    axis: "自由能 G",
    unit: "kcal/mol",
    scale: true,
    paths: [
      {
        focus: false,
        points: [
          { e: 0, text: "A" },
          { e: 90.5, text: "TS1" },
          { e: -25.2, text: "B" },
        ],
        rds: "TS1",
      },
    ],
    marks: [
      { from: { path: 0, index: 0 }, to: { path: 0, index: 1 }, text: "ΔG‡" },
      { from: { path: 0, index: 0 }, to: { path: 0, index: 2 }, text: "ΔG°" },
    ],
  });
  const comparison = defineEnergy({
    paths: [path("P", 90, { focus: true }), path("Q", 120)],
    marks: [{ from: "A", to: "TS1", path: "Q" }],
  });
  assert.equal(comparison.paths[0].focus, true);
  assert.deepEqual(comparison.marks[0].to, { path: 1, index: 1 });
  assert.equal(defineEnergy({ points }).scale, false);
});

for (const [input, message] of [
  [{}, "energy 需要 points 或 paths 其中一个"],
  [{ points, paths: [] }, "energy 需要 points 或 paths 其中一个"],
  [{ points, unknown: 1 }, "energy 不认识字段 “unknown”"],
  [
    { paths: [path("P", 90, { extra: true }), path("Q", 100)] },
    "energy 不认识字段 “extra”",
  ],
  [
    { points, marks: [{ from: "A", to: "B", extra: true }] },
    "energy 不认识字段 “extra”",
  ],
  [{ paths: [path("P", 90)] }, "paths 需要 2–3 条路径"],
  [{ points: ["A", "90 TS1", "-25 B"] }, "第 1 个点应写成“能量 标签”"],
  [{ points: ["0 ", "90 TS1", "-25 B"] }, "第 1 个点的标签需要 1–20 个字"],
  [
    { points: ["0 " + "点".repeat(21), "90 TS1", "-25 B"] },
    "第 1 个点的标签需要 1–20 个字",
  ],
  [{ points: ["0 A", "90 TS1"] }, "应为奇数"],
  [{ points: ["0 A", "0 TS1", "-25 B"] }, "“TS1”（0）应高于两侧"],
  [{ points: ["0 A", "90 TS1", "-25 A"] }, "路径 “单路径” 里 “A” 出现了两次"],
  [{ paths: [{ points }, path("Q", 100)] }, "每条路径需要不重复的 name"],
  [{ paths: [path("P", 90), path("P", 100)] }, "每条路径需要不重复的 name"],
  [
    {
      paths: [path("P", 90, { focus: true }), path("Q", 100, { focus: true })],
    },
    "只能有一条路径 focus",
  ],
  [
    { paths: [path("P", 90), path("Q", 100)], rds: "TS1" },
    "rds 写在对应路径下",
  ],
  [{ points, focus: true }, "rds 写在对应路径下"],
  [{ points, rds: "A" }, "rds “A” 不是路径 “单路径” 的过渡态"],
  [
    { points, marks: Array(4).fill({ from: "A", to: "B" }) },
    "一张图最多 3 个标注",
  ],
  [{ points, marks: [{ from: "C", to: "B" }] }, "标注里的 “C” 没有对应的点"],
  [
    {
      paths: [path("P", 90), path("Q", 100)],
      marks: [{ from: "A", to: "TS1" }],
    },
    "“TS1” 在多条路径里位置不同，请加 path",
  ],
  [{ points, marks: [{ from: "A", to: "A" }] }, "标注的起点和终点相同"],
  [
    { points, marks: [{ from: "TS1", to: "B" }] },
    "从 “TS1” 到 “B” 的标注需要 text",
  ],
  [{ points, unit: "J" }, "unit 只能是 kJ/mol 或 kcal/mol"],
  [{ paths: [path("P", 90), path("Q", 90)] }, "路径 “Q” 与 “P” 完全相同"],
  [{ points, scale: "true" }, "scale 需要 true 或 false"],
  [{ points, axis: "能".repeat(9) }, "axis 需要 1–8 个字"],
] satisfies [unknown, string][]) {
  test(`energy rejects ${message}`, () =>
    assert.throws(
      () => defineEnergy(input),
      (error: Error) => error.message.includes(message),
    ));
}
