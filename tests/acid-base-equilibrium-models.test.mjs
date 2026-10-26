import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { labModels, modelInputs } from "../src/ui/models/catalog.mjs";
import { validateTopicContent } from "../scripts/topic-content.mjs";

const { deprotonation, margin, onScale, readings } =
  labModels["enolates-pka-dmso"].calculate;
const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/content/sites/instruments/content.json",
        import.meta.url,
      ),
    ),
  );
const sample = () => fixture().data.pkaSample;

test("deprotonation preserves log K, signed zero and the inclusive three-unit threshold", () => {
  assert.equal(margin, 3);
  for (const [donor, acid, outcome] of [
    [10, 13, "full"],
    [10, 12.999, "mixture"],
    [13, 10, "trace"],
    [12.999, 10, "mixture"],
  ]) {
    const result = deprotonation(donor, acid);
    assert.equal(result.delta, acid - donor);
    assert.equal(result.K, 10 ** (acid - donor));
    assert.equal(result.outcome, outcome);
  }
  assert.ok(Object.is(deprotonation(0, -0).delta, -0));
  for (const v of [NaN, Infinity, -Infinity]) {
    assert.throws(() => deprotonation(v, 10));
    assert.throws(() => deprotonation(10, v));
  }
});

test("scales sort by first reading and retain independent source combinations and missing values", () => {
  const data = sample(),
    [a, b] = data.donors;
  assert.deepEqual(
    onScale(data.donors, "dmso").map((d) => d.id),
    ["donor-c", "donor-a", "donor-b"],
  );
  assert.deepEqual(
    onScale(data.donors, "water").map((d) => d.id),
    ["donor-c", "donor-a"],
  );
  assert.equal(readings(a, data.bases[0], "dmso")[0].outcome, "full");
  assert.equal(readings(a, data.bases[0], "water")[0].outcome, "trace");
  assert.deepEqual(readings(b, data.bases[0], "water"), []);
  const results = readings(b, data.bases[1], "dmso");
  assert.deepEqual(
    results.map((r) => [r.donor.value, r.base.value, r.delta]),
    [
      [11, 12, 1],
      [11, 13, 2],
      [12, 12, 0],
      [12, 13, 1],
    ],
  );
  assert.deepEqual(
    results.map((r) => [r.donor.source, r.base.source]),
    [
      ["记录丙", "记录壬"],
      ["记录丙", "记录癸"],
      ["记录丁", "记录壬"],
      ["记录丁", "记录癸"],
    ],
  );
});

test("pKa labs use content defaults, exact format and each scale without borrowing", () => {
  const data = sample();
  for (const scale of ["dmso", "water"]) {
    const model = labModels[`enolates-pka-${scale}`];
    const values = Object.fromEntries(
      modelInputs(model, data).map((i) => [i.id, i.default]),
    );
    assert.deepEqual(values, data.defaults);
    const result = model.run(values, data);
    assert.equal(result.readouts.length, 1);
    assert.ok(
      result.readouts[0].value.includes(
        scale === "dmso" ? "+4.0，K = 1.0×10⁴" : "−5.0，K = 1.0×10⁻⁵",
      ),
    );
    assert.equal(
      model.run({ ...values, baseId: "base-b" }, data).readouts.length,
      2,
    );
    assert.throws(() => model.run({ ...values, donorId: "missing" }, data));
    assert.throws(() => model.run({ ...values, baseId: "missing" }, data));
  }
  assert.equal(
    labModels["enolates-pka-dmso"].run(
      { donorId: "donor-b", baseId: "base-b" },
      data,
    ).readouts.length,
    4,
  );
  const missing = labModels["enolates-pka-water"].run(
    { donorId: "donor-b", baseId: "base-a" },
    data,
  );
  assert.equal(missing.readouts, undefined);
  assert.equal(typeof missing.summary, "string");
});

test("publication rejects incomplete readings, duplicate entries and defaults absent from either selected scale", () => {
  validateTopicContent(fixture());
  for (const mutate of [
    (d) => delete d.defaults,
    (d) => (d.defaults.donorId = "donor-b"),
    (d) => (d.defaults.baseId = "missing"),
    (d) => (d.donors = []),
    (d) => (d.bases = []),
    (d) => d.donors.push(d.donors[0]),
    (d) => (d.bases[0].id = d.donors[0].id),
    (d) => (d.donors[0].label = ""),
    (d) => (d.donors[0].name = ""),
    (d) => (d.bases[0].acid = ""),
    (d) => (d.donors[0].values = {}),
    (d) => (d.donors[0].values.other = [{ value: 1, source: "source" }]),
    (d) => (d.donors[0].values.dmso = []),
    (d) => (d.donors[0].values.dmso[0].value = Infinity),
    (d) => (d.donors[0].values.dmso[0].source = ""),
  ]) {
    const content = fixture();
    mutate(content.data.pkaSample);
    assert.throws(() => validateTopicContent(content));
  }
});
