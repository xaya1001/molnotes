import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signalingRasSteady as rasSteady,
  rasFraction,
  tumorTgi,
  tumorVolume,
} from "../src/ui/models/biochemical-kinetics.ts";
import { labModels, type LabInput } from "../src/ui/models/catalog.ts";

test("Ras steady state respects residual hydrolysis and approaches one only in the stated limit", () => {
  assert.ok(rasSteady(1, 0, 0.00001)! > 0.999);
  assert.equal(rasSteady(1, 0, 1)!, 0.5);
  assert.equal(rasSteady(0, 0, 0)!, null);
  assert.equal(rasFraction(10, 0, 0, 0, 0.4), 0.4);
  assert.equal(rasFraction(0, 0.3, 0.6, 0.02), 0);
  assert.ok(
    Math.abs(rasFraction(60, 0.3, 0.6, 0.02) - rasSteady(0.3, 0.6, 0.02)!) <
      1e-10,
  );
  assert.ok(rasSteady(0.3, 0, 0.02)! > rasSteady(0.03, 0, 0.02)!);
});

test("TGI is defined by growth increments, including no-growth boundaries", () => {
  assert.equal(tumorTgi(100, 0.08, 28, 0)!, 0);
  assert.equal(tumorTgi(100, 0.08, 28, 1)!, 100);
  assert.equal(tumorVolume(100, 0.08, 28, 1), 100);
  assert.equal(tumorTgi(100, 0.08, 0, 0.5)!, null);
  assert.equal(tumorTgi(100, 0, 28, 0.5)!, null);
  assert.ok(
    Math.abs(tumorTgi(100, 0.08, 28, 0.5)! - tumorTgi(200, 0.08, 28, 0.5)!) <
      1e-10,
  );
});

test("catalogue preserves Ras and tumor default readouts", () => {
  for (const [name, expected] of [
    ["signaling-ras", /0.326/],
    ["signaling-tumor", /对照 939.3 mm³，治疗 306.5 mm³；TGI 75.4%/],
  ] satisfies [string, RegExp][]) {
    const model = labModels[name];
    assert.match(
      model().run(
        Object.fromEntries(
          (model().inputs as LabInput[]).map((i) => [i.id, i.default]),
        ),
      ).summary!,
      expected,
    );
  }
});
