import type { TopicContent } from "../src/ui/topic/content.ts";
import type FixtureFixture from "./fixtures/content/sites/instruments/content.json";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateTopicContent } from "../shared/topic-content.ts";
import { labModels, modelInputs } from "../src/ui/models/catalog.ts";

import { chairEquilibrium } from "../src/ui/models/organic-chemistry.ts";
const fixture = (): typeof FixtureFixture & TopicContent =>
  JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/content/sites/instruments/content.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );

test("two-state thermodynamics reproduces methyl A-value and respects sign and temperature", () => {
  const eq = chairEquilibrium(7.3, 298.15);
  assert.ok(eq.ratio > 18.9 && eq.ratio < 19.1);
  assert.ok(eq.equatorial > 0.949 && eq.equatorial < 0.951);
  assert.deepEqual(chairEquilibrium(0, 298.15), {
    ratio: 1,
    equatorial: 0.5,
    axial: 0.5,
  });
  assert.ok(
    Math.abs(chairEquilibrium(-7.3, 298.15).equatorial - eq.axial) < 1e-12,
  );
  assert.ok(chairEquilibrium(7.3, 350).equatorial < eq.equatorial);
  assert.ok(chairEquilibrium(20, 298.15).equatorial > 0.999);
  for (const [g, t] of [
    [NaN, 298],
    [Infinity, 298],
    [26, 298],
    [0, 249],
    [0, 351],
    [0, NaN],
  ])
    assert.throws(() => chairEquilibrium(g, t));
});

test("neutral reference values and bounds agree with two-state thermodynamics", () => {
  for (const row of fixture().data.chairSample.rows) {
    const eq = chairEquilibrium(row.deltaG, 298.15);
    if (row.lowerBound) {
      assert.ok(eq.ratio > row.k, row.substituent);
      assert.ok(eq.equatorial * 100 > row.percent, row.substituent);
    } else {
      assert.ok(Math.abs(eq.ratio / row.k - 1) < 0.06, row.substituent);
      assert.ok(
        Math.abs(eq.equatorial * 100 - row.percent) < 1,
        row.substituent,
      );
    }
  }
});

test("chair reference lookup uses content defaults and exact reference temperature", () => {
  const model = labModels["saturated-chair"],
    data = fixture().data.chairSample;
  const values = Object.fromEntries(
    modelInputs(model, data).map((input) => [input.id, input.default]),
  );
  assert.equal(values.dg, 5);
  assert.equal(values.t, 298.15);
  assert.deepEqual(model(data).run(values).readouts!, [
    { label: data.referenceLabel, value: "K = 7.5，平伏 88.3%。" },
  ]);
  assert.deepEqual(
    model(data).run({ ...values, t: 298.15000000001 }).readouts!,
    [],
  );
  assert.deepEqual(model(data).run({ ...values, dg: -5 }).readouts!, []);
  assert.deepEqual(model(data).run({ ...values, dg: 0 }).readouts!, [
    { label: data.referenceLabel, value: "K = 1，平伏 50%。" },
  ]);
  assert.deepEqual(model(data).run({ ...values, dg: 20 }).readouts!, [
    { label: data.referenceLabel, value: "K > 1000，平伏 >99%。" },
  ]);
  data.referenceTemperature = 300;
  modelInputs(model, data);
  assert.equal(model(data).run(values).readouts!.length, 0);
  assert.equal(model(data).run({ ...values, t: 300 }).readouts!.length, 1);
});

test("publication refuses partial or ambiguous chair reference datasets", () => {
  validateTopicContent(fixture());
  const mutations = [
    (d: (typeof FixtureFixture)["data"]["chairSample"]) =>
      Reflect.set(d, "rows", []),
    (d: (typeof FixtureFixture)["data"]["chairSample"]) =>
      Reflect.set(d, "referenceLabel", ""),
    (d: (typeof FixtureFixture)["data"]["chairSample"]) =>
      Reflect.set(d, "referenceTemperature", 249),
    (d: (typeof FixtureFixture)["data"]["chairSample"]) =>
      Reflect.set(d, "referenceTemperature", Infinity),
    (d: (typeof FixtureFixture)["data"]["chairSample"]) =>
      Reflect.set(d, "defaultDeltaG", 1),
    (d: (typeof FixtureFixture)["data"]["chairSample"]) =>
      Reflect.set(d, "defaultDeltaG", NaN),
    (d: (typeof FixtureFixture)["data"]["chairSample"]) =>
      Reflect.set(d.rows, 0, null),
    (d: (typeof FixtureFixture)["data"]["chairSample"]) =>
      Reflect.set(d.rows[0], "substituent", ""),
    (d: (typeof FixtureFixture)["data"]["chairSample"]) =>
      Reflect.set(d.rows[1], "deltaG", d.rows[0].deltaG),
    (d: (typeof FixtureFixture)["data"]["chairSample"]) =>
      Reflect.set(d.rows[0], "deltaG", Infinity),
    (d: (typeof FixtureFixture)["data"]["chairSample"]) =>
      Reflect.set(d.rows[0], "k", 0),
    (d: (typeof FixtureFixture)["data"]["chairSample"]) =>
      Reflect.set(d.rows[0], "percent", 101),
    (d: (typeof FixtureFixture)["data"]["chairSample"]) =>
      Reflect.set(d.rows[0], "lowerBound", "yes"),
    (d: (typeof FixtureFixture)["data"]["chairSample"]) =>
      Reflect.deleteProperty(d.rows[0], "percent"),
  ];
  const missing = fixture();
  Reflect.deleteProperty(missing.data, "chairSample");
  assert.throws(() => validateTopicContent(missing));
  for (const mutate of mutations) {
    const doc = fixture();
    mutate(doc.data.chairSample);
    assert.throws(() => validateTopicContent(doc));
  }
});
