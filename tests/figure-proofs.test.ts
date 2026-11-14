import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  verifyFigureProofs,
  figureProofReferences,
  type ProofOptions,
} from "../scripts/content/figure-proofs.ts";
import {
  figureGroup,
  figurePath,
  geometrySvg,
} from "../src/ui/library/geometry-tree.ts";
import type { FigureGeometry } from "../shared/chemical-library/geometry.ts";
import type {
  Library,
  Compound,
  Reaction,
} from "../shared/chemical-library/types.ts";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "figure-proofs-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const compound = (id: string): Compound => ({
    kind: "compound",
    id,
    title: "Example structure",
    smiles: "[CH3:1][OH:2]",
    graph: "CO",
    sources: [{ source: "example", locator: "Structures" }],
    atomIds: ["a1", "a2"],
    layout: { coords: { a1: { x: 0, y: 0 }, a2: { x: 1, y: 0 } } },
  });
  const reaction: Reaction = {
    kind: "reaction",
    id: "rxn_example",
    title: "Example transformation",
    sources: [{ source: "example", locator: "Reactions" }],
    reactants: [{ id: "input", compound: "cmp_a" }],
    products: [{ id: "output", compound: "cmp_b" }],
    reagents: [],
    conditions: [],
    explanation: "Example",
    scene: {
      width: 12,
      height: 8,
      molecules: [
        { id: "input", compound: "cmp_a", at: { x: 2, y: 3 } },
        { id: "output", compound: "cmp_b", at: { x: 10, y: 3 } },
      ],
    },
    arrow: { from: { x: 4, y: 3 }, to: { x: 8, y: 3 }, textWidth: 4 },
  };
  const library: Library = {
    cmp_a: compound("cmp_a"),
    cmp_b: compound("cmp_b"),
    cmp_other: compound("cmp_other"),
    rxn_example: reaction,
  };
  const calls: { ref: string; width: number }[] = [],
    blocked = new Set<string>();
  let starts = 0,
    diagnosed = 0,
    thumbnails = 0;
  const geometry = (ref: string): FigureGeometry => {
    const root = figureGroup([]);
    root.attributes["data-figure"] = ref;
    root.attributes["data-input"] = JSON.stringify({
      entry: library[ref],
      compounds: ref === "rxn_example" ? [library.cmp_a, library.cmp_b] : [],
    });
    root.children.push(figurePath("M0 0L32 0"));
    return {
      format: 1,
      width: 100,
      height: 100,
      minimumScale: 1,
      atomPoints: {},
      root,
    };
  };
  const options: ProofOptions = {
    directory,
    renderer: "renderer-one",
    diagnostics: "diagnostics-one",
    processRenderer: "process-one",
    templates: {},
    async createRunner() {
      starts++;
      return {
        async prepare(reference) {
          calls.push({ ref: reference.ref, width: 1366 });
          const value = geometry(reference.ref);
          return { kind: "chemical", geometry: value, svg: geometrySvg(value) };
        },
        async diagnose(value) {
          diagnosed++;
          const ref = value.root.attributes["data-figure"];
          return blocked.has(ref)
            ? [
                {
                  code: "BOND_TOO_SMALL",
                  severity: "error",
                  object: ref,
                  elements: ["a1", "a2"],
                  message: "Restore bond geometry",
                },
              ]
            : [];
        },
        async thumbnail(reference) {
          thumbnails++;
          return Buffer.from(`example preview ${reference.ref}`);
        },
        async close() {},
      };
    },
  };
  const run = () => verifyFigureProofs(library, [], options);
  return {
    directory,
    library,
    calls,
    blocked,
    options,
    run,
    starts: () => starts,
    diagnosed: () => diagnosed,
    thumbnails: () => thumbnails,
    geometry,
  };
}

