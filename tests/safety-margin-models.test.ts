import type { Unchecked } from "../shared/unchecked.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { labModels, type LabInput } from "../src/ui/models/catalog.ts";
import { safety } from "../src/ui/models/organic-chemistry.ts";

const {
  safetyWindow,
  toMicromolar,
  aucRatio,
  bazett,
  meanSem,
  honigSubjects,
  honigPrintedMeans,
} = safety;
type Period = keyof typeof honigPrintedMeans;
type Measure = keyof (typeof honigPrintedMeans)[Period];

test("safety margin compares equivalent molar units and unbound exposure", () => {
  assert.equal(safetyWindow(10, "µM", 100, "nM"), 100);
  assert.equal(safetyWindow(0.01, "mM", 0.1, "µM"), 100);
  assert.equal(safetyWindow(10, "µM", 1, "µM"), 10);
  assert.equal(toMicromolar(1000, "nM"), 1);
});

test("invalid concentrations and unsupported mass units fail explicitly", () => {
  for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => safetyWindow(value, "µM", 1, "µM"));
    assert.throws(() => safetyWindow(1, "µM", value, "µM"));
  }
  assert.throws(() => toMicromolar(1, "ng/mL"));
});

test("reversible inhibition respects clearance fraction and no-inhibitor limits", () => {
  assert.equal(aucRatio(0, 1, 0.8), 1);
  assert.equal(aucRatio(1, 1, 0), 1);
  assert.equal(aucRatio(1, 1, 1), 2);
  assert.ok(Math.abs(aucRatio(1, 1, 0.8) - 5 / 3) < 1e-12);
  assert.throws(() => aucRatio(1, 0, 0.8));
  assert.throws(() => aucRatio(1, 1, 1.1));
});

test("Honig Table 2: all 18 printed QTc follow from RR and QT by Bazett to within rounding", () => {
  assert.equal(honigSubjects.length, 6);
  let cells = 0;
  for (const s of honigSubjects)
    for (const period of ["baseline", "alone", "ketoconazole"] as const) {
      const { rr, qt, qtc } = s[period];
      assert.ok(
        Math.abs(bazett(qt, rr) - qtc) <= 0.55,
        `subject ${s.subject} ${period}: ${bazett(qt, rr)} vs ${qtc}`,
      );
      cells += 1;
    }
  assert.equal(cells, 18);
  assert.throws(() => bazett(0, 800));
  assert.throws(() => bazett(400, -1));
});

test("Honig Table 2: the means follow from the rows except the ketoconazole QTc, printed 490±16 against 484.5±14.8", () => {
  const stat = (period: Period, key: Measure) =>
    meanSem(honigSubjects.map((s: Unchecked) => s[period][key]));
  const printed = (period: Period, key: Measure) => {
    const [mean, sem] = honigPrintedMeans[period][key].split("±").map(Number);
    return { mean, sem };
  };
  for (const period of ["baseline", "alone", "ketoconazole"] as const)
    for (const key of ["rr", "qt", "qtc"] as const) {
      const calc = stat(period, key);
      const text = printed(period, key);
      const sameMean = Math.abs(calc.mean - text.mean) < 0.5 + 1e-9;
      if (period === "ketoconazole" && key === "qtc") {
        assert.ok(!sameMean);
        assert.equal(calc.mean, 484.5);
        assert.equal(calc.sem.toFixed(1), "14.8");
        assert.deepEqual(text, { mean: 490, sem: 16 });
      } else
        assert.ok(sameMean, `${period} ${key}: ${calc.mean} vs ${text.mean}`);
    }
  // "402±165": the SEM of the single-drug QT cannot be 165 ms; the rows give 15.4.
  assert.equal(stat("alone", "qt").sem.toFixed(1), "15.4");
  assert.throws(() => meanSem([1]));
});

test("shared lab defaults reproduce the original page readouts", () => {
  for (const [name, expected] of [
    ["safety-window", "安全窗口：105.56 倍"],
    ["safety-cyp", "AUC 倍数：1.667"],
    ["safety-qtc", "QTc = 440.0 ms"],
  ]) {
    const model = labModels[name];
    assert.equal(
      model.run(
        Object.fromEntries(
          (model.inputs as LabInput[]).map((input) => [
            input.id,
            input.default,
          ]),
        ),
      ).summary!,
      expected,
    );
  }
});
