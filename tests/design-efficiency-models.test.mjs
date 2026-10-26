import { labModels } from "../src/ui/models/catalog.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { designMath } from "../src/ui/models/medicinal-chemistry.mjs";

const { pIC50, ligandEfficiency, lipophilicEfficiency, baseLogD } = designMath;

test("efficiency uses molar potency and counts heavy atoms", () => {
  assert.equal(pIC50(10), 8);
  assert.equal(pIC50(1000), 6);
  assert.ok(Math.abs(ligandEfficiency(10, 30) - 0.3653333333) < 1e-9);
  assert.equal(lipophilicEfficiency(10, 3), 5);
  assert.equal(lipophilicEfficiency(10, -1), 9);
  // Tenfold potency bought with one logP unit does not improve LipE.
  assert.equal(lipophilicEfficiency(100, 2), lipophilicEfficiency(10, 3));
});

test("invalid concentrations, counts and nonfinite properties are rejected", () => {
  for (const value of [0, -1, NaN, Infinity])
    assert.throws(() => pIC50(value), RangeError);
  for (const count of [0, -1, 1.5, NaN, Infinity])
    assert.throws(() => ligandEfficiency(10, count), RangeError);
  assert.throws(() => lipophilicEfficiency(10, NaN), RangeError);
  assert.throws(() => baseLogD(3, Infinity, 7.4), RangeError);
});

test("base ionization changes logD with the correct sign and limiting behavior", () => {
  assert.ok(Math.abs(baseLogD(3, 7.4, 7.4) - (3 - Math.log10(2))) < 1e-12);
  assert.ok(baseLogD(3, 9, 7.4) < baseLogD(3, 6, 7.4));
  assert.equal(baseLogD(3, -1000, 7.4), 3);
  assert.ok(Number.isFinite(baseLogD(3, 1000, 7.4)));
});

test("shared model defaults preserve the original displayed readouts", () => {
  assert.equal(
    labModels["design-efficiency"].run({
      concentration: 10,
      count: 30,
      lipophilicity: 3,
    }).summary,
    "pIC50 8.00；LE 0.365 kcal·mol⁻¹·重原子⁻¹；LipE(logP) 5.00。",
  );
  assert.equal(
    labModels["design-pka"].run({ pKa: 9, logP: 3, pH: 7.4 }).summary,
    "模型 logD7.4 = 1.39",
  );
});
