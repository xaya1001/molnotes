import { test } from "node:test";
import assert from "node:assert/strict";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  layoutCandidates,
  layoutProblems,
  withCoordinates,
} from "../scripts/molecule-layout.ts";

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
