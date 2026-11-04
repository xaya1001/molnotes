import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  alignScheme,
  substituteProduct,
  validateScopeProducts,
} from "../shared/reaction-chemistry.ts";
import {
  schemeRuns,
  validateSubstrateScope,
  validateSynthesisRoutes,
} from "../shared/reaction-scheme.ts";
import { schemeRoutes, scopeExample } from "../src/showcase/data/reactions.ts";
import { validateTopicContent } from "../shared/topic-content.ts";
const toolkit = await moleculeToolkit();
test("schemes require content numbers and explicit reagent and condition lines", () => {
  validateSynthesisRoutes(schemeRoutes, "route");
  for (const change of [
    (r: typeof schemeRoutes) =>
      Reflect.deleteProperty(r[0].steps[0].reactants[0], "number"),
    (r: typeof schemeRoutes) =>
      Reflect.set(r[0].steps[0], "reagents", "oxidant"),
    (r: typeof schemeRoutes) =>
      Reflect.set(r[0].steps[0], "conditions", "water"),
  ]) {
    const routes = structuredClone(schemeRoutes);
    change(routes);
    assert.throws(() => validateSynthesisRoutes(routes, "route"));
  }
  const content = JSON.parse(
    readFileSync("tests/fixtures/content/sites/minimal/content.json", "utf8"),
  );
  assert.doesNotThrow(() => validateTopicContent(content));
});
test("connected wrap units start at an arrow and independent branches keep their reactants", () => {
  const runs = schemeRuns(schemeRoutes[0]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].steps.length, 4);
  assert.deepEqual(
    runs[0].steps[1].after.map((m) => m.number),
    ["3", "6"],
  );
  const route = structuredClone(schemeRoutes[0]);
  route.steps.splice(2, 0, schemeRoutes[2].steps[0]);
  assert.equal(schemeRuns(route).length, 3);
});
test("declared and automatic common cores keep matched coordinates in the same direction", () => {
  for (const core of ["c1ccccc1", undefined]) {
    const route = { ...schemeRoutes[0], core };
    const result = alignScheme(toolkit, route);
    const query = toolkit.get_qmol("c1ccccc1")!;
    try {
      const pairs = route.steps.map((step) => [
        step.reactants[0],
        step.products[0],
      ]);
      for (const [a, b] of pairs) {
        const mols = [a, b].map((m) =>
          toolkit.get_mol(result.smiles[m.number])!,
        );
        try {
          const points = mols.map((m) => {
            const indices = JSON.parse(m.get_substruct_match(query)).atoms;
            const coords = JSON.parse(m.get_json()).molecules[0].conformers[0]
              .coords;
            return indices.map((i: number) => coords[i]);
          });
          for (let i = 1; i < 6; i++)
            for (let axis = 0; axis < 2; axis++)
              assert.ok(
                Math.abs(
                  points[0][i][axis] -
                    points[0][0][axis] -
                    (points[1][i][axis] - points[1][0][axis]),
                ) < 0.001,
              );
        } finally {
          mols.forEach((m) => m.delete());
        }
      }
    } finally {
      query.delete();
    }
  }
  const failed = alignScheme(toolkit, { ...schemeRoutes[0], core: "N1NNNN1" });
  assert.ok(failed.warnings.length);
  assert.equal(Object.keys(failed.smiles).length, 6);
});
test("scope products match instantiated templates, abbreviations, multiple R sites and stereochemistry", () => {
  validateSubstrateScope(scopeExample, "scope");
  validateScopeProducts(toolkit, scopeExample, "scope");
  assert.equal(
    substituteProduct(toolkit, "CC([*:1])=O", { "1": "Ph" }),
    "CC(=O)c1ccccc1",
  );
  assert.equal(
    substituteProduct(toolkit, "[*:1]c1ccc([*:2])cc1", {
      "1": "Cl",
      "2": "OMe",
    }),
    "COc1ccc(Cl)cc1",
  );
  const mismatch = structuredClone(scopeExample);
  mismatch.rows[1].product.smiles = "COC(=O)c1ccc(C)cc1";
  assert.throws(
    () => validateScopeProducts(toolkit, mismatch, "scope"),
    /rows\[1\].*2b.*differs/,
  );
  const chiral = substituteProduct(toolkit, "[*:1]C(=O)O", {
    "1": "*[C@H](O)C",
  });
  assert.match(chiral, /@/);
  const stereochemical = structuredClone(scopeExample);
  stereochemical.scheme.products[0].smiles = "N[C@H]([*:1])C(=O)O";
  stereochemical.rows = [
    {
      number: "2a",
      substituents: { "1": "C" },
      yield: "80%",
      readings: { purity: "99%" },
      product: { name: "Chiral sample", smiles: "N[C@H](C)C(=O)O" },
    },
  ];
  validateScopeProducts(toolkit, stereochemical, "scope");
  stereochemical.rows[0].product.smiles = "N[C@@H](C)C(=O)O";
  assert.throws(
    () => validateScopeProducts(toolkit, stereochemical, "scope"),
    /differs/,
  );

  const missing = structuredClone(scopeExample);
  delete missing.rows[0].substituents["1"];
  assert.throws(() => validateSubstrateScope(missing, "scope"), /one value/);
});

test("alignment keeps ring topology and molecule identity in convergent schemes", () => {
  const route = {
    id: "coupling",
    title: "Coupling",
    steps: [
      {
        title: "Amide",
        reagents: ["base"],
        conditions: ["solvent"],
        explanation: "Coupling",
        reactants: [
          { number: "1", name: "Acyl chloride", smiles: "O=C(Cl)c1ccccc1" },
          { number: "2", name: "Amine", smiles: "NC1CCCCC1" },
        ],
        products: [
          { number: "3", name: "Amide", smiles: "O=C(NC1CCCCC1)c1ccccc1" },
        ],
      },
    ],
  };
  const aligned = alignScheme(toolkit, route);
  for (const compound of [
    ...route.steps[0].reactants,
    ...route.steps[0].products,
  ]) {
    const original = toolkit.get_mol(compound.smiles)!;
    const drawn = toolkit.get_mol(aligned.smiles[compound.number])!;
    try {
      assert.equal(drawn.get_smiles(), original.get_smiles());
      const rings =
        JSON.parse(drawn.get_json()).molecules[0].extensions[0].atomRings ?? [];
      const coords = JSON.parse(drawn.get_json()).molecules[0].conformers[0]
        .coords;
      for (const ring of rings)
        for (const atom of ring)
          for (const other of ring)
            if (atom !== other)
              assert.ok(
                Math.hypot(
                  coords[atom][0] - coords[other][0],
                  coords[atom][1] - coords[other][1],
                ) > 1,
              );
    } finally {
      original.delete();
      drawn.delete();
    }
  }
});
