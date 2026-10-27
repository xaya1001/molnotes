import type { Unchecked } from "../shared/unchecked.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  apparentKi,
  atpLabel,
  panelRatio,
  readout,
} from "../src/ui/models/biochemical-kinetics.ts";
import { labModels, modelInputs } from "../src/ui/models/catalog.ts";
import { validateTopicContent } from "../shared/topic-content.ts";

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

test("apparent Ki keeps its units, zero-ATP limit and dependence on ATP/Km", () => {
  assert.equal(apparentKi(1, 0, 50), 1);
  assert.equal(apparentKi(1, 100, 50), 3);
  assert.equal(apparentKi(1, 100, 5), 21);
  assert.equal(apparentKi(2, 200, 100), 6);
  assert.equal(panelRatio(48, 1.5), 32);
  assert.equal(apparentKi(2, 100, 20) / apparentKi(1, 100, 10), 12 / 11);
});

test("readings preserve rounding and ATP unit conversion", () => {
  assert.equal(readout(1308.6), "1309");
  assert.equal(readout(70.36), "70.4");
  assert.equal(readout(9.319), "9.32");
  assert.equal(readout(0.46), "0.46");
  assert.equal(atpLabel(10), "10 µM");
  assert.equal(atpLabel(1000), "1 mM");
});

test("ATP controls, measurements, roles and comparison concentrations come from content", () => {
  const data = fixture().data.atpSample;
  const model = labModels["atp-competition"];
  const inputs: Unchecked[] = modelInputs(model, data);
  assert.deepEqual(inputs[0].options, [
    { value: "compound-x", label: "样本 X" },
    { value: "compound-y", label: "样本 Y" },
  ]);
  assert.equal(inputs[0].default, "compound-x");
  assert.equal(inputs[1].max, 2);
  assert.equal(inputs[1].default, 1);
  const out = model.run({ inhibitor: "compound-x", step: 1 }, data);
  assert.deepEqual(out.tables![0], {
    caption: data.parameterCaption,
    columns: data.parameterColumns,
    rows: [
      ["Reference", "4 ± 0.2", "10 ± 0.1", "8.00", "1.00"],
      ["Variant A", "2 ± 0.2", "20 ± 0.1", "3.00", "2.67"],
      ["Variant B", "6 ± 0.2", "5 ± 0.1", "18.0", "0.44"],
    ],
  });
  assert.deepEqual(out.tables![1].rows, [
    ["0 µM", "2.00", "6.00", "3.00"],
    ["100 µM", "12.0", "126", "10.5"],
  ]);
  assert.ok(out.summary!.endsWith(data.referenceWarning));
  assert.ok(
    !model
      .run({ inhibitor: "compound-y", step: 1 }, data)
      .summary!.endsWith(data.referenceWarning),
  );
  data.roles = {
    reference: "Variant A",
    numerator: "Reference",
    denominator: "Variant B",
  };
  modelInputs(model, data);
  const changed = model.run({ inhibitor: "compound-x", step: 0 }, data);
  assert.equal(changed.tables![0].rows[0][4], "0.50");
  assert.equal(changed.tables![1].rows[0][3], "0.67");
});

test("drug-action comparison selects declared roles independently of row order", () => {
  const data = fixture().data.competitionSample;
  const model = labModels["atp-selectivity"];
  modelInputs(model, data);
  assert.equal(model.run({ exponent: 1 }, data).tables![0].rows[2][4], "18.0");
  data.variants.reverse();
  data.comparison = { numerator: "Variant A", denominator: "Variant B" };
  modelInputs(model, data);
  const output = model.run({ exponent: 1 }, data);
  assert.equal(output.tables![0].rows[0][0], "Variant B");
  assert.match(output.summary!, /0.2 倍/);
  assert.equal(output.tables![0].caption, data.caption);
  assert.deepEqual(output.tables![0].columns, data.columns);
});

test("publication rejects missing datasets, ambiguous roles and invalid measurements", () => {
  validateTopicContent(fixture());
  const changes = {
    atpSample: [
      (d: Unchecked) => (d.variants = []),
      (d: Unchecked) => d.variants.push(d.variants[0]),
      (d: Unchecked) => (d.inhibitors = []),
      (d: Unchecked) => d.inhibitors.push(d.inhibitors[0]),
      (d: Unchecked) => delete d.inhibitorLabels["compound-x"],
      (d: Unchecked) => delete d.kd["compound-x"]["Variant A"],
      (d: Unchecked) => (d.km["Variant A"].value = 0),
      (d: Unchecked) => (d.km["Reference"].sd = -1),
      ...[0, -1, Infinity, "2"].map(
        (v) => (d: Unchecked) => (d.kd["compound-x"].Reference.value = v),
      ),
      (d: Unchecked) => (d.kd["compound-x"].Reference.sd = NaN),
      (d: Unchecked) => (d.atpSteps = []),
      (d: Unchecked) => (d.atpSteps[0] = -1),
      (d: Unchecked) => (d.comparisonAtp = [Infinity]),
      (d: Unchecked) => (d.defaultStep = 3),
      (d: Unchecked) => (d.defaultStep = 0.5),
      (d: Unchecked) => (d.roles = null),
      (d: Unchecked) => (d.roles.numerator = "missing"),
      (d: Unchecked) => (d.roles.denominator = d.roles.numerator),
      (d: Unchecked) => (d.roles.reference = "missing"),
      (d: Unchecked) => (d.parameterCaption = ""),
      (d: Unchecked) => d.parameterColumns.pop(),
      (d: Unchecked) => (d.comparisonCaption = ""),
      (d: Unchecked) => (d.comparisonColumns[0] = ""),
      (d: Unchecked) => (d.referenceWarning = ""),
    ],
    competitionSample: [
      (d: Unchecked) => (d.variants = []),
      (d: Unchecked) => d.variants.push(d.variants[0]),
      (d: Unchecked) => (d.variants[0] = null),
      (d: Unchecked) => (d.variants[0].name = ""),
      (d: Unchecked) => (d.variants[0].kd = 0),
      (d: Unchecked) => (d.variants[0].km = Infinity),
      (d: Unchecked) => (d.comparison = null),
      (d: Unchecked) => (d.comparison.numerator = "missing"),
      (d: Unchecked) => (d.comparison.denominator = d.comparison.numerator),
      (d: Unchecked) => (d.caption = ""),
      (d: Unchecked) => d.columns.pop(),
    ],
  };
  for (const [key, mutations] of Object.entries(changes)) {
    const missing = fixture();
    delete missing.data[key];
    assert.throws(() => validateTopicContent(missing));
    for (const mutate of mutations) {
      const doc = fixture();
      mutate(doc.data[key]);
      assert.throws(() => validateTopicContent(doc));
    }
  }
});