test("unchanged proofs reuse the thumbnail without starting a renderer", async (t) => {
  const f = await fixture(t);
  await f.run();
  assert.equal(f.calls.length, 4);
  f.calls.length = 0;
  const starts = f.starts();
  await f.run();
  assert.equal(f.calls.length, 0);
  assert.equal(f.starts(), starts);
});
test("a changed compound invalidates its dependent figure and preserves unrelated proofs", async (t) => {
  const f = await fixture(t);
  await f.run();
  f.calls.length = 0;
  (f.library.cmp_a as Compound).layout.coords.a2.x = 1.25;
  await f.run();
  assert.deepEqual(f.calls.map((r) => r.ref).sort(), ["cmp_a", "rxn_example"]);
});
test("a renderer change recomputes geometry and reuses unchanged proofs and thumbnails", async (t) => {
  const f = await fixture(t);
  await f.run();
  f.calls.length = 0;
  await f.run();
  assert.equal(f.calls.length, 0);
  const diagnosed = f.diagnosed(),
    thumbnails = f.thumbnails();
  f.options.renderer = "renderer-two";
  await f.run();
  assert.equal(f.calls.length, 4);
  assert.equal(f.diagnosed(), diagnosed);
  assert.equal(f.thumbnails(), thumbnails);
});
test("a corrupt cache record is rendered again", async (t) => {
  const f = await fixture(t);
  await f.run();
  f.calls.length = 0;
  const record = (await readdir(join(f.directory, "inputs"))).find((p) =>
    p.endsWith(".json"),
  )!;
  await writeFile(join(f.directory, "inputs", record), "{");
  await f.run();
  assert.equal(f.calls.length, 1);
});
test("publication preserves diagnostics and renders the current figure", async (t) => {
  const f = await fixture(t);
  await f.run();
  f.calls.length = 0;
  (f.library.cmp_a as Compound).layout.coords.a2 = { x: 0, y: 0 };
  f.blocked.add("cmp_a");
  const result = await f.run();
  assert.equal(
    Object.values(result.renders).find((r) => r.diagnostics.length)!
      .diagnostics[0].code,
    "BOND_TOO_SMALL",
  );
  assert.ok(Object.values(result.renders)[0].asset.endsWith(".svg"));
  const diagnosed = f.diagnosed();
  const cached = await f.run();
  assert.deepEqual(cached.renders, result.renders);
  assert.equal(f.diagnosed(), diagnosed);
  assert.ok(f.calls.some((r) => r.ref === "cmp_a"));
});

test("proofs deduplicate captions while preserving local numbers and focus", async (t) => {
  const f = await fixture(t);
  const result = await verifyFigureProofs(
    f.library,
    [
      { ref: "cmp_a", caption: "First" },
      { ref: "cmp_a", caption: "Second" },
      { ref: "cmp_a", numbers: { compound: "1" } },
      { ref: "cmp_a", numbers: { compound: "2" } },
      {
        ref: "cmp_a",
        focus: { primary: { atoms: [{ molecule: "compound", atom: "a1" }] } },
      },
    ],
    f.options,
  );
  assert.equal(result.stats.total, 7);
  assert.equal(f.calls.filter((r) => r.ref === "cmp_a").length, 4);
  assert.ok(f.calls.every((r) => r.width === 1366));
  f.calls.length = 0;
  await verifyFigureProofs(
    f.library,
    [{ ref: "cmp_a", caption: "Changed" }],
    f.options,
  );
  assert.equal(f.calls.length, 0);
});

test("all failures are reported after successful proofs have been cached", async (t) => {
  const f = await fixture(t);
  const create = f.options.createRunner;
  f.options.createRunner = async () => {
    const runner = await create();
    const prepare = runner.prepare;
    runner.prepare = async (reference, slot) => {
      if (["cmp_a", "cmp_b"].includes(reference.ref))
        throw new Error("Cannot render structure");
      return prepare(reference, slot);
    };
    return runner;
  };
  await assert.rejects(f.run(), (error: Error) => {
    assert.match(error.message, /cmp_a.*Cannot render structure/);
    assert.match(error.message, /cmp_b.*Cannot render structure/);
    return true;
  });
  assert.equal(f.calls.length, 2);
  f.calls.length = 0;
  f.options.createRunner = create;
  const result = await f.run();
  assert.equal(result.stats.proofHits, 2);
  assert.equal(result.stats.diagnosed, 2);
  assert.equal(result.stats.prepared, 2);
});

