import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { labModels, modelInputs } from "../src/ui/models/catalog.mjs";
import { validateTopicContent } from "../scripts/topic-content.mjs";
import {
  absoluteHalfLoss,
  associationCurve,
  degradation,
  degradationKinetics,
  degradationLevel,
  halfLifeForRecovery,
  formatValue,
  occupancy,
  pkpd,
  riptacDistribution,
  ternaryTotal,
  washoutRecovery,
} from "../src/ui/models/induced-proximity.mjs";

const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

test("occupancy is half when free ligand equals Kd", () => {
  close(occupancy(10, 10), 50);
  close(occupancy(100, 10), 100 / 11);
});

test("equal Kd ligands share equilibrium but differ in residence", () => {
  const slow = associationCurve(0.01);
  const fast = associationCurve(0.1);
  close(slow.koff, 0.1);
  close(fast.residence, 1);
  const afterWashout = (curve) => curve.find(([t]) => t >= 6)[1];
  assert.ok(afterWashout(slow.curve) > afterWashout(fast.curve));
});

test("the ternary solver conserves total drug, target and effector", () => {
  for (const drugTotal of [0.1, 10, 1000, 100000]) {
    const state = ternaryTotal(drugTotal, 50, 50, 1);
    close(state.drugTotal, drugTotal, drugTotal * 1e-9);
    close(state.target + state.targetBinary + state.ternary, 100, 1e-9);
    close(state.effector + state.effectorBinary + state.ternary, 100, 1e-9);
  }
});

test("excess drug lowers the ternary complex (hook effect)", () => {
  const peak = ternaryTotal(100, 50, 50, 1).ternary;
  assert.ok(ternaryTotal(100000, 50, 50, 1).ternary < peak / 4);
  assert.ok(
    ternaryTotal(100, 50, 50, 10).ternary >
      ternaryTotal(100, 50, 50, 1).ternary,
  );
});

test("relative and absolute degradation midpoints differ", () => {
  close(degradation(80, 10, 10), 40);
  close(absoluteHalfLoss(80, 10), (10 * 50) / 30);
  assert.equal(absoluteHalfLoss(40, 10), null);
});

test("protein recovers towards baseline after washout", () => {
  const curve = degradationKinetics(24, 0.2, 24);
  const at = (time) => curve.find(([t]) => t >= time)[1];
  assert.equal(curve[0][1], 100);
  assert.ok(at(24) < 30);
  assert.ok(at(72) > at(24));
});

test("higher target protein recruits more effector into the complex", () => {
  assert.ok(
    riptacDistribution(100, 20).ternary > riptacDistribution(5, 20).ternary,
  );
  assert.ok(riptacDistribution(0, 20).effectorBinary > 0);
});

test("pk/pd curves start at baseline and drug declines by its half-life", () => {
  const { drugCurve, proteinCurve } = pkpd(8, 0.1, 24);
  assert.deepEqual(drugCurve[0], [0, 100]);
  close(drugCurve.find(([t]) => t >= 8)[1], 50, 1e-6);
  assert.ok(Math.min(...proteinCurve.map(([, p]) => p)) < 100);
});

test("values are formatted compactly", () => {
  assert.equal(formatValue(0), "0");
  assert.equal(formatValue(12000), "12k");
  assert.equal(formatValue(12.0), "12");
  assert.equal(formatValue(1.5), "1.5");
  assert.equal(formatValue(0.0123), "0.012");
});

test("reaching 95 % within 24 h from 10 % needs a half-life near 6 h in that model", () => {
  const needed = halfLifeForRecovery(10, 95, 24);
  close(needed, 5.76, 0.01);
  close(washoutRecovery(10, needed, 24), 95, 1e-9);
  assert.throws(() => halfLifeForRecovery(10, 100, 24), RangeError);
  assert.throws(() => halfLifeForRecovery(50, 40, 24), RangeError);
});

test("the sampled kinetics curve equals the pointwise level", () => {
  const curve = degradationKinetics(60, 0.6, 4);
  for (const [t, level] of curve.filter((_, i) => i % 40 === 0))
    close(level, degradationLevel(60, 0.6, 4, t), 1e-9);
  close(degradationLevel(60, 0.6, 4, 4), 10.4, 0.05);
});

test("the PK/PD prediction in c15 quotes the model: the protein bottoms at 8.5 % after 6.4 h; 6 % drug and 15 % protein at 16 h, 29 % at 24 h, 75 % at 48 h", () => {
  const { drugCurve, proteinCurve } = pkpd(4, 0.05, 12);
  const [bottomHour, bottomLevel] = proteinCurve.reduce((low, point) =>
    point[1] < low[1] ? point : low,
  );
  close(bottomHour, 6.4, 0.05);
  close(bottomLevel, 8.5, 0.05);
  const at = (curve, hour) => curve.find(([t]) => Math.abs(t - hour) < 1e-9)[1];
  close(at(drugCurve, 16), 6.25, 0.01);
  close(at(proteinCurve, 16), 15.3, 0.1);
  close(at(proteinCurve, 24), 28.7, 0.1);
  close(at(proteinCurve, 48), 75.4, 0.1);
});

