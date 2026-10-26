import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { labModels, modelInputs } from "../src/ui/models/catalog.mjs";

const samples = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/content/sites/instruments/content.json",
      import.meta.url,
    ),
  ),
).data;
const data = {
  "strategy-hammett-sigma": samples.hammettSample,
  "strategy-hammett-rate": samples.hammettSample,
  "enolates-pka-dmso": samples.pkaSample,
  "enolates-pka-water": samples.pkaSample,
  "radical-selectivity": samples.radicalSample,
  "radical-distribution": samples.radicalSample,
  "saturated-chair": samples.chairSample,
  "ternary-equilibrium": samples.overlaySample,
  "degradation-recovery": samples.overlaySample,
  "route-ledger": samples.routeSample,
  "first-order-elimination": samples.pkSamples,
  "assay-panel-ratio": samples.panelSamples,
  "assay-correlation": samples.correlationSample,
  "atp-competition": samples.atpSample,
  "atp-selectivity": samples.competitionSample,
  "fbdd-depth": { rounds: 3, library: 1000000, copies: 100, reads: 10000 },
};

const defaults = (model, values) =>
  Object.fromEntries(
    modelInputs(model, values).map((input) => [input.id, input.default]),
  );

test("every lab model's defaults are inside its own input ranges", () => {
  for (const [name, model] of Object.entries(labModels))
    for (const input of modelInputs(model, data[name])) {
      if (input.kind === "select")
        assert.ok(
          input.options.some((option) => option.value === input.default),
          `${name}: ${input.id} default is not an option`,
        );
      else
        assert.ok(
          input.default >= input.min && input.default <= input.max,
          `${name}: ${input.id} default is out of range`,
        );
    }
});

test("every lab model runs with defaults and minimal inline data", () => {
  for (const [name, model] of Object.entries(labModels))
    assert.doesNotThrow(
      () => model.run(defaults(model, data[name]), data[name]),
      name,
    );
  assert.match(
    labModels["assay-correlation"].run(
      { x: "alpha", y: "beta", agreedOnly: "yes" },
      data["assay-correlation"],
    ).summary,
    /1.00（n = 3）/,
  );
  assert.match(
    labModels["atp-selectivity"].run({ exponent: 3 }, data["atp-selectivity"])
      .summary,
    /11.8 倍/,
  );
  assert.equal(
    labModels["fbdd-depth"].run(
      { exponent: 2, rounds: 3, threshold: 4 },
      data["fbdd-depth"],
    ).readouts[1].value,
    "1.00",
  );
});

const plate = labModels["plate-capacity"];
const run = (capacity, acids, amines, controls) =>
  plate.run({ capacity, acids, amines, controls });

test("plate capacity: reserved controls reduce capacity before a library is scheduled", () => {
  assert.equal(
    run(48, 6, 8, 4).summary,
    "48 个目标；可用 44 孔。需至少 2 板（每板保留同样对照）。",
  );
  assert.match(run(96, 6, 8, 4).summary, /一板可容纳/);
  assert.match(run(24, 4, 5, 4).summary, /一板可容纳/);
  assert.match(run(24, 1, 1, 24).summary, /没有剩余目标孔/);
});

test("plate capacity: invalid capacity, fractional blocks and negative controls are rejected", () => {
  for (const args of [
    [30, 1, 1, 0],
    [48, 1.5, 2, 0],
    [48, 1, 0, 0],
    [24, 1, 1, -1],
    [24, 1, 1, 25],
    [48, NaN, 2, 0],
  ])
    assert.throws(() => run(...args));
});
