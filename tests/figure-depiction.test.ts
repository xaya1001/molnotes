import assert from "node:assert/strict";
import test from "node:test";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { relievedCoordinates } from "../scripts/figure-coordinate-relief.ts";

test("wide terminal groups clear neighboring atom glyphs while retaining bond length", async () => {
  const rd = await moleculeToolkit();
  const mol = rd.get_mol(
    "*CCN1CC1 |(0,0,;0,-1.5,;1.5,-1.5,;2.4,0.2,;3.4,-0.9,;3.4,1.1,)|",
  )!;
  try {
    const points = relievedCoordinates(mol, new Map([[0, "CO2H"]]));
    assert.ok(points);
    assert.ok(Math.hypot(points[0][0], points[0][1]) > 0.1);
    assert.ok(
      Math.abs(
        Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) -
          1.5,
      ) < 1e-9,
    );
  } finally {
    mol.delete();
  }
});

test("native ink measurement separates a single terminal label while preserving its bond", async () => {
  const rd = await moleculeToolkit();
  const mol = rd.get_mol("*CC |(0,1.5,;0,0,;1.5,0,)|")!;
  try {
    const inkCost = (points: [number, number][]) =>
      points[0][0] < 0.4 ? 10 : 0;
    const points = relievedCoordinates(mol, new Map([[0, "CO2Et"]]), inkCost);
    assert.ok(points);
    assert.equal(inkCost(points), 0);
    assert.deepEqual(points.slice(1), [
      [0, 0],
      [1.5, 0],
    ]);
    assert.ok(Math.abs(Math.hypot(...points[0]) - 1.5) < 1e-9);
  } finally {
    mol.delete();
  }
});
