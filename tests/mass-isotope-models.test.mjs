import test from "node:test";
import assert from "node:assert/strict";
import {
  isotopePattern,
  adductMz,
  PROTON,
  SODIUM,
} from "../src/ui/models/medicinal-chemistry.mjs";
import { labModels } from "../src/ui/models/catalog.mjs";

const close = (a, b, eps = 1e-10) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("natural isotope combinations conserve probability including zero atoms and sulfur M+1/M+4", () => {
  assert.deepEqual(isotopePattern("Cl", 0), [
    { offset: 0, probability: 1, intensity: 100 },
  ]);
  const cl = isotopePattern("Cl", 2);
  close(cl[0].probability, 0.7576 ** 2);
  close(cl[1].probability, 2 * 0.7576 * 0.2424);
  close(cl[2].probability, 0.2424 ** 2);
  for (const e of ["Cl", "Br", "S"])
    for (const n of [1, 2, 8])
      close(
        isotopePattern(e, n).reduce((s, p) => s + p.probability, 0),
        1,
      );
  const s = isotopePattern("S", 1);
  assert.deepEqual(
    s.map((p) => p.offset),
    [0, 1, 2, 4],
  );
  close(s[2].probability, 0.0425);
  close(isotopePattern("Br", 1)[1].intensity, (100 * 0.4931) / 0.5069);
});

test("positive ions use neutral monoisotopic mass and correct charge divisor", () => {
  close(adductMz(300, "H"), 300 + PROTON);
  close(adductMz(300, "Na"), 300 + SODIUM);
  close(adductMz(300, "2H"), 150 + PROTON);
  close(adductMz(300, "Na") - adductMz(300, "H"), 21.981941533379);
  assert.ok(Number.isFinite(adductMz(Number.MIN_VALUE, "H")));
  assert.ok(Number.isFinite(adductMz(10000, "Na")));
});

test("invalid mass, count and model selection are rejected", () => {
  for (const n of [-1, 0.5, 9, NaN, Infinity])
    assert.throws(() => isotopePattern("Cl", n));
  assert.throws(() => isotopePattern("C", 1));
  for (const m of [0, -1, NaN, Infinity, 10001])
    assert.throws(() => adductMz(m, "H"));
  assert.throws(() => adductMz(100, "K"));
});

test("mass lab preserves default m/z and isotope table precision", () => {
  const model = labModels["spectra-mass"];
  const result = model.run(
    Object.fromEntries(model.inputs.map((input) => [input.id, input.default])),
  );
  assert.equal(result.summary, "计算 m/z：301.007276");
  assert.deepEqual(result.tables[0].rows, [
    ["+0", "75.7600", "100.00"],
    ["+2", "24.2400", "32.00"],
  ]);
});
