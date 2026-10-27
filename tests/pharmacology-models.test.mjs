import { labModels } from "../src/ui/models/catalog.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { drugActionMath } from "../src/ui/models/medicinal-chemistry.mjs";

const {
  occupancy,
  hill,
  doseRatio,
  apparentKi,
  competitiveIC50,
  noncompetitiveIC50,
  kiFromIC50,
  kobs,
  targetActivity,
  remainingActivity,
  halfLife,
  residenceTime,
  selectivityWindow,
  largestGap,
  freeEnergy,
  kdFromEnergy,
  ligandEfficiency,
  lipophilicEfficiency,
} = drugActionMath;

const close = (a, b, t = 1e-9) =>
  assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);

test("Hill half maximum and competitive antagonist conserve Emax", () => {
  close(hill(10, 10, 80, 1), 40);
  for (const n of [0.5, 1, 3]) close(hill(10, 10, 80, n), 40);
  close(hill(0, 10, 80, 1), 0);
  close(doseRatio(90, 10), 10);
  close(hill(100, 10 * doseRatio(90, 10), 80, 1), 40);
  assert.ok(hill(1e9, 100, 80, 1) > 79.99);
});

test("substrate dependence and inverse Cheng–Prusoff", () => {
  close(competitiveIC50(5, 1), 10);
  close(competitiveIC50(5, 15) / competitiveIC50(5, 1), 8);
  close(kiFromIC50(80, 15), 5);
  close(noncompetitiveIC50(5), 5);
});

test("covalent saturation, half life, zero exposure and residence", () => {
  close(kobs(10, 10, 0.1), 0.05);
  close(kobs(1e10, 10, 0.1), 0.1, 1e-8);
  close(remainingActivity(halfLife(0.05), 0.05), 0.5);
  close(remainingActivity(120, kobs(0, 10, 0.1)), 1);
  assert.equal(halfLife(0), Infinity);
  close(residenceTime(0.1), 10);
});

test("occupancy thresholds define a narrow 100-fold window and exact 81-fold boundary", () => {
  close(occupancy(10, 10), 0.5);
  assert.deepEqual(selectivityWindow(10, 810), { lower: 90, upper: 90 });
  assert.equal(selectivityWindow(10, 800), null);
  const w = selectivityWindow(10, 1000);
  close(occupancy(w.lower, 10), 0.9);
  close(occupancy(w.upper, 1000), 0.1);
  const g = largestGap(10, 1000);
  close(g.concentration, 100);
  assert.ok(g.difference > occupancy(90, 10) - occupancy(90, 1000));
  assert.equal(largestGap(10, 10), null);
});

test("standard state, kcal conversion, LE and LLE", () => {
  close(freeEnergy(1), -12.3, 0.05);
  close(freeEnergy(10) - freeEnergy(1), 1.364, 0.001);
  for (const kd of [0.001, 1, 1000, 1e6])
    close(kdFromEnergy(freeEnergy(kd)) / kd, 1);
  close(ligandEfficiency(-12, 24), 0.5);
  close(lipophilicEfficiency(10, 3), 5);
});

test("target turnover: no drug leaves the target alone, constant drug reaches the closed-form steady state, no turnover is exponential", () => {
  const base = {
    c0: 100,
    plasmaHalfLife: 0.5,
    efficiency: 9900,
    turnoverHalfLife: 22,
  };
  const at = (input, hour) =>
    targetActivity(input, hour, 1).find((p) => p.x === hour).y;
  close(at({ ...base, c0: 0 }, 24), 1);
  // Constant free inhibitor: a(t) = a_ss + (1 - a_ss) exp(-(kdeg + kobs) t).
  const constant = { ...base, plasmaHalfLife: Infinity };
  const kdeg = Math.LN2 / 22;
  const kobsPerHour = 9900 * 100 * 1e-9 * 3600;
  const steady = kdeg / (kdeg + kobsPerHour);
  close(
    at(constant, 10),
    steady + (1 - steady) * Math.exp(-(kdeg + kobsPerHour) * 10),
    1e-4,
  );
  // No replacement: exp(-kobs0 tp/ln2 (1 - 2^(-t/tp))).
  const none = { ...base, turnoverHalfLife: Infinity };
  close(
    at(none, 24),
    Math.exp(-((kobsPerHour * 0.5) / Math.LN2) * (1 - 2 ** (-24 / 0.5))),
    1e-4,
  );
  // The defaults leave the target mostly inhibited after 2 h and about half active after 24 h.
  assert.ok(at(base, 2) < 0.13);
  close(at(base, 24), 0.55, 0.01);
  assert.ok(at(base, 72) > at(base, 24));
});

test("paired drug charts retain sub-nanomolar inputs on identical axes", () => {
  for (const [id, domain] of [
    ["drug-action-dose", [-2, 5]],
    ["drug-action-selectivity", [-1, 4]],
  ]) {
    const model = labModels[id];
    const { charts } = model.run(
      Object.fromEntries(model.inputs.map((i) => [i.id, i.default])),
    );
    assert.equal(charts.length, 2);
    for (const chart of charts) {
      assert.deepEqual(chart.xDomain, domain);
      assert.deepEqual(chart.yDomain, [0, 100]);
      assert.ok(chart.points.some((p) => p.x < 0));
      assert.ok(
        chart.points.every((p) => p.x >= domain[0] && p.x <= domain[1]),
      );
    }
  }
});
