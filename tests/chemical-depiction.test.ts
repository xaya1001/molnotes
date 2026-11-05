import test from "node:test";
import assert from "node:assert/strict";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  prepareCompound,
  placedCoordinates,
  drawingMolecule,
  graphSignature,
  graphOf,
} from "../shared/chemical-library/chemistry.ts";

const sources = [{ source: "example", locator: "structure" }];

test("counterions approach their charged fragment while pins and authored separation are retained", async () => {
  const rd = await moleculeToolkit();
  for (const smiles of ["CC(=O)[O-].[Na+]", "C[N+](C)(C)C.[Cl-]"]) {
    const c = prepareCompound(rd, {
      id: "cmp_pair",
      title: "Ion pair",
      smiles,
      sources,
    });
    const mol = rd.get_mol(c.smiles)!;
    const graph = graphOf(mol);
    mol.delete();
    const charged = graph.atoms.flatMap((a, i) => (a.chg ? [i] : []));
    const counter = charged.at(-1)!;
    c.layout.coords[c.atomIds[counter]].x += 10;
    const saved = structuredClone(c.layout.coords);
    const placed = placedCoordinates(rd, c, c.layout);
    const [a, b] = charged;
    assert.ok(
      Math.abs(
        Math.hypot(placed[a].x - placed[b].x, placed[a].y - placed[b].y) - 1.5,
      ) < 1e-8,
    );
    assert.deepEqual(c.layout.coords, saved);
    assert.deepEqual(
      placedCoordinates(rd, c, { ...c.layout, ionPairs: "keep" }),
      c.atomIds.map((id) => saved[id]),
    );
    assert.deepEqual(
      placedCoordinates(rd, c, {
        ...c.layout,
        pins: { [c.atomIds[counter]]: saved[c.atomIds[counter]] },
      }),
      c.atomIds.map((id) => saved[id]),
    );
    for (const {
      atoms: [u, v],
    } of graph.bonds) {
      const distance = (p: typeof placed) =>
        Math.hypot(p[u].x - p[v].x, p[u].y - p[v].y);
      assert.ok(
        Math.abs(
          distance(placed) - distance(c.atomIds.map((id) => saved[id])),
        ) < 1e-8,
      );
    }
  }
});

test("native chiral-H preparation preserves a saved fused stereochemical graph", async () => {
  const rd = await moleculeToolkit();
  const c = prepareCompound(rd, {
    id: "cmp_fused",
    title: "Fused stereocentres",
    sources,
    smiles: "C[C@]12CC[C@H]3[C@H]([C@@H]1CC[C@@H]2O)CCC4=C3C=CC(=C4)O",
  });
  const mol = drawingMolecule(
    rd,
    c,
    placedCoordinates(rd, c, c.layout),
    c.layout,
  );
  try {
    const count = mol.get_num_atoms();
    const svg = mol.get_svg_with_highlights(
      JSON.stringify({
        addChiralHs: true,
        prepareMolsBeforeDrawing: true,
        wedgeBonds: true,
      }),
    );
    assert.match(svg, new RegExp(`atom-${count}`));
    assert.equal(mol.get_num_atoms(), count);
    assert.equal(graphSignature(rd, mol), c.graph);
  } finally {
    mol.delete();
  }
});
