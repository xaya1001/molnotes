import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDefaultCoords } from "../shared/chemical-toolkit.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  layoutCandidates,
  layoutProblems,
  withCoordinates,
} from "../shared/molecule-layout.ts";

const toolkit = await moleculeToolkit();
// RDKit's own layout folds the peroxide bridge of this cage onto itself and
// stacks two phenyl rings of this phosphorane.
const cage =
  "C[C@@H]1CC[C@H]2[C@@H](C)C(=O)O[C@@H]3O[C@@]4(C)CC[C@@H]1[C@@]23OO4";
const phosphorane = "CC1O[P](c2ccccc2)(c2ccccc2)(c2ccccc2)C1";
const canonical = (smiles: string) => {
  const mol = toolkit.get_mol(smiles);
  try {
    return mol!.get_smiles();
  } finally {
    mol!.delete();
  }
};

test("layout problems are found where RDKit's drawing stacks atoms, and only there", () => {
  assert.ok(layoutProblems(toolkit, cage).length > 0);
  assert.ok(layoutProblems(toolkit, phosphorane).length > 0);
  for (const plain of [
    "CC(=O)Oc1ccccc1C(=O)O",
    "C[C@]12CC[C@H]3[C@H]([C@@H]1CC[C@@H]2O)CCC4=C3C=CC(=C4)O",
    "CN.O=C=O.C=C(C)C",
  ])
    assert.deepEqual(layoutProblems(toolkit, plain), [], plain);
});

test("the best candidate draws cleanly and keeps the SMILES text, atom order and stereo", () => {
  for (const smiles of [cage, phosphorane]) {
    const [best] = layoutCandidates(toolkit, smiles);
    assert.deepEqual(best.problems, [], smiles);
    assert.ok(best.smiles.startsWith(`${smiles} |(`));
    assert.equal(canonical(best.smiles), canonical(smiles));
    assert.deepEqual(layoutProblems(toolkit, best.smiles), []);
  }
});

test("coordinates join an existing enhanced-stereo block", () => {
  const racemic = "C[C@]12CCC(=O)C[C@@]1(O)CCCC2=O |&1:1,7|";
  const points = Array.from({ length: 14 }, (_, i) => [i * 1.5, i % 2]);
  const written = withCoordinates(racemic, points);
  assert.match(written, /^\S+ \|\(0\.00,0\.00,;1\.50,1\.00,;.*\),&1:1,7\|$/);
  const mol = toolkit.get_mol(written);
  try {
    assert.match(mol!.get_cxsmiles(), /&1:/);
    assert.ok(mol!.has_coords());
  } finally {
    mol!.delete();
  }
  assert.equal(withCoordinates(written, points), written);
});

test("default 2D coordinates place representative molecules on the 30-degree grid", () => {
  for (const smiles of [
    "O=Cc1ccccc1",
    "C[Si](C)(C)OC1=CCCCC1",
    "O=C1CCCCC1C(O)c1ccccc1",
    "CC(C)Cc1ccc(C(C)C(=O)O)cc1",
    "CC(=O)Oc1ccccc1C(=O)O",
  ]) {
    const mol = toolkit.get_mol(smiles)!;
    try {
      computeDefaultCoords(mol);
      const graph = JSON.parse(mol.get_json()).molecules[0];
      const coords: [number, number][] = graph.conformers[0].coords;
      for (const {
        atoms: [a, b],
      } of graph.bonds) {
        const angle =
          ((((Math.atan2(
            coords[b][1] - coords[a][1],
            coords[b][0] - coords[a][0],
          ) *
            180) /
            Math.PI) %
            180) +
            180) %
          180;
        const remainder = Math.min(angle % 30, 30 - (angle % 30));
        assert.ok(
          remainder < 0.5,
          `${smiles}: bond (${a},${b}) angle ${angle.toFixed(2)}° off 30° grid`,
        );
      }
    } finally {
      mol.delete();
    }
  }
});
