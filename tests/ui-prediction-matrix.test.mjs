import test from "node:test";
import assert from "node:assert/strict";
import {
  defineMatrix,
  matrixAnswersField,
  matrixCellId,
} from "../src/ui/matrix/model.ts";

// Neutral data: three samples against two reagents.
const outcomes = [
  { id: "turns", label: "变色", tone: "success" },
  { id: "stays", label: "不变", tone: "accent" },
  { id: "untested", label: "未测", choiceLabel: "没有做过", tone: "untested" },
  { id: "plot", label: "仅见于图", tone: "evidence" },
];
const evidence = [
  { source: 1, locator: "表 2，第 4 页", quote: "turned blue" },
];
const cells = [
  { row: "s1", column: "r1", outcome: "turns", system: "水溶液", evidence },
  { row: "s1", column: "r2", outcome: "stays", evidence },
  {
    row: "s2",
    column: "r1",
    outcome: "untested",
    evidence: [],
    gap: "没有这组实验",
  },
  {
    row: "s2",
    column: "r2",
    outcome: "plot",
    evidence,
    gap: "只有图，正文无结论",
  },
  { row: "s3", column: "r1", outcome: "turns", evidence },
  { row: "s3", column: "r2", outcome: "stays", evidence },
];
const base = {
  rows: [
    { id: "s1", label: "样品 1" },
    { id: "s2", label: "样品 2" },
    { id: "s3", label: "样品 3" },
  ],
  columns: [
    { id: "r1", label: "试剂 1", full: "第一种试剂" },
    { id: "r2", label: "试剂 2" },
  ],
  outcomes,
  choices: ["turns", "stays", "untested"],
  required: ["s1:r1", "s2:r1"],
  cells,
};
const define = (change = {}) => defineMatrix({ ...base, ...change });
const withCell = (id, patch) =>
  cells.map((cell) =>
    matrixCellId(cell.row, cell.column) === id ? { ...cell, ...patch } : cell,
  );

test("every row and column meets in exactly one cell, and the cell says how it is known", () => {
  const model = define();
  assert.equal(model.cellById("s1:r1").system, "水溶液");
  assert.equal(model.outcomeOf(model.cellById("s2:r2")).tone, "evidence");
  assert.throws(() => model.cellById("s9:r1"), /Unknown matrix cell/);
  assert.throws(() => define({ cells: cells.slice(1) }), /Missing cell s1:r1/);
  assert.throws(
    () => define({ cells: [...cells, cells[0]] }),
    /Duplicate cell/,
  );
  assert.throws(
    () => define({ cells: withCell("s1:r1", { outcome: "maybe" }) }),
    /unknown outcome/,
  );
  assert.throws(
    () => define({ cells: withCell("s1:r1", { row: "s9" }) }),
    /unknown row or column/,
  );
  // a measured result cites where it comes from
  assert.throws(
    () => define({ cells: withCell("s1:r2", { evidence: [] }) }),
    /measured without evidence/,
  );
  assert.throws(
    () =>
      define({
        cells: withCell("s1:r2", { evidence: [{ source: 1, locator: "" }] }),
      }),
    /without locator/,
  );
});

test("a cell nobody measured needs a stated gap and is never turned into a no", () => {
  assert.throws(
    () => define({ cells: withCell("s2:r1", { gap: undefined }) }),
    /untested without a gap/,
  );
  const model = define();
  const open = model.cellById("s2:r1");
  assert.equal(model.outcomeOf(open).label, "未测");
  assert.deepEqual(open.evidence, []);
  // only the explicit "not measured" choice matches it; "stays" does not
  assert.equal(
    model.isCorrect("s2:r1", model.choices.indexOf("untested")),
    true,
  );
  assert.equal(model.isCorrect("s2:r1", model.choices.indexOf("stays")), false);
  assert.equal(model.isCorrect("s2:r1", model.choices.indexOf("turns")), false);
});

test("an untested cell can be asked only when a choice says it was not measured", () => {
  assert.throws(
    () => define({ choices: ["turns", "stays"] }),
    /untested, but no choice says so/,
  );
  assert.doesNotThrow(() =>
    define({ choices: ["turns", "stays"], required: ["s1:r1", "s3:r2"] }),
  );
  // a cell that is only in a figure is no choice, so it cannot be asked either
  assert.throws(() => define({ required: ["s2:r2"] }), /not a choice/);
  assert.throws(() => define({ required: ["s9:r1"] }), /does not exist/);
  assert.throws(
    () => define({ required: ["s1:r1", "s1:r1"] }),
    /Duplicate required/,
  );
  assert.throws(() => define({ choices: ["turns", "nope"] }), /Unknown choice/);
});

test("the grid opens only when every required cell has an answer", () => {
  const model = define();
  assert.equal(model.isComplete({}), false);
  assert.equal(model.isComplete({ "s1:r1": 0 }), false);
  assert.equal(model.isComplete({ "s2:r1": 2 }), false);
  assert.equal(model.isComplete({ "s1:r1": 1, "s2:r1": 0 }), true);
  // a pick for a cell that is not required does not count
  assert.equal(model.isComplete({ "s3:r1": 0, "s1:r1": 0 }), false);
  assert.equal(define({ required: [] }).isComplete({}), true);
});

test("the answer field stores choice positions and rejects anything else instead of dropping it", () => {
  const field = matrixAnswersField(define(), "试剂矩阵");
  assert.deepEqual(field.empty(), {});
  assert.deepEqual(field.parse(undefined), {});
  assert.deepEqual(field.parse({ "s1:r1": 0, "s2:r1": 2 }), {
    "s1:r1": 0,
    "s2:r1": 2,
  });
  for (const bad of [
    { "s3:r1": 0 },
    { "s1:r1": 3 },
    { "s1:r1": -1 },
    { "s1:r1": 1.5 },
    { "s1:r1": "0" },
    { "s1:r1": null },
  ])
    assert.throws(
      () => field.parse(bad),
      /试剂矩阵的预测选项无效/,
      JSON.stringify(bad),
    );
  for (const bad of [[], "x", 3, null])
    assert.throws(() => field.parse(bad), /试剂矩阵的预测记录格式错误/);
});

test("labels, tones and duplicate ids are checked when the matrix is defined", () => {
  assert.throws(
    () =>
      define({
        outcomes: [...outcomes, { id: "x", label: "x", tone: "pink" }],
      }),
    /unknown tone/,
  );
  assert.throws(
    () => define({ rows: [...base.rows, base.rows[0]] }),
    /Duplicate row/,
  );
  assert.throws(
    () => define({ outcomes: [...outcomes, outcomes[0]] }),
    /Duplicate outcome/,
  );
  assert.throws(
    () => define({ choices: ["turns", "turns"] }),
    /Duplicate choice/,
  );
});
