import type { TopicContent } from "../src/ui/topic/content.ts";
import type FixtureFixture from "./fixtures/content/sites/instruments/content.json";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { labModels, modelInputs } from "../src/ui/models/catalog.ts";
import { validateTopicContent } from "../shared/topic-content.ts";
import {
  columnCorrelation,
  assayFoldChange as foldChange,
  spearman,
} from "../src/ui/models/medicinal-chemistry.ts";

const near = (actual: number | null, expected: number, places = 2) =>
  assert.equal(actual!.toFixed(places), expected.toFixed(places));

test("Spearman correlation averages ties and refuses tiny samples", () => {
  assert.equal(
    spearman([
      [1, 10],
      [2, 20],
      [3, 30],
      [4, 40],
    ]).rho,
    1,
  );
  assert.equal(
    spearman([
      [1, 40],
      [2, 30],
      [3, 20],
      [4, 10],
    ]).rho,
    -1,
  );
  assert.equal(
    spearman([
      [1, 1],
      [2, 2],
    ]).rho,
    null,
  );
  assert.equal(
    spearman([
      [1, 5],
      [2, 5],
      [3, 5],
    ]).rho,
    null,
  );
  near(
    spearman([
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 3],
    ]).rho,
    0.9487,
    4,
  );
});

test("correlation and fold changes exclude missing and censored readings", () => {
  const row = (x: number, y: number, op = "=") => ({
    values: { x: { value: x, op }, y: { value: y, op: "=" } },
  });
  const rows = [
    row(1, 2),
    row(2, 4),
    row(3, 6),
    row(100, 1, ">"),
    { values: {} },
  ];
  assert.deepEqual(columnCorrelation(rows, "x", "y"), { n: 3, rho: 1 });
  assert.equal(foldChange(rows[0], rows[1], "x"), 2);
  assert.equal(foldChange(rows[0], rows[3], "x"), undefined);
  assert.equal(foldChange(rows[0], rows[4], "x"), undefined);
});

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

test("correlation controls derive ordered axes and source labels from the shared table", () => {
  const data = fixture().data.correlationSample;
  const model = labModels["assay-correlation"];
  // The tests read the inputs as the page receives them.
  const inputs = modelInputs(model, data);
  for (const input of inputs.slice(0, 2))
    assert.deepEqual(
      (
        input as Extract<
          import("../src/ui/models/catalog.ts").LabInput,
          { kind: "select" }
        >
      ).options,
      data.columns.map((c) => ({ value: c.key, label: c.label })),
    );
  assert.equal(inputs[0].default, "alpha");
  assert.equal(inputs[1].default, "beta");
  assert.equal(inputs[2].default, "yes");
  assert.equal(
    (
      inputs[2] as Extract<
        import("../src/ui/models/catalog.ts").LabInput,
        { kind: "select" }
      >
    ).options[1].label,
    `${data.alternates.alternate}与 ${data.alternates.listed}`,
  );
  data.columns.reverse();
  data.correlation.defaultX = "outside";
  const changed = modelInputs(model, data);
  assert.equal(
    (
      changed[0] as Extract<
        import("../src/ui/models/catalog.ts").LabInput,
        { kind: "select" }
      >
    ).options[0].value,
    "outside",
  );
  assert.equal(changed[0].default, "outside");
});

test("shared cohorts require all exact columns while mixed axes remain pairwise", () => {
  const data = fixture().data.correlationSample;
  const model = labModels["assay-correlation"];
  modelInputs(model, data);
  const shared = model(data).run({ x: "alpha", y: "beta", agreedOnly: "yes" });
  // Row6 has an alternate outside the selected axes/cohort: the whole row must still be excluded.
  assert.ok(shared.summary!.includes("1.00（n = 3）"));
  const both = model(data).run({ x: "alpha", y: "beta", agreedOnly: "no" });
  assert.ok(
    both.summary!.includes(`${data.alternates.alternate} 1.00（n = 4）`),
  );
  assert.ok(both.summary!.includes(`${data.alternates.listed} 1.00（n = 5）`));
  assert.ok(
    shared.summary!.endsWith(
      `只用${data.correlation.cohort.description}的化合物。`,
    ),
  );
  const pairwise = model(data).run({
    x: "alpha",
    y: "outside",
    agreedOnly: "yes",
  });
  assert.ok(pairwise.summary!.includes("1.00（n = 5）"));
  assert.ok(!pairwise.summary!.includes(data.correlation.cohort.description));
  data.correlation.cohort.keys = ["alpha", "beta"];
  modelInputs(model, data);
  assert.ok(
    model(data)
      .run({ x: "alpha", y: "beta", agreedOnly: "yes" })
      .summary!.includes("0.40（n = 5）"),
  );
});

test("publication rejects unknown or ambiguous correlation configuration", () => {
  validateTopicContent(fixture());
  const mutations = [
    (d: (typeof FixtureFixture)["data"]["correlationSample"]) =>
      Reflect.deleteProperty(d, "correlation"),
    (d: (typeof FixtureFixture)["data"]["correlationSample"]) =>
      Reflect.set(d.correlation, "defaultX", "unknown"),
    (d: (typeof FixtureFixture)["data"]["correlationSample"]) =>
      Reflect.set(d.correlation, "defaultY", "unknown"),
    (d: (typeof FixtureFixture)["data"]["correlationSample"]) =>
      Reflect.set(d.correlation, "cohort", null),
    (d: (typeof FixtureFixture)["data"]["correlationSample"]) =>
      Reflect.set(d.correlation.cohort, "keys", []),
    (d: (typeof FixtureFixture)["data"]["correlationSample"]) =>
      Reflect.set(d.correlation.cohort, "keys", ["alpha"]),
    (d: (typeof FixtureFixture)["data"]["correlationSample"]) =>
      Reflect.set(d.correlation.cohort, "keys", ["alpha", "alpha"]),
    (d: (typeof FixtureFixture)["data"]["correlationSample"]) =>
      Reflect.set(d.correlation.cohort, "keys", ["alpha", "unknown"]),
    (d: (typeof FixtureFixture)["data"]["correlationSample"]) =>
      Reflect.set(d.correlation.cohort, "description", ""),
    (d: (typeof FixtureFixture)["data"]["correlationSample"]) =>
      Reflect.set(d, "alternates", null),
    (d: (typeof FixtureFixture)["data"]["correlationSample"]) =>
      Reflect.set(d.alternates, "alternate", ""),
    (d: (typeof FixtureFixture)["data"]["correlationSample"]) =>
      Reflect.set(d.alternates, "listed", ""),
    (d: (typeof FixtureFixture)["data"]["correlationSample"]) =>
      Reflect.set(d.columns[0], "label", ""),
    (d: (typeof FixtureFixture)["data"]["correlationSample"]) =>
      Reflect.set(d.columns[1], "key", "alpha"),
  ];
  for (const mutate of mutations) {
    const doc = fixture();
    mutate(doc.data.correlationSample);
    assert.throws(() => validateTopicContent(doc));
  }
});
