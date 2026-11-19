import { test } from "node:test";
import assert from "node:assert/strict";
import { topicFigures } from "../shared/content-preview.ts";
import type { TopicContent } from "../src/ui/topic/content.ts";
import type { Library, Mechanism } from "../shared/chemical-library/types.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { prepareCompound } from "../shared/chemical-library/chemistry.ts";
async function compoundFixture() {
  return prepareCompound(await moleculeToolkit(), {
    id: "cmp_example",
    title: "Example",
    smiles: "CCO",
    sources: [
      {
        source: "unknown",
        locator: "Example",
        note: "Neutral verification fixture",
      },
    ],
  });
}

test("library mechanism previews collect the overview or the explicitly selected frame", async () => {
  const compound = await compoundFixture();
  const mechanism: Mechanism = {
    id: "mec_example",
    kind: "mechanism",
    title: "Mechanism",
    category: "comparison",
    sources: compound.sources,
    frames: ["first", "second"].map((id) => ({
      id,
      title: id,
      scene: {
        width: 4,
        height: 4,
        molecules: [{ id: "input", compound: compound.id, at: { x: 2, y: 2 } }],
      },
    })),
  };
  const library: Library = {
    [compound.id]: compound,
    [mechanism.id]: mechanism,
  };
  const errors: string[] = [];
  const topic: TopicContent = {
    parts: [],
    sources: [],
    chapters: [
      {
        id: "example",
        title: "Example",
        number: 1,
        short: "Example",
        minutes: 1,
        lead: "Example",
        refs: [],
        blocks: [
          { type: "figure-ref", ref: mechanism.id, numbers: { input: "7" } },
          { type: "figure-ref", ref: mechanism.id, frame: "second" },
        ],
      },
    ],
  };
  const figures = topicFigures(topic, "example", errors, library);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    figures.map((f) => f.value),
    [
      { ref: mechanism.id, numbers: { input: "7" } },
      { ref: mechanism.id, frame: "second" },
    ],
  );
  assert.deepEqual(
    figures.map((f) => f.title),
    [undefined, "second"],
  );
  assert.ok(figures[1].where.includes("[second]"));
  topic.chapters[0].blocks = [
    { type: "figure-ref", ref: mechanism.id, frame: "missing" },
  ];
  const invalid: string[] = [];
  assert.deepEqual(topicFigures(topic, "example", invalid, library), []);
  assert.match(invalid[0], /frame/);
});

test("authoring preview prepares only requested views and returns SVG assets without thumbnails", async () => {
  const { prepareFigureViews } =
    await import("../scripts/content/figure-build.ts");
  const compound = await compoundFixture();
  const invalid = {
    ...compound,
    id: "cmp_unused",
    smiles: "invalid",
    layout: { coords: {} },
  };
  const result = await prepareFigureViews(
    { [compound.id]: compound, [invalid.id]: invalid },
    [
      { ref: compound.id, caption: "First" },
      { ref: compound.id, caption: "Second" },
    ],
    ".",
  );
  assert.equal(Object.keys(result.renders).length, 1);
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].content_type, "image/svg+xml");
  assert.match(result.assets[0].bytes.toString(), /<svg/);
  assert.deepEqual(Object.values(result.renders)[0].diagnostics, []);
});
