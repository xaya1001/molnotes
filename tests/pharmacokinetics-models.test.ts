import { labModels } from "../src/ui/models/catalog.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { leadMath } from "../src/ui/models/medicinal-chemistry.ts";

const {
  logD,
  concentration,
  repeatedConcentration,
  steadyConcentration,
  peakTime,
  accumulation,
  auc,
  halfLife,
} = leadMath;

const p = { dose: 100, f: 0.5, ka: 1, cl: 5, vd: 50, tau: 12 };

const near = (actual: number, expected: number, tol = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < tol, `${actual} != ${expected}`);

test("monoprotic logD at pKa and ionization direction", () => {
  for (const kind of ["acid", "base"])
    near(logD(3, 7, 7, kind), 3 - Math.log10(2));
  assert.ok(logD(3, 7, 9, "acid") < logD(3, 7, 5, "acid"));
  assert.ok(logD(3, 7, 9, "base") > logD(3, 7, 5, "base"));
});

test("oral peak matches the analytical maximum, including ka = ke", () => {
  for (const ka of [1, 0.1, 0.03]) {
    const q = { ...p, ka };
    const t = peakTime(q);
    assert.ok(concentration(t, q) > concentration(t - 0.01, q));
    assert.ok(concentration(t, q) > concentration(t + 0.01, q));
  }
  near(halfLife(p), Math.LN2 / 0.1);
  near(auc(p), 10);
});

test("geometric accumulation and oral steady state agree with repeated dosing", () => {
  near(accumulation(p), 1 / (1 - Math.exp(-0.1 * 12)));
  for (const ka of [1, 0.1, 0.03])
    for (const t of [0, 2, 8, 11.9]) {
      const q = { ...p, ka };
      near(repeatedConcentration(1200 + t, q), steadyConcentration(t, q), 1e-7);
    }
});

test("shared PK and property defaults retain original readouts", () => {
  assert.match(
    labModels["lead-pk"]().run(p).summary!,
    /t½ = 6.93 h；单剂 AUC = 10.00/,
  );
  assert.equal(
    labModels["lead-properties"]().run({ kind: "base", pKa: 7, logP: 3 })
      .summary!,
    "pH = 7.4 时 logD = 2.85；pH = pKa 时 logD = 2.70。",
  );
});
