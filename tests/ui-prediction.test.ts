import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pathField,
  predictionAnswered,
  predictionCorrect,
  predictionField,
  type GateRecords,
} from "../src/ui/topic/prediction.ts";
import type { PredictionEntry } from "../src/ui/topic/content.ts";
import { defineMatrix } from "../src/ui/matrix/model.ts";

const choice = {
  question: "?",
  options: ["a", "b", "c"],
  answer: 1,
  explanation: "b",
};
const atoms = {
  kind: "atoms" as const,
  question: "?",
  molecule: { name: "m", smiles: "ClC1=CC=CC=C1" },
  answer: [0, 6],
  explanation: "0",
};
// Chapters as the content lists them; one has no prediction.
const chapters = [
  { id: "c", prediction: choice },
  { id: "s", prediction: atoms },
  { id: "none" },
] as unknown as PredictionEntry[];

test("a prediction is right when the option or the single picked index matches", () => {
  assert.equal(predictionCorrect(choice, { option: 1 }), true);
  assert.equal(
    predictionCorrect({ ...choice, alsoCorrect: [2] }, { option: 2 }),
    true,
  );
  assert.equal(predictionCorrect(choice, { option: 0 }), false);
  assert.equal(predictionCorrect(choice, { selected: [1] }), false);
  assert.equal(predictionCorrect(atoms, { selected: [6] }), true);
  assert.equal(predictionCorrect(atoms, { selected: [3] }), false);
  assert.equal(predictionCorrect(atoms, { option: 0 }), false);
});

test("stored predictions are kept only when they fit the chapter's prediction", () => {
  const field = predictionField(chapters);
  assert.deepEqual(field.parse(undefined), {});
  assert.deepEqual(field.parse({ c: { option: 2 }, s: { selected: [4] } }), {
    c: { option: 2 },
    s: { selected: [4] },
  });
  for (const stored of [
    [],
    { none: { option: 0 } },
    { c: { option: 3 } },
    { c: { option: 1.5 } },
    { c: { selected: [1] } },
    { s: { option: 0 } },
    { s: { selected: [] } },
    { s: { selected: [1, 2] } },
    { s: { selected: [-1] } },
  ])
    assert.throws(() => field.parse(stored), Error, JSON.stringify(stored));
});

const atomSet = {
  kind: "atom-set" as const,
  question: "?",
  molecules: [
    { name: "a", smiles: "Clc1ccccc1", answer: [2, 4, 6] },
    { name: "b", smiles: "Clc1ccccc1", answer: [3] },
  ],
  explanation: "e",
};
const arrows = {
  kind: "arrows" as const,
  question: "?",
  molecule: { name: "m", smiles: "CC(=O)C.[C-]#N" },
  answer: { from: 4, to: 1 },
  explanation: "e",
};
const matrix = {
  kind: "matrix" as const,
  model: defineMatrix({
    rows: [{ id: "a", label: "A" }],
    columns: [
      { id: "x", label: "X" },
      { id: "y", label: "Y" },
    ],
    outcomes: [
      { id: "yes", label: "有", tone: "success" },
      { id: "no", label: "无", tone: "danger" },
    ],
    choices: ["yes", "no"],
    required: ["a:x", "a:y"],
    cells: [
      {
        row: "a",
        column: "x",
        outcome: "yes",
        evidence: [{ source: 1, locator: "p1" }],
      },
      {
        row: "a",
        column: "y",
        outcome: "no",
        evidence: [{ source: 1, locator: "p2" }],
      },
    ],
  }),
};
const entries = [
  { id: "set", chapter: "c", prediction: atomSet },
  { id: "arrow", chapter: "c", prediction: arrows },
  { id: "grid", chapter: "c", prediction: matrix },
];

test("atom sets match as sets per molecule; an arrow matches both ends in order", () => {
  assert.equal(predictionCorrect(atomSet, { sets: [[6, 2, 4], [3]] }), true);
  assert.equal(predictionCorrect(atomSet, { sets: [[2, 4], [3]] }), false);
  assert.equal(predictionCorrect(atomSet, { sets: [[2, 4, 6]] }), false);
  assert.equal(predictionCorrect(arrows, { from: 4, to: 1 }), true);
  assert.equal(predictionCorrect(arrows, { from: 1, to: 4 }), false);
});

test("a matrix counts as answered only when every required cell is", () => {
  const cells: Record<string, number> = { "a:x": 0 };
  const answers: GateRecords = {
    predictions: { grid: { cells }, set: { sets: [[1], [2]] } },
    answers: {},
    diagnostic: {},
  };
  assert.equal(predictionAnswered(entries[2], answers), false);
  assert.equal(predictionAnswered(entries[0], answers), true);
  assert.equal(predictionAnswered(entries[1], answers), false);
  cells["a:y"] = 1;
  assert.equal(predictionAnswered(entries[2], answers), true);
});

