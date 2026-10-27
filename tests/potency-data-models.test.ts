import type { Unchecked } from "../shared/unchecked.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  concentrationSpan,
  chengPrusoff,
  hill,
  pIC50,
  comparePotency,
  freeConcentration,
} from "../src/ui/models/medicinal-chemistry.ts";
import { labModels, type LabInput } from "../src/ui/models/catalog.ts";

const near = (a: Unchecked, b: Unchecked) => assert.ok(Math.abs(a - b) < 1e-10);

test("competitive IC50 converts using substrate/Km, preserving concentration units", () => {
  near(chengPrusoff(30, 2), 10);
  near(chengPrusoff(10, 0), 10);
  assert.throws(() => chengPrusoff(0, 1));
  assert.throws(() => chengPrusoff(10, -1));
});

test("Hill midpoint is half of the compound maximum, not necessarily 50% system response", () => {
  near(hill(10, 10, 2, 40), 20);
  near(hill(0, 10, 1), 0);
  near(hill(100, 10, 2), 10000 / 101);
  assert.ok(hill(1, 10, 2) < hill(1, 10, 1));
  assert.ok(hill(100, 10, 2) > hill(100, 10, 1));
  assert.throws(() => hill(1, 0, 1));
});

test("pIC50 differences and independent mean errors distinguish precision from practical effect", () => {
  near(pIC50(1), 9);
  near(pIC50(1000), 6);
  near(pIC50(3) - pIC50(5), Math.log10(5 / 3));
  const small = comparePotency(3, 5, 0.2, 0.2, 3, 3);
  near(small.standardError, Math.sqrt(0.08 / 3));
  assert.equal(small.exceedsNoise, false);
  assert.equal(comparePotency(3, 5, 0.2, 0.2, 30, 30).exceedsNoise, true);
  assert.equal(comparePotency(3, 5, 0.2, 0.2, 30, 30).meaningful, false);
  assert.equal(comparePotency(3, 30, 0.2, 0.2, 3, 3).meaningful, true);
  assert.throws(() => comparePotency(3, 5, 0.2, 0.2, 1, 3));
  assert.throws(() => pIC50(NaN));
});

test("free concentration cannot exceed total and rejects invalid fractions", () => {
  near(freeConcentration(1000, 0.01), 10);
  near(freeConcentration(1000, 0), 0);
  assert.throws(() => freeConcentration(1000, 1.1));
});

const round = (value: Unchecked, digits: Unchecked) =>
  Number(value.toFixed(digits));

test("Hill curves: 10% to 90% inhibition spans 81-fold at h = 1 and 4.3-fold at h = 3", () => {
  near(concentrationSpan(0.1, 0.9), 81);
  assert.equal(round(concentrationSpan(0.1, 0.9, 3), 1), 4.3);
  assert.throws(() => concentrationSpan(0.9, 0.1));
  assert.throws(() => concentrationSpan(0.1, 0.9, 0));
});

test("teaching lab defaults preserve the original displayed readings", () => {
  const result = (id: string) => {
    const model = labModels["data-literacy-" + id];
    return model.run(
      Object.fromEntries(
        (model.inputs as LabInput[]).map((input) => [input.id, input.default]),
      ),
    );
  };
  assert.match(
    result("constants").summary!,
    /IC50 = 20.0 nM；反算 Ki = 10.0 nM/,
  );
  assert.match(
    result("error").summary!,
    /8.523 \/ 8.301；差值 0.222；2SE = 0.327/,
  );
  assert.match(
    result("dose-response").summary!,
    /响应为 50%；在 10 nM 时为 50.0%/,
  );
  assert.match(result("in-vivo").summary!, /10.0 nM/);
});
