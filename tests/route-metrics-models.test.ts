import type { Unchecked } from "../shared/unchecked.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateTopicContent } from "../shared/topic-content.ts";
import {
  labModels,
  modelInputs,
  type LabInput,
} from "../src/ui/models/catalog.ts";
import { routeComparison } from "../src/ui/models/organic-chemistry.ts";

const {
  calculatePmi,
  formulaWeight,
  intermediateMass,
  linearYield,
  molarYield,
  resolutionTotals,
  runningProduct,
} = routeComparison;

test("PMI uses complete mass boundary and never fills missing inputs from yield", () => {
  assert.equal(calculatePmi(1000, 20), 50);
  assert.equal(calculatePmi(null, 20), null);
  assert.equal(calculatePmi(1000, null), null);
  for (const pair of [
    [-1, 1],
    [100, 0],
    [10, 11],
    [Infinity, 1],
    [100, NaN],
  ] satisfies [number, number][])
    assert.throws(() => calculatePmi(...pair));
});

test("isolated yield products apply only to a declared continuous branch", () => {
  assert.ok(Math.abs(linearYield([0.8, 0.9, 0.75]) - 0.54) < 1e-12);
  assert.equal(linearYield([1, 0]), 0);
  for (const input of [[], [-0.1], [1.1], [NaN]])
    assert.throws(() => linearYield(input));
});

test("formula weights and molar yields reject what they cannot read", () => {
  for (const formula of ["", "c6h6", "C6H6Xx", "C6 H6"])
    assert.throws(() => formulaWeight(formula));
  for (const args of [
    [0, 100, 1],
    [1, 0, 1],
    [1, 100, -1],
    [NaN, 1, 1],
  ] satisfies [number, number, number][])
    assert.throws(() => molarYield(...args));
  assert.throws(() => runningProduct([]));
});

test("intermediate mass adds every step's input and refuses impossible yields", () => {
  assert.equal(intermediateMass(100, [1]), 100);
  assert.equal(intermediateMass(100, [0.5, 1]), 300);
  for (const bad of [[], [0], [1.1], [NaN]])
    assert.throws(() => intermediateMass(100, bad));
  for (const api of [0, -1, NaN])
    assert.throws(() => intermediateMass(api, [1]));
  assert.throws(() => resolutionTotals(100, 0.5, 0.9, 0));
});

test("shared lab defaults reproduce the original page readouts", () => {
  for (const [name, expected] of [
    ["route-pmi", "PMI = 50.0 kg/kg"],
    [
      "route-resolution",
      "拆分放在第 1 步：1258 kg。放在第 7 步比放在第 1 步多 56%。",
    ],
  ]) {
    const model = labModels[name];
    assert.equal(
      model.run(
        Object.fromEntries(
          (model.inputs as LabInput[]).map((input) => [
            input.id,
            input.default,
          ]),
        ),
      ).summary!,
      expected,
    );
  }
});

const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/content/sites/instruments/content.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

test("route ledger uses content labels, step yields and mass quantities", () => {
  const data = fixture().data.routeSample;
  const model = labModels["route-ledger"];
  assert.deepEqual(modelInputs(model, data), [
    {
      id: "assumed",
      label: data.inputLabel,
      kind: "number",
      min: 0,
      max: 100,
      default: 100,
      step: 1,
    },
  ]);
  const result = model.run({ assumed: 50 }, data);
  assert.equal(result.tables![0].caption, data.routes[0].title);
  assert.deepEqual(result.tables![0].rows, [
    ["起始转化", "80.0%", "80.0%", "样本记录一"],
    ["待测转化", "50.0%", "40.0%", "待测记录"],
    ["最终分离", "50.0%", "20.0%", "样本记录二"],
  ]);
  assert.equal(result.readouts![1].label, data.mass.title);
  assert.match(result.readouts![1].value, /50.00 mmol/);
  assert.match(result.readouts![1].value, /50.0%/);
  assert.equal(model.run({ assumed: 0 }, data).tables![0].rows[2][2], "0.0%");
  data.mass.productGrams *= 2;
  assert.match(model.run({ assumed: 100 }, data).readouts![1].value, /100.0%/);
});

test("publication rejects malformed route ledgers before rendering", () => {
  validateTopicContent(fixture());
  const mutations = [
    (d: Unchecked) => (d.inputLabel = ""),
    (d: Unchecked) => (d.routes = []),
    (d: Unchecked) => (d.routes[0] = null),
    (d: Unchecked) => (d.routes[0].title = ""),
    (d: Unchecked) => (d.routes[0].claimedText = ""),
    (d: Unchecked) => (d.routes[0].claimed = 1.1),
    (d: Unchecked) => (d.routes[0].steps = []),
    (d: Unchecked) => (d.routes[0].steps[0] = null),
    (d: Unchecked) => (d.routes[0].steps[0].name = ""),
    (d: Unchecked) => (d.routes[0].steps[0].note = ""),
    ...[-1, 1.1, NaN, Infinity, "0.5"].map(
      (v) => (d: Unchecked) => (d.routes[0].steps[0].yield = v),
    ),
    (d: Unchecked) => (d.routes[0].steps[0].assumed = "yes"),
    (d: Unchecked) => (d.mass = null),
    (d: Unchecked) => (d.mass.title = ""),
    (d: Unchecked) => (d.mass.claimed = -1),
    ...["", "C0", "Xx", "C6 H6"].map(
      (v) => (d: Unchecked) => (d.mass.productFormula = v),
    ),
    (d: Unchecked) => (d.mass.startFormula = null),
    ...["startGrams", "startMol", "productGrams"].flatMap((k) =>
      [0, -1, Infinity, "1"].map((v) => (d: Unchecked) => (d.mass[k] = v)),
    ),
  ];
  // Missing reference is rejected by the shared content boundary.
  const missing = fixture();
  delete missing.data.routeSample;
  assert.throws(() => validateTopicContent(missing));
  for (const mutate of mutations) {
    const doc = fixture();
    mutate(doc.data.routeSample);
    assert.throws(() => validateTopicContent(doc));
  }
});