test("stored sets, arrows and matrix cells are kept only when they fit", () => {
  const field = predictionField(entries);
  const kept = {
    set: { sets: [[2, 4], [0]] },
    arrow: { from: 0, to: 2 },
    grid: { cells: { "a:x": 1 } },
  };
  assert.deepEqual(field.parse(kept), kept);
  for (const stored of [
    { set: { sets: [[2, 4]] } },
    { set: { sets: [[], [1]] } },
    { set: { selected: [1] } },
    { arrow: { from: 1, to: 1 } },
    { arrow: { from: -1, to: 1 } },
    { grid: { cells: { "a:z": 0 } } },
    { grid: { cells: { "a:x": 2 } } },
    { grid: { option: 0 } },
  ])
    assert.throws(() => field.parse(stored), Error, JSON.stringify(stored));
});

const estimate = {
  kind: "number" as const,
  question: "?",
  input: { label: "x" },
  answer: 10,
  tolerance: 0.5,
  explanation: "e",
};
test("a number estimate is right within its tolerance and only finite numbers are kept", () => {
  assert.equal(predictionCorrect(estimate, { value: 10.4 }), true);
  assert.equal(predictionCorrect(estimate, { value: 11 }), false);
  assert.equal(
    predictionCorrect({ ...estimate, answer: undefined }, { value: 3 }),
    false,
  );
  const field = predictionField([
    { id: "n", chapter: "c", prediction: estimate },
  ]);
  assert.deepEqual(field.parse({ n: { value: 2.5 } }), { n: { value: 2.5 } });
  for (const stored of [
    { n: { value: "2" } },
    { n: { value: NaN } },
    { n: { option: 0 } },
  ])
    assert.throws(() => field.parse(stored), Error, JSON.stringify(stored));
});

test("an arrow with options needs both right; a quiz gate reads the quiz answers", () => {
  const combined = { ...arrows, options: ["a", "b"], optionAnswer: 1 };
  assert.equal(
    predictionCorrect(combined, { from: 4, to: 1, choice: 1 }),
    true,
  );
  assert.equal(
    predictionCorrect(combined, { from: 4, to: 1, option: 0 }),
    false,
  );
  const field = predictionField([
    { id: "x", chapter: "c", prediction: combined },
  ]);
  assert.deepEqual(field.parse({ x: { from: 4, to: 1, choice: 1 } }), {
    x: { from: 4, to: 1, choice: 1 },
  });
  assert.throws(() => field.parse({ x: { from: 4, to: 1 } }));
  assert.throws(() => field.parse({ x: { from: 4, to: 1, choice: 2 } }));
  const gate = {
    id: "start",
    chapter: "c",
    prediction: {
      kind: "quiz" as const,
      questions: ["q1", "q2"],
      diagnostic: true,
    },
  };
  const diagnostic: Record<string, number> = { q1: 1 };
  const records: GateRecords = {
    predictions: {},
    answers: { q1: 0, q2: 0 },
    diagnostic,
  };
  assert.equal(predictionAnswered(gate, records), false);
  diagnostic.q2 = 0;
  assert.equal(predictionAnswered(gate, records), true);
  assert.throws(() => predictionField([gate]).parse({ start: { option: 0 } }));
});

test("design predictions need every group hit, no stray atom and the right option; rankings grade first place", () => {
  const design = {
    kind: "design" as const,
    question: "?",
    molecule: { name: "m", smiles: "CCCC" },
    groups: [[0, 1], [3]],
    options: ["a", "b"],
    answer: 1,
    explanation: "e",
  };
  assert.equal(predictionCorrect(design, { atoms: [1, 3], option: 1 }), true);
  assert.equal(predictionCorrect(design, { atoms: [1], option: 1 }), false);
  assert.equal(
    predictionCorrect(design, { atoms: [1, 2, 3], option: 1 }),
    false,
  );
  assert.equal(predictionCorrect(design, { atoms: [1, 3], option: 0 }), false);
  const ranking = {
    kind: "ranking" as const,
    question: "?",
    options: ["a", "b", "c"],
    answer: 2,
    explanation: "e",
  };
  assert.equal(predictionCorrect(ranking, { ranking: [2, 0, 1] }), true);
  assert.equal(predictionCorrect(ranking, { ranking: [0, 2, 1] }), false);
  const field = predictionField([
    { id: "d", chapter: "c", prediction: design },
    { id: "r", chapter: "c", prediction: ranking },
  ]);
  assert.deepEqual(
    field.parse({ d: { atoms: [3], option: 0 }, r: { ranking: [1, 0, 2] } }),
    {
      d: { atoms: [3], option: 0 },
      r: { ranking: [1, 0, 2] },
    },
  );
  for (const stored of [
    { d: { atoms: [], option: 0 } },
    { d: { atoms: [1], option: 2 } },
    { r: { ranking: [0, 0, 1] } },
    { r: { ranking: [0, 1] } },
    { r: { ranking: [0, 1, 3] } },
  ])
    assert.throws(() => field.parse(stored), Error, JSON.stringify(stored));
});

