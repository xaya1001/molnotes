import { test } from "node:test";
import assert from "node:assert/strict";
import init from "@rdkit/rdkit";
import { properties } from "../src/ui/chemistry/rdkit.ts";
import { validateEvidence } from "../src/ui/evidence.ts";
const toolkit = await init();
test("RDKit properties match reference molecules, with explicit descriptor definitions", () => {
  for (const [smiles, expected] of [
    ["CC(=O)Oc1ccccc1C(=O)O", [180.159, 1.3101, 63.6, 1, 3, 2]],
    ["CCO", [46.069, -0.0014, 20.23, 1, 1, 0]],
    ["c1ccccc1", [78.114, 1.6866, 0, 0, 0, 0]],
  ]) {
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
