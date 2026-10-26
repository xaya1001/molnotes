import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateTopicContent } from "../scripts/topic-content.mjs";
import { labModels, modelInputs } from "../src/ui/models/catalog.mjs";

const {
  assumedKelvin,
  ddG,
  eeFromDdG,
  eeToEr,
  erToEe,
  kelvin,
  pointGap,
  toKcal,
} = labModels["enantioselectivity-energy"].calculate;

const { closureRatio, derive, distribution, factor, offered, winner } =
  labModels["radical-selectivity"].calculate;
const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/content/sites/instruments/content.json",
        import.meta.url,
      ),
    ),
  );
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const sample = () => fixture().data.radicalSample;

test("per-hydrogen arithmetic preserves exact factors and one-sided bounds", () => {
  const data = sample();
  const results = data.measured.map((m) =>
    derive(m, data.alkanes.find((a) => a.id === m.alkane).counts),
  );
  assert.equal(results[0][0].working, "(60/2) ÷ (40/4) = 3");
  assert.equal(results[1][0].working, "(40/2) ÷ (60/6) = 2");
  assert.deepEqual(
    results[2].map(({ type, op, value }) => ({ type, op, value })),
    [{ type: "tertiary", op: ">", value: 147 }],
  );
});

test("exact derived factors recover source shares and distributions sum to100", () => {
  const data = sample();
  for (const m of data.measured.filter((m) => m.halogen === "X")) {
    const counts = data.alkanes.find((a) => a.id === m.alkane).counts;
    const factors = Object.fromEntries(
      derive(m, counts).map((d) => [d.type, d.value]),
    );
    const shares = distribution(counts, factors);
    assert.ok(
      near(
        Object.values(shares).reduce((a, b) => a + b, 0),
        100,
      ),
    );
    for (const [type, share] of Object.entries(m.shares))
      assert.ok(near(shares[type], share.value));
  }
});

test("offered factors follow explicit measured references or separate printed sources", () => {
  const data = sample();
  assert.deepEqual(offered("X", data), { secondary: 3, tertiary: 2 });
  assert.deepEqual(offered("Y", data), { secondary: 200, tertiary: 900 });
  const shares = distribution(data.alkanes[2].counts, offered("X", data));
  assert.ok(near(shares.primary, (100 * 3) / 11));
  assert.ok(near(shares.tertiary, (100 * 2) / 11));
  const bound = derive(data.measured[2], data.alkanes[1].counts)[0].value;
  assert.ok(offered("Y", data).tertiary > bound);
  assert.ok(
    distribution(data.alkanes[1].counts, offered("Y", data)).tertiary > 98,
  );
});

test("the radical mathematics refuses zero factors, missing factors and unsupported bounds", () => {
  assert.throws(() => factor(0, 2, 40, 4));
  assert.throws(() => factor(60, 0, 40, 4));
  assert.throws(() => distribution({ primary: 4, secondary: 2 }, {}));
  assert.throws(() =>
    distribution({ primary: 4, secondary: 2 }, { secondary: -1 }),
  );
  assert.throws(() =>
    derive(
      {
        shares: {
          primary: { op: "<", value: 2 },
          secondary: { op: "=", value: 60 },
        },
      },
      { primary: 4, secondary: 2 },
    ),
  );
});

test("ring selection respects found-ratio direction and closure ratios reject zero", () => {
  for (const [op, value, result] of [
    ["=", 12, "exo"],
    ["=", 0.2, "endo"],
    ["<", 0.5, "endo"],
    [">", 4, "exo"],
  ])
    assert.equal(winner({ foundRatio: { op, value } }), result);
  assert.equal(closureRatio({ main: 8, minor: 2 }), 4);
  assert.throws(() => closureRatio({ main: 8, minor: 0 }));
});

test("ee: 99% is 99.5:0.5 and a 94:6 mixture is 88% ee", () => {
  assert.deepEqual(eeToEr(99), { major: 99.5, minor: 0.5, ratio: 199 });
  assert.equal(erToEe(94, 6), 88);
  assert.throws(() => eeToEr(100));
  assert.throws(() => eeToEr(-1));
  assert.throws(() => erToEe(0, 6));
});

test("ΔΔG‡ = RT ln(er) at −20 °C and 25 °C", () => {
  const T = kelvin(-20);
  assert.ok(near(T, 253.15));
  assert.ok(near(ddG(94, T), 7.317, 5e-3));
  assert.ok(near(toKcal(ddG(94, T)), 1.749, 5e-3));
  assert.ok(near(ddG(94, assumedKelvin), 8.617, 5e-3));
  assert.ok(near(toKcal(ddG(94, assumedKelvin)), 2.06, 5e-3));
  assert.ok(near(ddG(91, assumedKelvin), 7.574, 5e-3));
  assert.ok(near(ddG(99, assumedKelvin), 13.12, 5e-3));
  assert.ok(near(toKcal(ddG(99, assumedKelvin)), 3.14, 5e-3));
  assert.ok(near(ddG(99.8, assumedKelvin), 17.12, 5e-3));
  assert.ok(near(toKcal(ddG(99.8, assumedKelvin)), 4.09, 5e-3));
});

