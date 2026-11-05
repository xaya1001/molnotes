import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { readUnit } from "../scripts/content/content-files.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  prepareCompound,
  prepareInputVariant,
  validateCompound,
} from "../shared/chemical-library/chemistry.ts";
import { resolveCompoundSlots } from "../scripts/content/compound-slots.ts";

test("topic structure slots resolve compound variants while preserving indexed input and controls", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "molnotes-compound-slots-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(
    resolve("tests/fixtures/content/sites/minimal"),
    join(root, "sites/minimal"),
    { recursive: true },
  );
  const c = prepareCompound(await moleculeToolkit(), {
    id: "cmp_example",
    title: "Stored structure",
    smiles: "CCO",
    sources: [{ source: "handbook", locator: "Example" }],
  });
  const request = join(root, "variant.json"),
    output = join(root, "prepared");
  await writeFile(
    request,
    JSON.stringify({
      compound: c,
      variant: "input",
      inputSmiles: "OCC",
      abbreviations: [],
    }),
  );
  execFileSync(process.execPath, [
    "scripts/figure-render.ts",
    "--library",
    root,
    "--prepare",
    request,
    "--out",
    output,
  ]);
  const prepared = JSON.parse(
    await readFile(join(output, `${c.id}.json`), "utf8"),
  );
  c.variants = prepared.variants;
  const file = join(root, "sites/minimal/content.json");
  const topic = JSON.parse(await readFile(file, "utf8"));
  topic.chapters[0].blocks = [
    { type: "properties", name: "Local label", ref: c.id, variant: "input" },
    {
      type: "molecule-compare",
      items: [
        {
          name: "First",
          ref: c.id,
          variant: "input",
          highlightAtoms: [0],
          caption: "Local caption",
        },
        { name: "Second", ref: c.id },
      ],
    },
    {
      type: "prediction",
      id: "pick",
      kind: "atoms",
      question: "Pick the oxygen",
      molecule: { name: "Indexed structure", ref: c.id, variant: "input" },
      answer: [0],
      explanation: "Example",
    },
  ];
  await writeFile(file, JSON.stringify(topic));
  const unit = await readUnit(root, "sites/minimal", { [c.id]: c });
  if (unit.kind !== "sites") throw new Error("Invalid fixture");
  const [properties, compare] = unit.content.chapters[0].blocks;
  assert.equal(properties.type, "properties");
  if (
    properties.type !== "properties" ||
    compare.type !== "molecule-compare" ||
    typeof compare.items === "string"
  )
    throw new Error("Invalid fixture");
  assert.equal(properties.smiles, "OCC");
  assert.equal(properties.name, "Local label");
  assert.equal(compare.items[0].smiles, "OCC");
  assert.deepEqual(compare.items[0].highlightAtoms, [0]);
  assert.equal(compare.items[0].caption, "Local caption");
  assert.equal(unit.compoundReferences.length, 4);
  const prediction = unit.content.chapters[0].blocks[2];
  if (prediction.type !== "prediction" || prediction.kind !== "atoms")
    throw new Error("Invalid fixture");
  assert.deepEqual(prediction.answer, [0]);
  assert.equal(prediction.id, "pick");
  assert.equal(prediction.molecule.smiles, "OCC");
});

test("compound slots resolve all nested structures and reject ambiguous or changed molecular facts", async () => {
  const rd = await moleculeToolkit();
  const c = prepareCompound(rd, {
    id: "cmp_example",
    title: "Example",
    smiles: "CCO",
    sources: [{ source: "handbook", locator: "Example" }],
  });
  c.variants = { input: prepareInputVariant(rd, c, "OCC") };
  const library = { [c.id]: c };
  const slot = { ref: c.id, variant: "input" };
  const data = {
    prediction: { molecule: slot, molecules: [{ ...slot, answer: [0] }] },
    wallMatrix: { rows: [{ id: "row", label: "Row", ...slot }] },
    frames: [{ ...slot, arrows: [] }],
    products: [{ ...slot, yield: 0.8 }],
    figure: { ref: c.id },
    blocks: [{ type: "figure-ref", ref: c.id }],
  };
  const resolved = resolveCompoundSlots(data, library, "example");
  assert.deepEqual(
    resolved.references,
    Array.from({ length: 5 }, () => slot),
  );
  const saved = resolved.value as typeof data & {
    wallMatrix: { rows: { smiles: string }[] };
  };
  assert.equal(saved.wallMatrix.rows[0].smiles, "OCC");
  assert.deepEqual(saved.figure, { ref: c.id });
  assert.deepEqual(saved.blocks, [{ type: "figure-ref", ref: c.id }]);
  assert.throws(
    () => resolveCompoundSlots({ ...slot, smiles: "CCC" }, library, "example"),
    /override/,
  );
  assert.throws(
    () =>
      resolveCompoundSlots({ ...slot, variant: "missing" }, library, "example"),
    /variant/,
  );
  assert.throws(
    () => resolveCompoundSlots({ ref: "cmp_missing" }, library, "example"),
    /unknown|Unknown/,
  );
  assert.throws(() => prepareInputVariant(rd, c, "CCC"), /graph/);
  assert.throws(() => prepareInputVariant(rd, c, "[13CH3]CO"), /graph/);
  const stereoisomer = prepareCompound(rd, {
    id: "cmp_stereo",
    title: "Stereo",
    smiles: "C[C@H](O)F",
    sources: [],
  });
  assert.throws(
    () => prepareInputVariant(rd, stereoisomer, "C[C@@H](O)F"),
    /stereochemistry/,
  );
  const folded = prepareCompound(rd, {
    id: "cmp_folded",
    title: "Folded",
    smiles: "COCC",
    sources: [],
  });
  folded.layout.abbreviations = ["OEt"];
  assert.deepEqual(prepareInputVariant(rd, folded, "CCOC").abbreviations, []);
  assert.deepEqual(
    prepareInputVariant(rd, folded, "CCOC", ["OEt"]).abbreviations,
    ["OEt"],
  );
  c.variants.input.inputSmiles = "CCC";
  assert.throws(() => validateCompound(rd, c), /graph/);
});
