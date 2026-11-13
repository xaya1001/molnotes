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

test("series core completion is independent of wall time and incomplete searches fail", async () => {
  const rd = await moleculeToolkit();
  const { prepareCompound } =
    await import("../shared/chemical-library/chemistry.ts");
  const { depictSeries } = await import("../scripts/figure-depiction.ts");
  const compounds = ["c1ccccc1CCc1ccccc1", "c1ccccc1CCc1ccncc1"].map(
    (smiles, i) => ({
      compound: prepareCompound(rd, {
        id: `cmp_neutral${i}`,
        title: "Sample",
        smiles,
        sources: [],
      }),
    }),
  );
  assert.equal(depictSeries(rd, compounds, "series"), true);
  const first = compounds.map(
    ({ compound }) => compound.variants!.series.coords,
  );
  assert.equal(depictSeries(rd, compounds, "series"), true);
  assert.deepEqual(
    compounds.map(({ compound }) => compound.variants!.series.coords),
    first,
  );
  const incomplete = new Proxy(rd, {
    get(target, key) {
      if (key === "get_mcs_as_json")
        return (_mols: unknown, details: string) => {
          assert.equal(JSON.parse(details).Timeout, 0);
          return JSON.stringify({
            canceled: true,
            numAtoms: 6,
            smarts: "[#6]1:[#6]:[#6]:[#6]:[#6]:[#6]:1",
          });
        };
      return Reflect.get(target, key);
    },
  });
  assert.throws(
    () => depictSeries(incomplete, compounds, "incomplete"),
    /common-core calculation did not complete/,
  );
});

test("terminal alkoxy rotation frees neighboring labels while preserving branch geometry", async () => {
  const rd = await moleculeToolkit();
  const mol = rd.get_mol(
    "*CCC(OC)C |(-1.5,0,;0,0,;1.5,0,;3,0,;3,1.5,;4.5,1.5,;3,-1.5,)|",
  )!;
  try {
    const inkCost = (points: [number, number][]) =>
      points[4][0] <= 3.4 ? 10 : points[0][1] > 0.4 ? 0 : 5;
    const points = relievedCoordinates(mol, new Map([[0, "CO2H"]]), inkCost);
    assert.ok(points);
    assert.equal(inkCost(points), 0);
    assert.deepEqual(
      [points[1], points[2], points[3], points[6]],
      [
        [0, 0],
        [1.5, 0],
        [3, 0],
        [3, -1.5],
      ],
    );
    assert.ok(Math.abs(Math.hypot(...points[0]) - 1.5) < 1e-9);
    const ox = points[4][0] - 3,
      oy = points[4][1];
    const cx = points[5][0] - points[4][0],
      cy = points[5][1] - points[4][1];
    assert.ok(Math.abs(Math.hypot(ox, oy) - 1.5) < 1e-9);
    assert.ok(Math.abs(Math.hypot(cx, cy) - 1.5) < 1e-9);
    assert.ok(Math.abs(ox * cx + oy * cy) < 1e-9);
  } finally {
    mol.delete();
  }
});
