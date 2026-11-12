import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compileTableStructures } from "../scripts/content/table-structures.ts";
import { resolveCompoundSlots } from "../scripts/content/compound-slots.ts";
import { validateLibraryEntry } from "../shared/chemical-library/contract.ts";
import { libraryUsage } from "../scripts/content/chemical-library.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  prepareCompound,
  prepareInputVariant,
} from "../shared/chemical-library/chemistry.ts";
import {
  tableDisplayText,
  tableTextAlign,
} from "../src/ui/topic/table-text.ts";
import { blockSearchText } from "../shared/topic-blocks.ts";
import { validateTopicContent } from "../shared/topic-content.ts";
import { recordsCsv, filterRecords } from "../src/ui/topic/patent-filter.ts";
import type { Library } from "../shared/chemical-library/types.ts";
const fixture = async () =>
  JSON.parse(
    await readFile(
      "tests/fixtures/content/sites/fable-patent/content.json",
      "utf8",
    ),
  );

test("table spans retain gaps and reject overlapping or out-of-range groups", async () => {
  const content = await fixture();
  const table = {
    type: "table",
    caption: "Samples",
    columns: ["ID", "A", "B", "C"],
    rows: [["1", "2", "3", "4"]],
    spans: [{ label: "Readings", from: 2, to: 3 }],
  };
  content.chapters[0].blocks = [table];
  assert.doesNotThrow(() => validateTopicContent(content));
  for (const spans of [
    [{ label: "A", from: 0, to: 2 }],
    [{ label: "A", from: 2, to: 5 }],
    [{ label: "A", from: 3, to: 2 }],
    [{ label: "A", from: 1.5, to: 2 }],
    [
      { label: "A", from: 1, to: 2 },
      { label: "B", from: 2, to: 4 },
    ],
  ]) {
    table.spans = spans;
    assert.throws(() => validateTopicContent(content), /span/);
  }
});

test("table structures reuse compound identities and named layouts, including keyed rows", async () => {
  const rd = await moleculeToolkit();
  const compound = prepareCompound(rd, {
    id: "cmp_sample",
    title: "Sample",
    smiles: "CCO",
    sources: [],
  });
  compound.variants = { reverse: prepareInputVariant(rd, compound, "OCC") };
  const library: Library = { [compound.id]: compound };
  const content = await fixture();
  content.data.rows = [
    [
      { ref: compound.id, variant: "reverse" },
      { smiles: "OCC" },
      { smiles: "CCN" },
    ],
  ];
  content.chapters[0].blocks = [
    {
      type: "tabs",
      label: "Samples",
      items: [
        {
          id: "samples",
          label: "Samples",
          blocks: [
            {
              type: "table",
              caption: "Samples",
              columns: ["A", "B", "C"],
              rows: "rows",
            },
          ],
        },
        {
          id: "text",
          label: "Text",
          blocks: [{ type: "paragraph", text: "Sample" }],
        },
      ],
    },
  ];
  await compileTableStructures(content, library, "sites/sample/content.json");
  const resolved = resolveCompoundSlots(content, library, "sample");
  const checked = validateTopicContent(resolved.value);
  assert.equal(content.data.rows[0][0].figure.variant, "reverse");
  assert.equal(content.data.rows[0][1].figure.ref, compound.id);
  const generated = library[content.data.rows[0][2].figure.ref];
  assert.equal(generated.kind, "compound");
  assert.equal(generated.owner, "sites/sample");
  assert.equal(compound.owner, undefined);
  assert.doesNotThrow(() => validateLibraryEntry(generated));
  const usage = libraryUsage(library, [
    { value: checked, path: "/samples", title: "Samples" },
  ]);
  assert.ok(usage.snapshot.uses[compound.id].length >= 2);
  assert.ok(usage.snapshot.uses[generated.id].length >= 1);
});

test("record structures share drawings while queries and CSV keep their original values", async () => {
  const content = await fixture();
  const before = validateTopicContent(structuredClone(content)).data!
    .collections!.examples;
  const csv = recordsCsv(before, before.records);
  const expected = filterRecords(before, {
    source: "alpha",
    sort: "amount",
  }).map((r) => r.id);
  const library: Library = {};
  await compileTableStructures(content, library, "sites/sample/content.json");
  const collection = validateTopicContent(content).data!.collections!.examples;
  assert.equal(recordsCsv(collection, collection.records), csv);
  assert.deepEqual(
    filterRecords(collection, { source: "alpha", sort: "amount" }).map(
      (r) => r.id,
    ),
    expected,
  );
  assert.ok(collection.structureFigures!["1"].smiles.ref.startsWith("cmp_"));
  assert.equal(
    library[collection.structureFigures!["1"].smiles.ref].owner,
    "sites/sample/collections/examples",
  );
  assert.equal(collection.records[0].smiles, before.records[0].smiles);
});

test("unresolved table structures and invalid compound variants reject compilation", async () => {
  const c = prepareCompound(await moleculeToolkit(), {
    id: "cmp_sample",
    title: "Sample",
    smiles: "CCO",
    sources: [],
  });
  for (const cell of [
    { smiles: "C(" },
    { smiles: "" },
    { ref: "cmp_missing" },
    { ref: c.id, variant: "missing" },
    { ref: c.id, smiles: "CCO" },
    { ref: "rxn_missing" },
  ]) {
    const content = {
      chapters: [{ blocks: [{ type: "table", rows: [[cell]] }] }],
    };
    await assert.rejects(
      compileTableStructures(content, { [c.id]: c }, "sample"),
    );
  }
});

test("table group rows span the data columns and remain searchable", async () => {
  const content = await fixture();
  content.chapters[0].blocks = [
    {
      type: "table",
      caption: "Samples",
      columns: ["ID", "Readout"],
      rows: ["Series **2**", ["**2a**", "81"]],
    },
  ];
  assert.doesNotThrow(() => validateTopicContent(content));
  assert.ok(
    blockSearchText(content.chapters[0].blocks).includes("Series **2**"),
  );
});

test("table text keeps quantities together and aligns prose separately from short readings", () => {
  assert.equal(
    tableDisplayText("25 °C; 2 h; 4 nM; 95 %"),
    "25\u00a0°C; 2\u00a0h; 4\u00a0nM; 95\u00a0%",
  );
  assert.equal(
    tableTextAlign("A long experimental annotation with several conditions"),
    "start",
  );
  assert.equal(tableTextAlign("0.74\n8.2"), "center");
  assert.equal(tableTextAlign("假定 25 °C"), "center");
});
