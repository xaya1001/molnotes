import test from "node:test";
import assert from "node:assert/strict";
import {
  abMps,
  alphaFromKd,
  averageMass,
  fold,
  monoisotopicMass,
  percentOfLimiting,
} from "../src/ui/models/medicinal-chemistry.mjs";

test("cooperativity, fold differences and AB-MPS retain their numerical definitions", () => {
  assert.equal(alphaFromKd(100, 20), 5);
  assert.equal(fold(8, 2), 4);
  assert.equal(fold(2, 8), 4);
  assert.equal(abMps(1, 2, 10), 14);
  assert.equal(abMps(5, 2, 10), 14);
});

test("formula masses and limiting-reagent yields preserve units", () => {
  assert.ok(Math.abs(averageMass("C2H6O") - 46.069) < 1e-9);
  assert.ok(Math.abs(monoisotopicMass("C2H6O") - 46.041864812) < 1e-8);
  assert.equal(percentOfLimiting(25, 100, 1000), 25);
  assert.throws(() => averageMass("Xe"), /Unknown element/);
});
