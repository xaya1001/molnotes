import assert from "node:assert/strict";
import { test } from "node:test";
import {
  degradation,
  absoluteHalfLoss,
} from "../src/ui/models/biochemical-kinetics.ts";
import { labModels, type LabInput } from "../src/ui/models/catalog.ts";

test("teaching response has zero baseline, amplitude-relative half response and bounded saturation", () => {
  assert.equal(degradation(80, 10, 0), 0);
  assert.equal(degradation(80, 10, 10), 40);
  assert.equal(degradation(0, 10, 100), 0);
  assert.ok(degradation(80, 10, 1e6) < 80);
  assert.ok(degradation(80, 10, 1e6) > 79.99);
});

test("absolute 50 percent loss is unreachable for Dmax <= 50 and distinct from relative half response", () => {
  for (const dmax of [0, 40, 50])
    assert.equal(absoluteHalfLoss(dmax, 10), null);
  assert.equal(absoluteHalfLoss(100, 10), 10);
  const concentration = absoluteHalfLoss(80, 10);
  assert.ok(Math.abs(degradation(80, 10, concentration!) - 50) < 1e-10);
  assert.ok(concentration! > 10);
});

test("catalogue preserves default degradation readout", () => {
  const model = labModels["degradation-dose-response"];
  const defaults = Object.fromEntries(
    (model().inputs as LabInput[]).map((i) => [i.id, i.default]),
  );
  assert.match(
    model().run(defaults).summary!,
    /蛋白损失 40.0%；剩余 60.0%.*16.7 nM/,
  );
  assert.match(
    model().run({ ...defaults, dmax: 40 }).summary!,
    /有限浓度下不可达/,
  );
});
