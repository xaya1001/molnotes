import { test } from "node:test";
import assert from "node:assert/strict";
import init from "@rdkit/rdkit";
import {
  validateMechanismFrames,
  validateCatalyticCycle,
} from "../shared/mechanism.ts";
import { validateMechanismChemistry } from "../shared/mechanism-chemistry.ts";
import {
  atomSources,
  interpolatePoint,
  mappedPositions,
  curvedArrow,
  cubicPoint,
  cycleLayout,
} from "../shared/mechanism-geometry.ts";
import {
  substitution,
  addition,
  radical,
  cycleFrames,
  couplingCycle,
} from "../src/showcase/data/mechanisms.ts";
const toolkit = await init();
for (const [name, frames] of Object.entries({
  substitution,
  addition,
  radical,
  cycleFrames,
}))
  test(`mapped ${name} frames resolve against actual atoms and bonds`, () => {
    validateMechanismFrames(frames, "sample");
    validateMechanismChemistry(toolkit, frames, "sample");
  });
test("map and endpoint errors identify the frame before publication", () => {
  const sample = () => structuredClone(substitution);
  let f = sample();
  f[0].molecules[1].atomMap = [1];
  assert.throws(
    () => validateMechanismFrames(f, "sample"),
    /frame 1.*duplicate/,
  );
  f = sample();
  f[0].arrows[0].to = { atom: 900 };
  assert.throws(
    () => validateMechanismFrames(f, "sample"),
    /frame 1.*unknown atom map 900/,
  );
  f = sample();
  f[0].arrows[0].to = { bond: [2, 3] };
  assert.throws(
    () => validateMechanismChemistry(toolkit, f, "sample"),
    /frame 1.*unknown bond/,
  );
  f = sample();
  f[0].molecules[0].atomMap = [1];
  assert.throws(
    () => validateMechanismChemistry(toolkit, f, "sample"),
    /frame 1.*count/,
  );
  f = sample();
  f[2].molecules[0].atomMap = [3, 1];
  assert.throws(
    () => validateMechanismChemistry(toolkit, f, "sample"),
    /frame 3.*changes element/,
  );
});
test("source ownership follows maps across molecule merging and new bonds", () => {
  const sources = atomSources(addition);
  assert.equal(sources.get(1), sources.get(2));
  assert.notEqual(sources.get(1), sources.get(3));
  assert.deepEqual(
    addition[1].molecules[0].atomMap.map((id) => sources.get(id)),
    [0, 0, 1],
  );
});
test("interpolation preserves every mapped atom and lands exactly on target coordinates", () => {
  const a = {
    atoms: [
      { map: 1, x: 0, y: 0, source: 0 },
      { map: 2, x: 15, y: 4, source: 1 },
    ],
    bonds: [],
  };
  const b = {
    atoms: [
      { map: 2, x: 80, y: -13, source: 1 },
      { map: 1, x: -20, y: 36, source: 0 },
    ],
    bonds: [],
  };
  const half = mappedPositions(a, b, 0.5);
  assert.equal(half.size, 2);
  assert.deepEqual(half.get(1), { x: -10, y: 18 });
  const end = mappedPositions(a, b, 1);
  for (const p of b.atoms) assert.deepEqual(end.get(p.map), { x: p.x, y: p.y });
  assert.deepEqual(
    interpolatePoint({ x: 1e12, y: -3 }, { x: 0.1, y: 0.3 }, 1),
    { x: 0.1, y: 0.3 },
  );
});
test("automatic cubic bend chooses the unobstructed side of labels and bonds", () => {
  const a = { x: 0, y: 0 },
    b = { x: 100, y: 0 };
  const geometry = {
    atoms: [
      { map: 1, x: 50, y: 26, source: 0 },
      { map: 2, x: 35, y: 30, source: 0 },
      { map: 3, x: 65, y: 30, source: 0 },
    ],
    bonds: [{ a: 2, b: 3, order: 1 }],
  };
  const curve = curvedArrow(a, b, geometry, undefined, 12);
  assert.ok(curve.bend < 0);
  assert.equal(curve.score, 0);
  for (let i = 1; i < 20; i++) {
    const p = cubicPoint(curve.a, curve.c, curve.d, curve.b, i / 20);
    assert.ok(p.y < 0);
  }
  const forced = curvedArrow(a, b, geometry, 0.35, 12);
  assert.ok(forced.score > 0);
});
test("cycles retain source order, close the last arc, and validate branch direction", () => {
  validateCatalyticCycle(couplingCycle, cycleFrames, "sample");
  const layout = cycleLayout(4, 100);
  assert.deepEqual(
    layout.map((p) => Math.round(p.x)),
    [0, 100, 0, -100],
  );
  assert.ok(Math.abs(layout[3].next - (3 * Math.PI) / 2) < 1e-12);
  const bad = structuredClone(couplingCycle);
  bad.intermediates[0] = "missing";
  assert.throws(
    () => validateCatalyticCycle(bad, cycleFrames, "sample"),
    /unknown cycle intermediate/,
  );
});
