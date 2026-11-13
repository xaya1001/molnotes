import { test } from "node:test";
import assert from "node:assert/strict";
import { compileFigure } from "../scripts/figure-scene.ts";
import type { FigureInput } from "../scripts/figure-input.ts";
import type { Reaction } from "../shared/chemical-library/types.ts";

async function reaction(
  a: string,
  b: string,
  extra: Partial<FigureInput> = {},
) {
  const result = await compileFigure({
    title: "Transformation",
    compounds: {
      a: { smiles: a, abbreviate: false },
      b: { smiles: b, abbreviate: false },
    },
    steps: [{ from: "a", to: "b" }],
    ...extra,
  });
  return {
    ...result,
    reaction: result.entries[result.reference.ref] as Reaction,
  };
}
const atoms = (r: Reaction) => r.scene.changes?.atoms?.map((a) => a.atom) ?? [];
const bonds = (r: Reaction) =>
  r.scene.changes?.bonds?.map((b) =>
    b
      .map((a) => a.atom)
      .sort()
      .join("/"),
  ) ?? [];

test("reaction changes belong to the product scene and preserve chemical identity", async () => {
  const result = await reaction("CC=O", "CCO");
  assert.deepEqual(atoms(result.reaction), ["a2", "a3"]);
  assert.deepEqual(bonds(result.reaction), ["a2/a3"]);
  assert.ok(
    result.reaction.scene.changes!.atoms!.every(
      (a) => a.molecule === result.reaction.products[0].id,
    ),
  );
  for (const entry of Object.values(result.entries))
    if (entry.kind === "compound") assert.equal("changes" in entry, false);
  assert.equal(
    (await reaction("CCO", "CCO")).reaction.scene.changes,
    undefined,
  );
});

test("tetrahedral changes compare ligand order through substitution and changed CIP priority", async () => {
  const inverted = await reaction("CC[C@H](Br)C", "CC[C@@H](O)C");
  const retained = await reaction("C[C@H](Br)F", "C[C@H](O)F");
  assert.ok(atoms(inverted.reaction).includes("a3"));
  assert.equal(atoms(retained.reaction).includes("a2"), true); // Leaving-group attachment.
  assert.ok(inverted.review.some((line) => line.includes("立体翻转")));
  assert.ok(retained.review.some((line) => line.includes("立体保留")));
  const stereoOnly = await reaction("C[C@H](F)CC", "C[C@@H](F)CC");
  assert.deepEqual(atoms(stereoOnly.reaction), ["a2"]);
  assert.deepEqual(bonds(stereoOnly.reaction), []);
  const reordered = await reaction("C[C@H](F)CC", "CC[C@@H](F)C");
  assert.equal(reordered.reaction.scene.changes, undefined);
});

test("alkene changes compare the attached ligands independent of SMILES traversal", async () => {
  assert.deepEqual(bonds((await reaction("C/C=C/C", "C/C=C\\C")).reaction), [
    "a2/a3",
  ]);
  assert.deepEqual(
    bonds((await reaction("Cl/C=C/CC", "CC/C=C/Cl")).reaction),
    [],
  );
});

test("manual changes apply after automatic marks and remove incident red bonds", async () => {
  const changed = await reaction("CC=O", "[CH3:11][CH2:12][OH:13]", {
    steps: [{ from: "a", to: "b", changes: { add: [11], remove: [13] } }],
  });
  assert.deepEqual(atoms(changed.reaction), ["a1", "a2"]);
  assert.deepEqual(bonds(changed.reaction), ["a1/a2"]);
  for (const extra of [
    { changes: false },
    { steps: [{ from: "a", to: "b", changes: "off" }] },
  ] as Partial<FigureInput>[])
    assert.equal(
      (await reaction("CC=O", "CCO", extra)).reaction.scene.changes,
      undefined,
    );
});

test("small common cores remain unmarked and explain the missing comparison", async () => {
  const result = await reaction("CO", "CN");
  assert.equal(result.reaction.scene.changes, undefined);
  assert.ok(result.review.some((line) => line.includes("未比较")));
});

test("hidden reactants explain imported fragment bonds while attachment bonds remain red", async () => {
  const result = await reaction("", "", {
    compounds: { a: "CCCCCBr", b: "NCCO", c: "CCCCCNCCO" },
    steps: [{ from: ["a", { id: "b", show: "none" }], to: "c" }],
  });
  assert.deepEqual(bonds(result.reaction), ["a5/a6"]);
  assert.equal(atoms(result.reaction).includes("a9"), false);
  assert.equal(result.reaction.reactants[1].position, "none");
});

test("a bond joining two imported fragments is new while their existing internal bonds stay plain", async () => {
  const result = await reaction("", "", {
    compounds: { a: "CCCCCBr", b: "NCO", d: "S=O", c: "CCCCCNCOS=O" },
    steps: [{ from: ["a", "b", "d"], to: "c" }],
  });
  assert.deepEqual(bonds(result.reaction), ["a5/a6", "a8/a9"]);
});

test("equal main cores report ambiguity and manual atom numbers must identify one product", async () => {
  const result = await reaction("", "", {
    compounds: { a: "CCCCBr", b: "NCCO", c: "CCCCNCCO" },
    steps: [{ from: ["a", "b"], to: "c" }],
  });
  assert.equal(result.reaction.scene.changes, undefined);
  assert.ok(result.review.some((line) => line.includes("未比较")));
  await assert.rejects(
    reaction("", "", {
      compounds: { a: "CCC=O", b: "[CH3:1]CCO", c: "[CH3:1]CCC" },
      steps: [{ from: "a", to: ["b", "c"], changes: { add: [1] } }],
    }),
    /exactly one product/,
  );
});
