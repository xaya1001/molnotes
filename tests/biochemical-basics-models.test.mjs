import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../src/ui/models/biochemical-kinetics.mjs";
import { labModels } from "../src/ui/models/catalog.mjs";

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("side-chain ionization distinguishes protonation, charge and neutral fraction", () => {
  near(m.protonated(6, 6), 0.5);
  near(m.sideChainCharge(6, 6, "acid"), -0.5);
  near(m.sideChainCharge(6, 6, "base"), 0.5);
  assert.ok(m.protonated(0, 6) > 0.999);
  assert.ok(m.protonated(14, 6) < 0.000001);
  for (const pH of [0, 7, 14]) {
    near(
      m.neutralFraction(pH, 6, "acid") + m.neutralFraction(pH, 6, "base"),
      1,
    );
  }
});

test("binding uses nM to M conversion and starts unbound", () => {
  near(m.occupancy(10, 10), 0.5);
  near(m.occupancy(0, 10), 0);
  near(m.offRate(10, 1e6), 0.01);
  near(m.association(10, 10, 1e6, 0), 0);
  near(m.association(10, 10, 1e6, 1e6), 0.5);
  assert.ok(m.association(10, 10, 1e6, 10) > m.association(10, 10, 1e5, 10));
});

test("three inhibition modes preserve their kinetic invariants", () => {
  const c = m.enzymeParameters(10, 100, 10, 10, "competitive");
  assert.deepEqual(c, { km: 20, vmax: 100 });
  assert.deepEqual(m.enzymeParameters(10, 100, 10, 10, "noncompetitive"), {
    km: 10,
    vmax: 50,
  });
  const u = m.enzymeParameters(10, 100, 10, 10, "uncompetitive");
  near(u.km / u.vmax, 0.1);
  for (const mode of [
    "none",
    "competitive",
    "noncompetitive",
    "uncompetitive",
  ]) {
    near(m.velocity(0, 10, 100, 10, 10, mode), 0);
    near(m.velocity(10, 10, 100, 0, 10, mode), 50);
  }
  near(m.velocity(20, 10, 100, 10, 10, "competitive"), 50);
});

test("permeability is bounded and responds oppositely for acids and bases", () => {
  for (const pH of [0, 7, 14])
    for (const pKa of [2, 7, 12])
      for (const logP of [-2, 0, 6])
        for (const kind of ["acid", "base"]) {
          const value = m.permeability(pH, pKa, logP, kind);
          assert.ok(value >= 0 && value <= 1);
        }
  assert.ok(m.permeability(5, 7, 2, "acid") > m.permeability(9, 7, 2, "acid"));
  assert.ok(m.permeability(5, 7, 2, "base") < m.permeability(9, 7, 2, "base"));
  near(m.permeability(7, 7, 0, "acid"), 1 / 3);
});

test("copies and volume retain concentration scaling", () => {
  near(m.copiesToNm(6.02214076e5, 1), 1000);
  near(m.copiesToNm(1000, 1), m.copiesToNm(10000, 10));
});

test("chapter predictions use the documented ionization and kinetic values", () => {
  near(100 * m.protonated(7, 6), 100 / 11);
  near(m.sideChainCharge(7, 6, "base"), 1 / 11);
  near(m.occupancy(10, 1), 10 / 11);
  near(m.occupancy(10, 100), 1 / 11);
  near(m.velocity(10, 10, 100, 10, 10, "competitive"), 100 / 3);
});

test("dissociative half-life converts to koff and residence time", () => {
  near(m.koffFromHalfLife(2100), Math.LN2 / 2100);
  assert.ok(Math.abs(m.koffFromHalfLife(2100) - 3.3e-4) < 1e-6);
  near(m.residenceTime(m.koffFromHalfLife(2100)) / 60, 2100 / 60 / Math.LN2);
  near(m.dissociated(300 * 60, 300 * 60), 0.5);
  assert.ok(Math.abs(m.dissociated(24 * 3600, 300 * 60) - 0.964) < 1e-3);
});

test("IC50 follows the Cheng-Prusoff forms and halves the uninhibited rate", () => {
  near(m.ic50(0.1, 50, "competitive"), 55);
  near(m.ic50(10, 50, "competitive"), 550);
  near(m.ic50(1, 50, "competitive"), 100);
  near(m.ic50(0.1, 50, "uncompetitive"), 550);
  near(m.ic50(10, 50, "uncompetitive"), 55);
  near(m.ic50(1, 50, "uncompetitive"), 100);
  for (const r of [0.1, 1, 10]) near(m.ic50(r, 50, "noncompetitive"), 50);
  assert.equal(m.ic50(0, 50, "uncompetitive"), Infinity);
  // Definition check against the rate law: at [I] = IC50 the velocity is half of the uninhibited one.
  for (const mode of ["competitive", "noncompetitive", "uncompetitive"])
    for (const r of [0.1, 0.5, 1, 3, 10]) {
      const km = 10;
      const ki = 50;
      const half = m.velocity(r * km, km, 100, 0, ki, "none") / 2;
      near(m.velocity(r * km, km, 100, m.ic50(r, ki, mode), ki, mode), half);
    }
});

test("catalogue retains the five default lab readouts", () => {
  for (const [name, expected] of [
    ["bio-scale", /1.00e\+3 nm/],
    ["bio-ionization", /质子化：9.1%/],
    ["bio-binding", /当前时刻 43.2%/],
    ["bio-enzyme", /v = 33.33/],
    ["bio-permeability", /20.08%/],
  ]) {
    const model = labModels[name];
    const result = model.run(
      Object.fromEntries(model.inputs.map((i) => [i.id, i.default])),
    );
    assert.match(result.summary, expected, name);
  }
});
