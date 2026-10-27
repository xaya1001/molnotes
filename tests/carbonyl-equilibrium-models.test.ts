import test from "node:test";
import assert from "node:assert/strict";
import { labModels, type LabInput } from "../src/ui/models/catalog.ts";

import {
  acidEquilibrium,
  equilibriumFromDeltaG,
  pathwayFractions,
  productShare,
} from "../src/ui/models/organic-chemistry.ts";

test("same-scale acid equilibria follow the conjugate-acid difference", () => {
  assert.equal(acidEquilibrium(25, 33).K, 1e8);
  assert.equal(acidEquilibrium(10, 10).K, 1);
  assert.ok(Math.abs(acidEquilibrium(10, 4.8).K - 6.3095734448e-6) < 1e-15);
  assert.throws(() => acidEquilibrium(NaN, 20));
  assert.throws(() => acidEquilibrium(61, 20));
});

test("barriers control initial capture, product energies control equilibrium", () => {
  const x = pathwayFractions(298, 55, 60, -8.8);
  assert.ok(x.kineticP > 0.88 && x.kineticP < 0.89);
  assert.ok(x.equilibriumP > 0.027 && x.equilibriumP < 0.029);
  const swapped = pathwayFractions(298, 60, 55, 8.8);
  assert.ok(Math.abs(x.kineticP + swapped.kineticP - 1) < 1e-12);
  assert.ok(Math.abs(x.equilibriumP + swapped.equilibriumP - 1) < 1e-12);
  assert.deepEqual(pathwayFractions(298, 55, 55, 0), {
    kineticP: 0.5,
    equilibriumP: 0.5,
  });
  assert.throws(() => pathwayFractions(0, 55, 60, -8.8));
  assert.throws(() => pathwayFractions(298, 55, Infinity, 0));
});

const equilibriumReference = [
  [0, 1.0, 50, 0.5],
  [1, 1.5, 60, 0.5],
  [2, 2.2, 69, 0.5],
  [3, 3.5, 77, 0.5],
  [4, 5.0, 83, 0.5],
  [5, 7.5, 88, 0.5],
  [10, 57, 98, 0.5],
  [15, 430, 99.8, 0.05],
  [20, 3200, 99.97, 0.005],
  [50, 5.8e8, 99.9999998, 5e-8],
];

test("K and the product share follow ΔG = −RT ln K and reproduce the reference equilibrium table", () => {
  for (const [dG, printedK, printedShare, half] of equilibriumReference) {
    const { K, productShare: share } = equilibriumFromDeltaG(-dG, 298);
    assert.ok(Math.abs(share * 100 - printedShare) <= half, `ΔG ${dG}`);
    // the book prints K = 3.5 for ΔG = 3 kJ/mol; exp(3000/(8.314×298)) is 3.36, and the 77% beside it fits 3.36
    assert.ok(Math.abs(K / printedK - 1) < 0.05, `ΔG ${dG}`);
  }
  assert.ok(Math.abs(equilibriumFromDeltaG(0, 298).K - 1) < 1e-12);
  assert.ok(
    Math.abs(
      equilibriumFromDeltaG(5, 298).K * equilibriumFromDeltaG(-5, 298).K - 1,
    ) < 1e-12,
  );
  assert.throws(() => equilibriumFromDeltaG(100, 298));
  assert.throws(() => equilibriumFromDeltaG(-8.8, 100));
  assert.throws(() => equilibriumFromDeltaG(NaN, 298));
});

test("the numbers the chapters quote from the hydration table and the E/Z example follow from K", () => {
  const ez = equilibriumFromDeltaG(-8.8, 298);
  assert.ok(Math.abs(ez.K - 35) < 0.5);
  assert.ok(Math.abs(ez.productShare - 0.972) < 0.001);
  assert.ok(Math.abs(productShare(1.06) - 0.5146) < 1e-4); // acetaldehyde, p.135: about half hydrate
  assert.ok(Math.abs(productShare(0.001) * 100 - 0.0999) < 1e-3); // acetone: about 0.1%
  assert.ok(Math.abs(productShare(2280) * 100 - 99.956) < 1e-3); // formaldehyde
  assert.ok(Math.abs(1 - productShare(1.2e6) - 8.33e-7) < 1e-9); // hexafluoroacetone: one in a million
  assert.throws(() => productShare(-1));
});

test("shared lab defaults reproduce the original page readouts", () => {
  for (const [name, expected] of [
    ["carbonyl-acidity", "log₁₀K = 8.0；K = 1.00e+8。右侧有利。"],
    ["carbonyl-equilibrium", "K = 34.9；产物侧占 97.21%。"],
    ["carbonyl-pathways", "初始 P 88.3% / Q 11.7%；平衡 P 2.8% / Q 97.2%。"],
  ]) {
    const model = labModels[name];
    assert.equal(
      model().run(
        Object.fromEntries(
          (model().inputs as LabInput[]).map((input) => [
            input.id,
            input.default,
          ]),
        ),
      ).summary!,
      expected,
    );
  }
});
