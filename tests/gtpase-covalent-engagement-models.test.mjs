import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rasSteady,
  kobs,
  engagement,
  lowConcentrationRate,
} from "../src/ui/models/biochemical-kinetics.mjs";
import { labModels } from "../src/ui/models/catalog.ts";

test("RAS steady state balances exchange and hydrolysis fluxes", () => {
  assert.equal(rasSteady(0, 1), 0);
  assert.equal(rasSteady(1, 0), 1);
  assert.equal(rasSteady(0, 0), 0);
  const f = rasSteady(0.2, 0.8);
  assert.ok(Math.abs(0.2 * (1 - f) - 0.8 * f) < 1e-12);
});

test("two-step kinetics reaches half the limiting rate at KI", () => {
  assert.equal(kobs(10, 10, 0.4), 0.2);
  assert.equal(kobs(0, 10, 0.4), 0);
  assert.ok(kobs(1e9, 10, 0.4) < 0.4);
});

test("engagement obeys the exponential half-time and unit conversion", () => {
  assert.equal(engagement(0.2, 0), 0);
  assert.ok(Math.abs(engagement(0.2, Math.log(2) / 0.2) - 0.5) < 1e-12);
  assert.ok(Math.abs(lowConcentrationRate(76, 1) - 0.00456) < 1e-12);
  assert.ok(engagement(0.2, 1000) <= 1);
});

test("GTPase and covalent engagement default readouts match the original page", () => {
  const run = (name) => {
    const m = labModels[name];
    return m.run(Object.fromEntries(m.inputs.map((i) => [i.id, i.default])));
  };
  assert.equal(run("gtpase-steady-state").summary, "Ras–GTP 稳态分数：20.0%");
  assert.equal(
    run("covalent-engagement").summary,
    "kobs = 0.00456 min⁻¹；60 min 共价占据 23.9%",
  );
});