test("ee inverts ΔΔG‡, rises with the gap and falls with temperature", () => {
  for (const ee of [50, 84, 94, 99.8])
    assert.ok(near(eeFromDdG(ddG(ee, 273.15), 273.15), ee, 1e-9));
  assert.ok(eeFromDdG(8, 298.15) < eeFromDdG(9, 298.15));
  assert.ok(eeFromDdG(8, 253.15) > eeFromDdG(8, 298.15));
  assert.equal(eeFromDdG(0, 298.15), 0);
  assert.throws(() => eeFromDdG(-1, 298.15));
  assert.throws(() => kelvin(500));
  assert.throws(() => ddG(94, 0));
});

test("energy estimates distinguish supplied and assumed temperatures", () => {
  const measured = pointGap({ ee: 80, celsius: 10 });
  const assumed = pointGap({ ee: 80 });
  assert.equal(measured.assumed, false);
  assert.equal(measured.temperature, 283.15);
  assert.equal(assumed.assumed, true);
  assert.equal(assumed.temperature, assumedKelvin);
});

test("shared lab defaults reproduce the original page readouts", () => {
  for (const [name, expected] of [
    [
      "enantioselectivity-energy",
      "ee 94% 即 97.00:3.00，需要 ΔΔG‡ = 7.32 kJ/mol（1.75 kcal/mol）。",
    ],
  ]) {
    const model = labModels[name];
    assert.equal(
      model.run(
        Object.fromEntries(
          model.inputs.map((input) => [input.id, input.default]),
        ),
      ).summary,
      expected,
    );
  }
});

test("radical content controls preserve unrevealed predictions and source evidence separately", () => {
  const data = sample(),
    model = labModels["radical-selectivity"];
  const values = Object.fromEntries(
    modelInputs(model, data).map((i) => [i.id, i.default]),
  );
  assert.equal(values.alkaneId, "sample-b");
  assert.equal(values.halogen, "X");
  const result = model.run(values, data);
  assert.deepEqual(
    result.readouts.map((r) => r.value),
    ["75.0%", "25.0%"],
  );
  assert.ok(result.revealed.summary.includes(data.measured[1].note));
  assert.match(result.revealed.readouts[1].value, /40%.*= 2/);
  assert.equal(
    model.run({ ...values, tertiary: 5 }, data).readouts[1].value,
    "62.5%",
  );
  const offeredModel = labModels["radical-distribution"];
  const predicted = offeredModel.run(
    { alkaneId: "sample-c", halogen: "X" },
    data,
  );
  assert.deepEqual(
    predicted.revealed.readouts.map((r) => r.value),
    ["27.3%", "54.5%", "18.2%"],
  );
  assert.ok(predicted.revealed.summary.includes(data.halogens[0].source));
});

test("publication refuses inconsistent radical datasets and non-exact offered references", () => {
  validateTopicContent(fixture());
  const mutations = [
    (d) => (d.alkanes = []),
    (d) => d.alkanes.push(d.alkanes[0]),
    (d) => (d.alkanes[0].counts.primary = 0),
    (d) => (d.alkanes[0].counts.secondary = 0.5),
    (d) => delete d.alkanes[0].products.secondary,
    (d) => (d.alkanes[0].products.tertiary = "extra"),
    (d) => d.halogens.push(d.halogens[0]),
    (d) => d.measured.push(d.measured[0]),
    (d) => (d.measured[0].alkane = "missing"),
    (d) => (d.measured[0].halogen = "missing"),
    (d) => delete d.measured[0].shares.secondary,
    (d) => (d.measured[0].shares.secondary.value = 50),
    (d) => (d.measured[0].shares.secondary.op = "<="),
    (d) => (d.measured[0].shares.primary.op = "<"),
    (d) => (d.measured[2].shares.tertiary.value = 100),
    (d) => (d.measured[0].page = ""),
    (d) => (d.sourceLabel = ""),
    (d) => (d.halogens[0].offered.tertiary.alkane = "sample-a"),
    (d) =>
      (d.halogens[1].offered.secondary = {
        kind: "measured",
        alkane: "sample-a",
      }),
    (d) =>
      (d.halogens[1].offered.tertiary = {
        kind: "measured",
        alkane: "sample-b",
      }),
    (d) => (d.halogens[0].offered.secondary.kind = "unknown"),
    ...[0, -1, Infinity].map(
      (v) => (d) => (d.halogens[1].offered.tertiary.value = v),
    ),
    (d) => (d.defaults.estimateAlkane = "missing"),
    (d) => (d.defaults.offeredAlkane = "missing"),
    (d) => (d.defaults.halogen = "missing"),
  ];
  for (const mutate of mutations) {
    const doc = fixture();
    mutate(doc.data.radicalSample);
    assert.throws(() => validateTopicContent(doc));
  }
});
