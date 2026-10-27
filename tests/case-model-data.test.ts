import type { TopicContent } from "../src/ui/topic/content.ts";
import type FixtureFixture from "./fixtures/content/sites/instruments/content.json";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { labModels, modelInputs } from "../src/ui/models/catalog.ts";
import { validateTopicContent } from "../shared/topic-content.ts";
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
const defaults = (
  model: import("../src/ui/models/catalog.ts").LabEntry,
  data?: unknown,
) => Object.fromEntries(modelInputs(model, data).map((i) => [i.id, i.default]));

test("content datasets determine options, default selections, labels and numerical output", () => {
  const { pkSamples: pk, panelSamples: panel } = fixture().data;
  const model = labModels["first-order-elimination"];
  assert.deepEqual(
    (
      modelInputs(model, pk)[0] as Extract<
        import("../src/ui/models/catalog.ts").LabInput,
        { kind: "select" }
      >
    ).options,
    pk.presets.map((p, i: number) => ({ value: i, label: p.name })),
  );
  assert.equal(defaults(model, pk).selected, 0);
  for (const [selected, preset] of pk.presets.entries()) {
    const result = model(pk).run({
      ...defaults(model, pk),
      selected,
      time: preset.halfLife,
    });
    assert.equal(
      result.charts![0].points!.find((p) => p.x === preset.halfLife)!.y,
      50,
    );
    assert.deepEqual(result.readouts, [
      { label: preset.name, value: `${preset.label} [${preset.source}]` },
    ]);
  }
  for (const id of ["assay-panel-ratio"]) {
    const m = labModels[id];
    assert.equal(defaults(m, panel).endpoint, "signal");
    assert.deepEqual(
      (
        modelInputs(m, panel)[0] as Extract<
          import("../src/ui/models/catalog.ts").LabInput,
          { kind: "select" }
        >
      ).options,
      panel.endpoints.map(({ value, label }) => ({ value, label })),
    );
    for (const endpoint of panel.endpoints) {
      const table = m(panel).run({ endpoint: endpoint.value }).tables![0];
      assert.equal(table.caption, panel.caption);
      assert.deepEqual(table.columns, endpoint.columns);
      assert.deepEqual(
        table.rows,
        panel.rows.map((r) => [
          r.name,
          ...r[endpoint.value as "signal" | "growth"].map(String),
          (
            r[endpoint.value as "signal" | "growth"][1] /
            r[endpoint.value as "signal" | "growth"][0]
          ).toPrecision(3),
        ]),
      );
    }
    panel.ratio = { numerator: 2, denominator: 1 };
    modelInputs(m, panel);
    assert.equal(
      m(panel).run({ endpoint: "growth" }).tables![0].rows[0].at(-1),
      "0.600",
    );
    panel.ratio = { numerator: 1, denominator: 0 };
  }
});

test("publication rejects incomplete or invalid case datasets and data-derived defaults", () => {
  const mutations = [
    (d: typeof FixtureFixture) => Reflect.deleteProperty(d.data, "pkSamples"),
    (d: typeof FixtureFixture) => Reflect.set(d.data.pkSamples, "presets", []),
    (d: typeof FixtureFixture) =>
      Reflect.set(d.data.pkSamples.presets, 0, null),
    ...[0, -1, NaN, Infinity, "8"].map(
      (value) => (d: typeof FixtureFixture) =>
        Reflect.set(d.data.pkSamples.presets[0], "halfLife", value),
    ),
    (d: typeof FixtureFixture) =>
      Reflect.deleteProperty(d.data.pkSamples.presets[0], "source"),
    (d: typeof FixtureFixture) =>
      Reflect.deleteProperty(d.data, "panelSamples"),
    (d: typeof FixtureFixture) =>
      Reflect.set(d.data.panelSamples, "endpoints", []),
    (d: typeof FixtureFixture) =>
      Reflect.set(d.data.panelSamples.endpoints[1], "value", "signal"),
    (d: typeof FixtureFixture) =>
      Reflect.set(d.data.panelSamples.endpoints[0], "label", ""),
    (d: typeof FixtureFixture) =>
      d.data.panelSamples.endpoints[0].columns.pop(),
    (d: typeof FixtureFixture) => Reflect.set(d.data.panelSamples, "rows", []),
    (d: typeof FixtureFixture) =>
      Reflect.deleteProperty(d.data.panelSamples.rows[0], "growth"),
    (d: typeof FixtureFixture) =>
      Reflect.set(d.data.panelSamples.rows[0].signal, 0, 0),
    (d: typeof FixtureFixture) =>
      Reflect.set(d.data.panelSamples.rows[0].growth, 2, Infinity),
    (d: typeof FixtureFixture) =>
      Reflect.set(d.data.panelSamples.ratio, "numerator", 3),
    (d: typeof FixtureFixture) =>
      Reflect.set(d.data.panelSamples.ratio, "denominator", -1),
    (d: typeof FixtureFixture) =>
      Reflect.set(d.data.panelSamples.ratio, "numerator", 0.5),
    (d: typeof FixtureFixture) =>
      Reflect.set(
        d.chapters[0].blocks.find((b) => b.model === "first-order-elimination")!
          .defaults!,
        "selected",
        10,
      ),
    (d: typeof FixtureFixture) =>
      Reflect.set(
        d.chapters[0].blocks.find((b) => b.model === "assay-panel-ratio")!,
        "defaults",
        { endpoint: "unknown" },
      ),
    (d: typeof FixtureFixture) =>
      Reflect.set(
        d.chapters[0].blocks.find((b) => b.model === "assay-panel-ratio")!,
        "presets",
        [{ label: "sample", values: { endpoint: "unknown" } }],
      ),
  ];
  validateTopicContent(fixture());
  for (const mutate of mutations) {
    const doc = fixture();
    mutate(doc);
    assert.throws(() => validateTopicContent(doc));
  }
});

test("number prediction readouts keep static models and reject dataset-dependent models without data", () => {
  const doc = fixture();
  const block = {
    type: "prediction",
    id: "number-model",
    kind: "number",
    question: "估计",
    input: { label: "估计值", min: 0, max: 100, step: 1 },
    readout: { model: "enantioselectivity-estimate", input: "guess" },
    explanation: "比较估计。",
  };
  Reflect.apply(doc.chapters[0].blocks.push, doc.chapters[0].blocks, [block]);
  validateTopicContent(doc);
  const model = labModels[block.readout.model];
  assert.equal(modelInputs(model)[0].id, "guess");
  assert.ok(model().run({ ...defaults(model), guess: 5 }).summary);
  block.readout = { model: "first-order-elimination", input: "time" };
  assert.throws(() => validateTopicContent(doc), /readout/);
});
