import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  apparentKi,
  atpLabel,
  panelRatio,
  readout,
} from "../src/ui/models/biochemical-kinetics.mjs";
import { labModels, modelInputs } from "../src/ui/models/catalog.ts";
import { validateTopicContent } from "../shared/topic-content.ts";

const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/content/sites/instruments/content.json",
        import.meta.url,
      ),
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
  const inputs = modelInputs(model, data);
  assert.deepEqual(inputs[0].options, [
    { value: "compound-x", label: "样本 X" },
    { value: "compound-y", label: "样本 Y" },
  ]);
  assert.equal(inputs[0].default, "compound-x");
  assert.equal(inputs[1].max, 2);
  assert.equal(inputs[1].default, 1);
  const out = model.run({ inhibitor: "compound-x", step: 1 }, data);
  assert.deepEqual(out.tables[0], {
    caption: data.parameterCaption,
    columns: data.parameterColumns,
    rows: [
      ["Reference", "4 ± 0.2", "10 ± 0.1", "8.00", "1.00"],
      ["Variant A", "2 ± 0.2", "20 ± 0.1", "3.00", "2.67"],
      ["Variant B", "6 ± 0.2", "5 ± 0.1", "18.0", "0.44"],
    ],
  });
  assert.deepEqual(out.tables[1].rows, [
    ["0 µM", "2.00", "6.00", "3.00"],
    ["100 µM", "12.0", "126", "10.5"],
  ]);
  assert.ok(out.summary.endsWith(data.referenceWarning));
  assert.ok(
    !model
      .run({ inhibitor: "compound-y", step: 1 }, data)
      .summary.endsWith(data.referenceWarning),
  );
  data.roles = {
    reference: "Variant A",
    numerator: "Reference",
    denominator: "Variant B",
  };
  modelInputs(model, data);
  const changed = model.run({ inhibitor: "compound-x", step: 0 }, data);
  assert.equal(changed.tables[0].rows[0][4], "0.50");
  assert.equal(changed.tables[1].rows[0][3], "0.67");
});

test("drug-action comparison selects declared roles independently of row order", () => {
  const data = fixture().data.competitionSample;
  const model = labModels["atp-selectivity"];
  modelInputs(model, data);
  assert.equal(model.run({ exponent: 1 }, data).tables[0].rows[2][4], "18.0");
  data.variants.reverse();
  data.comparison = { numerator: "Variant A", denominator: "Variant B" };
  modelInputs(model, data);
  const output = model.run({ exponent: 1 }, data);
  assert.equal(output.tables[0].rows[0][0], "Variant B");
  assert.match(output.summary, /0.2 倍/);
  assert.equal(output.tables[0].caption, data.caption);
  assert.deepEqual(output.tables[0].columns, data.columns);
});

test("publication rejects missing datasets, ambiguous roles and invalid measurements", () => {
  validateTopicContent(fixture());
  const changes = {
    atpSample: [
      (d) => (d.variants = []),
      (d) => d.variants.push(d.variants[0]),
      (d) => (d.inhibitors = []),
      (d) => d.inhibitors.push(d.inhibitors[0]),
      (d) => delete d.inhibitorLabels["compound-x"],
      (d) => delete d.kd["compound-x"]["Variant A"],
      (d) => (d.km["Variant A"].value = 0),
      (d) => (d.km["Reference"].sd = -1),
      ...[0, -1, Infinity, "2"].map(
        (v) => (d) => (d.kd["compound-x"].Reference.value = v),
      ),
      (d) => (d.kd["compound-x"].Reference.sd = NaN),
      (d) => (d.atpSteps = []),
      (d) => (d.atpSteps[0] = -1),
      (d) => (d.comparisonAtp = [Infinity]),
      (d) => (d.defaultStep = 3),
      (d) => (d.defaultStep = 0.5),
      (d) => (d.roles = null),
      (d) => (d.roles.numerator = "missing"),
      (d) => (d.roles.denominator = d.roles.numerator),
      (d) => (d.roles.reference = "missing"),
      (d) => (d.parameterCaption = ""),
      (d) => d.parameterColumns.pop(),
      (d) => (d.comparisonCaption = ""),
      (d) => (d.comparisonColumns[0] = ""),
      (d) => (d.referenceWarning = ""),
    ],
    competitionSample: [
      (d) => (d.variants = []),
      (d) => d.variants.push(d.variants[0]),
      (d) => (d.variants[0] = null),
      (d) => (d.variants[0].name = ""),
      (d) => (d.variants[0].kd = 0),
      (d) => (d.variants[0].km = Infinity),
      (d) => (d.comparison = null),
      (d) => (d.comparison.numerator = "missing"),
      (d) => (d.comparison.denominator = d.comparison.numerator),
      (d) => (d.caption = ""),
      (d) => d.columns.pop(),
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
