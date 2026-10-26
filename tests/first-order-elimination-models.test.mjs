import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eliminationCurve,
  remainingPercent,
} from "../src/ui/models/biochemical-kinetics.mjs";
const halfLives = [0.05, 8, 48];

test("first-order elimination preserves the initial amount and halves at each half-life", () => {
  for (const halfLife of halfLives) {
    assert.equal(remainingPercent(0, halfLife), 100);
    assert.equal(remainingPercent(halfLife, halfLife), 50);
    assert.equal(remainingPercent(5 * halfLife, halfLife), 3.125);
  }
  assert.equal(remainingPercent(168, 168), 50);
  assert.equal(remainingPercent(10 / 60, 2 / 60), 3.125);
});

test("one-week curves retain short-lived peptide landmarks and monotonically lose concentration", () => {
  for (const halfLife of halfLives) {
    const curve = eliminationCurve(halfLife);
    assert.deepEqual(curve[0], [0, 100]);
    assert.equal(curve.at(-1)[0], 168);
    assert.ok(
      curve.some(([x, y]) => Math.abs(x - halfLife) < 1e-10 && y === 50),
    );
    for (let i = 1; i < curve.length; i++) {
      assert.ok(curve[i][0] > curve[i - 1][0]);
      assert.ok(curve[i][1] <= curve[i - 1][1]);
      assert.ok(curve[i][1] >= 0);
    }
  }
});

test("invalid physical inputs fail explicitly", () => {
  for (const bad of [0, -1, NaN, Infinity])
    assert.throws(() => remainingPercent(1, bad), RangeError);
  for (const bad of [-1, NaN, Infinity])
    assert.throws(() => remainingPercent(bad, 1), RangeError);
});