test("atom sets may carry a choice and may leave the atoms ungraded", () => {
  const withChoice = {
    ...atomSet,
    options: ["x", "y"],
    optionAnswer: 1,
    gradeAtoms: false,
  };
  assert.equal(
    predictionCorrect(withChoice, { sets: [[0], [1]], choice: 1 }),
    true,
  );
  assert.equal(
    predictionCorrect(withChoice, { sets: [[0], [1]], choice: 0 }),
    false,
  );
  const field = predictionField([
    { id: "s", chapter: "c", prediction: withChoice },
  ]);
  assert.deepEqual(field.parse({ s: { sets: [[0], [1]], choice: 1 } }), {
    s: { sets: [[0], [1]], choice: 1 },
  });
  assert.throws(() => field.parse({ s: { sets: [[0], [1]] } }));
});

test("multi-pick structure predictions grade a subset or the exact set and keep only the allowed count", () => {
  const subset = {
    ...atoms,
    answer: [0, 2, 4, 6],
    minSelections: 1,
    maxSelections: 3,
    match: "subset" as const,
  };
  assert.equal(predictionCorrect(subset, { selected: [0, 6] }), true);
  assert.equal(predictionCorrect(subset, { selected: [0, 1] }), false);
  assert.equal(predictionCorrect(subset, { selected: [0, 2, 4, 6] }), false);
  const exact = {
    ...atoms,
    answer: [0, 6],
    minSelections: 2,
    maxSelections: 2,
  };
  assert.equal(predictionCorrect(exact, { selected: [6, 0] }), true);
  assert.equal(predictionCorrect(exact, { selected: [0, 1] }), false);
  const field = predictionField([
    { id: "s", chapter: "c", prediction: subset },
  ]);
  assert.deepEqual(field.parse({ s: { selected: [2, 4] } }), {
    s: { selected: [2, 4] },
  });
  for (const stored of [
    { s: { selected: [] } },
    { s: { selected: [0, 2, 4, 6] } },
    { s: { selected: [1, 1] } },
  ])
    assert.throws(() => field.parse(stored), Error, JSON.stringify(stored));
});

test("image points grade the picked point and the choice together", () => {
  const picture = {
    kind: "image-points" as const,
    question: "?",
    image: { src: "/x.svg", alt: "口袋" },
    points: [
      { id: "a", label: "A", x: 10, y: 20 },
      { id: "b", label: "B", x: 50, y: 60 },
    ],
    answer: ["b"],
    options: ["x", "y"],
    optionAnswer: 0,
    explanation: "e",
  };
  assert.equal(predictionCorrect(picture, { point: "b", choice: 0 }), true);
  assert.equal(predictionCorrect(picture, { point: "a", choice: 0 }), false);
  assert.equal(predictionCorrect(picture, { point: "b", choice: 1 }), false);
  const field = predictionField([
    { id: "p", chapter: "c", prediction: picture },
  ]);
  assert.deepEqual(field.parse({ p: { point: "a", choice: 1 } }), {
    p: { point: "a", choice: 1 },
  });
  assert.throws(() => field.parse({ p: { point: "zz", choice: 1 } }));
  assert.throws(() => field.parse({ p: { point: "a" } }));
});

test("a molecule's atom count bounds the indices a record may hold", () => {
  const bounded = { ...atoms, molecule: { ...atoms.molecule, atoms: 7 } };
  const field = predictionField([
    { id: "s", chapter: "c", prediction: bounded },
  ]);
  assert.deepEqual(field.parse({ s: { selected: [6] } }), {
    s: { selected: [6] },
  });
  assert.throws(() => field.parse({ s: { selected: [7] } }));
});

test("the chosen learning path defaults to the first and must be a known id", () => {
  const field = pathField([{ id: "all" }, { id: "short" }]);
  assert.equal(field.empty(), "all");
  assert.equal(field.parse(undefined), "all");
  assert.equal(field.parse("short"), "short");
  assert.throws(() => field.parse("zz"));
});