const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "./fixtures/content/sites/instruments/content.json",
        import.meta.url,
      ),
    ),
  );
const defaults = (id, data) =>
  Object.fromEntries(
    modelInputs(labModels[id], data).map((i) => [i.id, i.default]),
  );

test("typed concentration overlays preserve raw signal and protein-decrease transforms", () => {
  const data = fixture().data.overlaySample;
  const id = "ternary-equilibrium",
    model = labModels[id],
    values = defaults(id, data);
  assert.deepEqual(
    modelInputs(model, data)
      .at(-1)
      .options.map((o) => o.value),
    ["none", "signal", "decrease"],
  );
  assert.deepEqual(
    model.run(values).charts[0].series,
    model.run(values, data).charts[0].series,
  );
  assert.equal(model.run(values, data).charts[0].series.length, 2);
  data.arbitraryDataset = data.signalSample;
  delete data.signalSample;
  const descriptor = data.overlays.concentration.choices[0].series[0];
  descriptor.dataset = "arbitraryDataset";
  modelInputs(model, data);
  const signal = model.run({ ...values, overlay: "signal" }, data).charts[0]
    .series;
  assert.equal(signal.length, 2);
  assert.equal(signal[1].name, descriptor.name);
  assert.equal(signal[1].scatter, true);
  assert.deepEqual(signal[1].points, [
    { x: 0, y: 0 },
    { x: 1, y: 100 },
    { x: 2, y: 50 },
  ]);
  const decrease = model.run({ ...values, overlay: "decrease" }, data).charts[0]
    .series[1];
  // The zero-dose sample contributes to the normalization peak but is omitted from the log-dose plot.
  assert.deepEqual(decrease.points, [
    { x: 0, y: 20 },
    { x: 1, y: 60 },
    { x: 2, y: 10 },
  ]);
  assert.deepEqual(data.decreaseSample.level, [0, 80, 40, 90]);
});

test("typed time overlays preserve measured zero levels and washout offset plus start", () => {
  const data = fixture().data.overlaySample,
    id = "degradation-recovery",
    model = labModels[id],
    values = defaults(id, data);
  const none = model.run(values);
  assert.equal(none.charts[0].series.length, 1);
  const result = model.run({ ...values, overlay: "time-and-washout" }, data);
  assert.deepEqual(result.readouts, none.readouts);
  assert.deepEqual(result.charts[0].series[0], none.charts[0].series[0]);
  assert.deepEqual(result.charts[0].series[1].points, [
    { x: 0, y: 100 },
    { x: 2, y: 50 },
    { x: 4, y: 0 },
  ]);
  assert.deepEqual(result.charts[0].series[2].points, [
    { x: 2, y: 0 },
    { x: 3, y: 25 },
    { x: 5, y: 101 },
  ]);
});

test("publication rejects malformed overlay choices, data and normalization", () => {
  validateTopicContent(fixture());
  const mutations = [
    (d) => delete d.overlays,
    (d) => (d.overlays.concentration.label = ""),
    (d) => (d.overlays.concentration.choices = []),
    (d) => (d.overlays.concentration.choices[0].value = "none"),
    (d) => (d.overlays.concentration.choices[0].value = ""),
    (d) =>
      d.overlays.concentration.choices.push(
        d.overlays.concentration.choices[0],
      ),
    (d) => (d.overlays.concentration.choices[0].series = []),
    (d) =>
      (d.overlays.concentration.choices[0].series[0].kind = "protein-time"),
    (d) => (d.overlays.concentration.choices[0].series[0].dataset = "missing"),
    (d) => (d.overlays.concentration.choices[0].series[0].name = ""),
    (d) => d.signalSample.signal.pop(),
    (d) => (d.signalSample.signal = [0, 0, 0]),
    (d) => (d.signalSample.dose[0] = 0),
    (d) => (d.signalSample.signal[0] = Infinity),
    (d) => (d.decreaseSample.level = [100, 100, 100, 100]),
    (d) => (d.decreaseSample.dose[0] = -1),
    (d) => (d.timeSample.hours = []),
    (d) => (d.timeSample.level[0] = NaN),
    (d) => (d.overlays.time.choices[0].series[0].kind = "signal-peak"),
    (d) => (d.washoutSample.start = Infinity),
    (d) => (d.washoutSample.pretreatHours = -1),
  ];
  for (const mutate of mutations) {
    const doc = fixture();
    mutate(doc.data.overlaySample);
    assert.throws(() => validateTopicContent(doc));
  }
});
