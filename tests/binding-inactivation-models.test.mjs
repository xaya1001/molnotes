import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inactivated,
  inactivationRate as kobs,
  remaining,
  residence,
} from "../src/ui/models/biochemical-kinetics.mjs";
import { labModels } from "../src/ui/models/catalog.mjs";

test("two-step inactivation has a half-maximal rate at KI and saturates", () => {
  assert.equal(kobs(0, 100, 0.1), 0);
  assert.equal(kobs(100, 100, 0.1), 0.05);
  assert.ok(
    Math.abs(kobs(200, 100, 0.1) / kobs(100, 100, 0.1) - 4 / 3) < 1e-12,
  );
  assert.ok(kobs(1e9, 100, 0.1) < 0.1);
  assert.equal(inactivated(0.1, 0), 0);
  assert.ok(Math.abs(inactivated(0.1, Math.log(2) / 0.1) - 0.5) < 1e-12);
});

test("complete washout follows lifetime rather than initial equilibrium affinity", () => {
  assert.equal(remaining(0.9, 0, 60), 0.9);
  assert.ok(Math.abs(remaining(0.9, 0.1, Math.log(2) / 0.1) - 0.45) < 1e-12);
  assert.equal(residence(0.1), 10);
  assert.ok(remaining(0.9, 0.005, 60) > remaining(0.9, 0.1, 60));
});

test("catalogue retains kinetic and washout default values", () => {
  for (const [name, expected] of [
    ["covalent-inactivation", /kobs=0.0500 min⁻¹；60 min 失活 95.0%/],
    ["binding-dissociation", /60 min 剩余占据：0.2%。τ=10.0 min/],
  ]) {
    const model = labModels[name];
    assert.match(
      model.run(Object.fromEntries(model.inputs.map((i) => [i.id, i.default])))
        .summary,
      expected,
    );
  }
});
