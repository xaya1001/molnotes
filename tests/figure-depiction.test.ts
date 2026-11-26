import { arrowAt } from "./helpers/figure-graph.ts";
import { appearances } from "../shared/chemical-library/figure-layout.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { relievedCoordinates } from "../scripts/figure-coordinate-relief.ts";

test("aligned route depictions preserve a linear triple-bond centre", async () => {
  const { compileFigure } = await import("../scripts/figure-scene.ts");
  const { graphOf } = await import("../shared/chemical-library/chemistry.ts");
  const compiled = await compileFigure({
    kind: "scheme",
    states: {
      a: { compounds: { structure: { label: "a", smiles: "CCc1ccccc1" } } },
      b: { compounds: { structure: { label: "b", smiles: "C#Cc1ccccc1" } } },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a" }],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
      },
    },
  });
  const reaction = arrowAt(compiled.entries[compiled.reference.ref]);
  assert.equal(reaction.role, "reaction");
  const participant = appearances(reaction.to)[0],
    placement = reaction.drawing.scene.molecules.find(
      (m) => m.id === participant.id,
    )!;
  const compound = compiled.entries[participant.compound];
  assert.equal(compound.kind, "compound");
  const layout = placement.variant
    ? compound.variants![placement.variant]
    : compound.layout;
  const mol = (await moleculeToolkit()).get_mol(compound.smiles)!;
  try {
    const graph = graphOf(mol),
      triple = graph.bonds.find((bond) => bond.bo === 3)!;
    const centre = triple.atoms.find(
      (i) => graph.bonds.filter((bond) => bond.atoms.includes(i)).length === 2,
    )!;
    const neighbours = graph.bonds
      .filter((bond) => bond.atoms.includes(centre))
      .map((bond) => bond.atoms.find((i) => i !== centre)!);
    const point = (i: number) => layout.coords[compound.atomIds[i]];
    const c = point(centre),
      [a, b] = neighbours.map(point);
    const u = { x: a.x - c.x, y: a.y - c.y },
      v = { x: b.x - c.x, y: b.y - c.y };
    assert.ok(
      (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)) <
        -Math.cos((5 * Math.PI) / 180),
    );
  } finally {
    mol.delete();
  }
});

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

test("cyclic enone aligned to a same-ring tertiary alcohol places its carbonyl oxygen on the external bisector", async () => {
  const { compileFigure } = await import("../scripts/figure-scene.ts");
  const compiled = await compileFigure({
    kind: "scheme",
    title: "Ring carbonyl alignment",
    states: {
      enone: {
        compounds: {
          structure: {
            label: "enone",
            smiles: "[O:1]=[C:2]1[CH:3]=[CH:4][CH2:5][CH2:6][CH2:7]1",
          },
        },
      },
      alcohol: {
        compounds: {
          structure: {
            label: "alcohol",
            smiles: "C[C:2]1([O:1])[CH:3]=[CH:4][CH2:5][CH2:6][CH2:7]1",
          },
        },
      },
    },
    arrows: {
      add: {
        from: [{ state: "enone", id: "enone" }],
        to: [{ state: "alcohol", id: "product-alcohol" }],
        kind: "forward",
        role: "reaction",
      },
    },
    layout: { anchor: "alcohol" },
  });
  const reaction = arrowAt(compiled.entries[compiled.reference.ref]);
  const participant = appearances(reaction.from)[0];
  const placement = reaction.drawing.scene.molecules.find(
    (molecule) => molecule.id === participant.id,
  )!;
  const compound = compiled.entries[placement.compound];
  assert.equal(compound.kind, "compound");
  assert.ok(placement.variant);
  const layout = compound.variants![placement.variant];
  const rd = await moleculeToolkit();
  const mol = rd.get_mol(compound.smiles)!;
  try {
    const graph = JSON.parse(mol.get_json()).molecules[0] as {
      atoms: { z?: number }[];
      bonds: { atoms: [number, number] }[];
    };
    const oxygen = graph.atoms.findIndex((atom) => atom.z === 8);
    assert.ok(oxygen >= 0);
    const neighbors = (index: number) =>
      graph.bonds.flatMap(({ atoms: [a, b] }) =>
        a === index ? [b] : b === index ? [a] : [],
      );
    const carbonyl = neighbors(oxygen)[0];
    const [left, right] = neighbors(carbonyl).filter((a) => a !== oxygen);
    const point = (index: number) => layout.coords[compound.atomIds[index]];
    const pC = point(carbonyl),
      pO = point(oxygen),
      pA = point(left),
      pB = point(right);
    const unit = (
      from: { x: number; y: number },
      to: { x: number; y: number },
    ) => {
      const dx = to.x - from.x,
        dy = to.y - from.y,
        length = Math.hypot(dx, dy);
      return [dx / length, dy / length] as const;
    };
    const [ax, ay] = unit(pC, pA),
      [bx, by] = unit(pC, pB),
      [ox, oy] = unit(pC, pO);
    const bisX = -(ax + bx),
      bisY = -(ay + by),
      bisLen = Math.hypot(bisX, bisY);
    const dot = Math.max(-1, Math.min(1, (ox * bisX + oy * bisY) / bisLen));
    const deviationDegrees = (Math.acos(dot) * 180) / Math.PI;
    assert.ok(
      deviationDegrees < 2,
      `Expected carbonyl oxygen on external bisector, got ${deviationDegrees.toFixed(2)}° deviation`,
    );
  } finally {
    mol.delete();
  }
});