test("two worker slots prepare concurrently and commit previews in reference order", async (t) => {
  const f = await fixture(t);
  let active = 0,
    maximum = 0;
  const slots = new Set<number>();
  let batches = 0;
  f.options.createRunner = async () => ({
    async prepareBatch() {
      assert.equal(active, 0);
      batches++;
      await new Promise((resolve) => setTimeout(resolve, 1));
    },
    async prepare(reference, slot) {
      assert.ok(!slots.has(slot));
      slots.add(slot);
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, slot === 0 ? 10 : 1));
      active--;
      const geometry = f.geometry(reference.ref);
      return { kind: "chemical", geometry, svg: geometrySvg(geometry) };
    },
    async diagnose() {
      return [];
    },
    async thumbnail(_reference, _render, slot) {
      slots.delete(slot);
      return Buffer.from(`page ${slot}`);
    },
    async close() {
      assert.equal(active, 0);
    },
  });
  const result = await f.run();
  assert.equal(maximum, 2);
  assert.equal(batches, 1);
  assert.deepEqual(Object.keys(result.previews), Object.keys(f.library));
  assert.deepEqual(
    result.assets
      .filter((asset) => asset.content_type === "image/png")
      .map((asset) => asset.bytes),
    [Buffer.from("page 0"), Buffer.from("page 1")],
  );
  const urls = Object.values(result.previews);
  assert.equal(urls[0], urls[2]);
  assert.equal(urls[1], urls[3]);
});

test("diagnostic code changes reuse geometry and thumbnails but recompute proofs", async (t) => {
  const f = await fixture(t);
  const first = await f.run();
  f.calls.length = 0;
  const thumbnails = f.thumbnails();
  f.options.diagnostics = "diagnostics-two";
  const result = await f.run();
  assert.equal(f.calls.length, 0);
  assert.equal(result.stats.diagnosed, 4);
  assert.equal(f.thumbnails(), thumbnails);
  assert.deepEqual(result.renders, first.renders);
  assert.equal(Object.keys(result.renders).length, 4);
  assert.ok(
    result.assets
      .filter((asset) => asset.content_type === "image/svg+xml")
      .every((asset) => asset.size > 0),
  );
});

test("unselected mechanism frames retain local numbering and focus in every published view", async (t) => {
  const f = await fixture(t);
  f.library.mec_example = {
    kind: "mechanism",
    id: "mec_example",
    title: "Example mechanism",
    category: "comparison",
    sources: f.library.cmp_a.sources,
    frames: ["first", "second"].map((id) => ({
      id,
      title: id,
      explanation: id,
      scene: {
        width: 8,
        height: 6,
        molecules: [{ id: "input", compound: "cmp_a", at: { x: 4, y: 3 } }],
      },
    })),
  };
  const local = {
    ref: "mec_example",
    numbers: { input: "7" },
    focus: { primary: { atoms: [{ molecule: "input", atom: "a1" }] } },
  };
  const views = figureProofReferences(f.library, [local]);
  assert.deepEqual(
    views.filter((view) => view.ref === local.ref && view.numbers),
    [
      { ...local, frame: "first" },
      { ...local, frame: "second" },
    ],
  );
  const pinned = figureProofReferences(f.library, [
    { ...local, frame: "second" },
  ]);
  assert.deepEqual(
    pinned.filter((view) => view.ref === local.ref && view.numbers),
    [{ ...local, frame: "second" }],
  );
});

test("template changes rebuild only the views that consume that template", async (t) => {
  const f = await fixture(t);
  f.library.cnf_first = {
    kind: "conformation",
    id: "cnf_first",
    title: "First template",
    sources: [],
    template: "chair",
  };
  f.library.cnf_second = {
    ...f.library.cnf_first,
    id: "cnf_second",
    template: "boat",
  };
  const options: ProofOptions = {
    ...f.options,
    templates: { chair: "chair-one", boat: "boat-one" },
  };
  const run = () => verifyFigureProofs(f.library, [], options);
  await run();
  f.calls.length = 0;
  options.templates.chair = "chair-two";
  await run();
  assert.deepEqual(
    f.calls.map((call) => call.ref),
    ["cnf_first"],
  );
  f.calls.length = 0;
  options.templates["unused"] = "new-template";
  const cached = await run();
  assert.equal(f.calls.length, 0);
  assert.equal(cached.stats.inputHits, 6);
});
