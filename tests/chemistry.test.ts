import { test } from "node:test";
import assert from "node:assert/strict";
import {
  abbreviatedGroups,
  abbreviationSmarts,
  validateAbbreviations,
  type MoleculeAbbreviation,
} from "../shared/molecule-abbreviations.ts";
import { moleculeSvg } from "../src/ui/chemistry/drawing.ts";
import init from "@rdkit/rdkit";
import { properties } from "../src/ui/chemistry/rdkit.ts";
import { validateEvidence } from "../src/ui/evidence.ts";
const toolkit = await init();
test("RDKit properties match reference molecules, with explicit descriptor definitions", () => {
  for (const [smiles, expected] of [
    ["CC(=O)Oc1ccccc1C(=O)O", [180.159, 1.3101, 63.6, 1, 3, 2]],
    ["CCO", [46.069, -0.0014, 20.23, 1, 1, 0]],
    ["c1ccccc1", [78.114, 1.6866, 0, 0, 0, 0]],
  ] satisfies [string, number[]][]) {
    const actual = Object.values(properties(toolkit, smiles));
    actual.forEach((v, i) =>
      assert.ok(
        Math.abs(v - expected[i]) < 0.002,
        `${smiles}: ${v} vs ${expected[i]}`,
      ),
    );
  }
  assert.throws(() => properties(toolkit, "not a molecule"), /SMILES/);
});
test("excerpts and reading reject missing source identifiers", () => {
  const sources = [{ id: 1, title: "Source" }];
  const excerpt = {
    id: "x",
    source: 1,
    locator: "PDF 1",
    text: "Evidence",
    guide: "Guide",
  };
  const reading = {
    source: 1,
    locator: "§1",
    minutes: 10,
    question: "Why?",
    skip: "§2",
  };
  assert.doesNotThrow(() => validateEvidence(sources, [excerpt], [reading]));
  assert.throws(
    () => validateEvidence(sources, [{ ...excerpt, source: 2 }], []),
    /Unknown source: 2/,
  );
  assert.throws(
    () => validateEvidence(sources, [], [{ ...reading, source: 2 }]),
    /Unknown source: 2/,
  );
});

test("abbreviations fold only declared complete terminal groups using original indices", () => {
  const smiles = "CCOC(=O)C1CCN(CC1)C(=O)OC(C)(C)C";
  const mol = toolkit.get_mol(smiles)!;
  try {
    assert.deepEqual(abbreviatedGroups(toolkit, mol), []);
    const groups = abbreviatedGroups(toolkit, mol, ["Boc"]);
    assert.deepEqual(
      groups.map((group) => group.atoms),
      [[11, 12, 13, 14, 15, 16, 17]],
    );
    assert.deepEqual(
      abbreviatedGroups(toolkit, mol, ["Boc", "CO₂Et"]).map((g) => g.name),
      ["Boc", "CO₂Et"],
    );
    assert.throws(
      () => abbreviatedGroups(toolkit, mol, ["Ts"], "sample"),
      /sample.*Ts.*SMILES/,
    );
    assert.throws(
      () => validateAbbreviations(["Unknown"], "sample"),
      /sample.*whitelist/,
    );
  } finally {
    mol.delete();
  }
  for (const [name, pattern] of Object.entries(abbreviationSmarts)) {
    // Query atoms/bonds are not SMILES; use a real phosphine oxide for this group.
    const smiles =
      name === "PPh3"
        ? "O=P(c1ccccc1)(c1ccccc1)c1ccccc1"
        : pattern.replace("*", "N");
    const mol = toolkit.get_mol(smiles)!;
    assert.ok(mol, name);
    try {
      assert.equal(
        abbreviatedGroups(toolkit, mol, [name as MoleculeAbbreviation]).length,
        1,
        name,
      );
    } finally {
      mol.delete();
    }
  }
  const extended = toolkit.get_mol("COCCC")!;
  try {
    assert.throws(
      () => abbreviatedGroups(toolkit, extended, ["OEt"]),
      /no non-overlapping/,
    );
  } finally {
    extended.delete();
  }
});

test("drawing uses monochrome atoms and ACS document proportions with smaller stereo annotations", () => {
  const mol = toolkit.get_mol("N[C@H](O)/C=C/C(=O)O")!;
  try {
    const svg = moleculeSvg(mol);
    assert.deepEqual([...new Set(svg.match(/#[0-9A-F]{6}/g))].sort(), [
      "#000000",
      "#FFFFFF",
    ]);
    assert.match(svg, /stroke-width:0.6px/);
    assert.match(svg, /font-size:10px/);
    assert.match(svg, /CIP_Code/);
    assert.match(svg, /font-size:6px/);
  } finally {
    mol.delete();
  }
});
