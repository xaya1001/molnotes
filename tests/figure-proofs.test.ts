import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  verifyFigureProofs,
  type ProofOptions,
} from "../scripts/content/figure-proofs.ts";
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
  let starts = 0;
  const options: ProofOptions = {
    directory,
    renderer: "renderer-one",
    async createRunner() {
      starts++;
      const current: string[] = [];
      return {
        async render(reference, width, slot = 0) {
          current[slot] = reference.ref;
          calls.push({ ref: reference.ref, width });
          return {
            diagnostics: blocked.has(reference.ref)
              ? [
                  {
                    code: "BOND_TOO_SMALL",
                    severity: "error" as const,
                    object: reference.ref,
                    elements: ["a1", "a2"],
                    message: "Restore bond geometry",
                  },
                ]
              : [],
          };
        },
        async thumbnail(slot = 0) {
          return Buffer.from(`example preview ${current[slot]}`);
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
test("a changed renderer fingerprint invalidates every desktop proof", async (t) => {
  const f = await fixture(t);
  await f.run();
  f.calls.length = 0;
  await f.run();
  assert.equal(f.calls.length, 0);
  f.options.renderer = "renderer-two";
  await f.run();
  assert.equal(f.calls.length, 4);
});
test("a corrupt cache record is rendered again", async (t) => {
  const f = await fixture(t);
  await f.run();
  f.calls.length = 0;
  const record = (await readdir(f.directory)).find((p) => p.endsWith(".json"))!;
  await writeFile(join(f.directory, record), "{");
  await f.run();
  assert.equal(f.calls.length, 1);
});
test("a previously accepted figure that becomes blocked still rejects publication", async (t) => {
  const f = await fixture(t);
  await f.run();
  f.calls.length = 0;
  (f.library.cmp_a as Compound).layout.coords.a2 = { x: 0, y: 0 };
  f.blocked.add("cmp_a");
  await assert.rejects(f.run(), /cmp_a: BOND_TOO_SMALL/);
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
  f.blocked.add("cmp_a");
  f.blocked.add("cmp_b");
  await assert.rejects(f.run(), (error: Error) => {
    assert.match(error.message, /cmp_a.*BOND_TOO_SMALL/);
    assert.match(error.message, /cmp_b.*BOND_TOO_SMALL/);
    return true;
  });
  assert.equal(f.calls.length, 4);
  f.calls.length = 0;
  f.blocked.clear();
  const result = await f.run();
  assert.equal(result.stats.hits, 2);
  assert.equal(result.stats.rendered, 2);
});

test("two page slots render concurrently and commit previews in reference order", async (t) => {
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
    async render(_reference, _width, slot = 0) {
      assert.ok(!slots.has(slot));
      slots.add(slot);
      maximum = Math.max(maximum, ++active);
      await new Promise((resolve) => setTimeout(resolve, slot === 0 ? 10 : 1));
      active--;
      return { diagnostics: [] };
    },
    async thumbnail(slot = 0) {
      slots.delete(slot);
      return Buffer.from(`page ${slot}`);
    },
    async close() {
      assert.equal(active, 0);
    },
  });
  const result = await f.run();
  assert.equal(maximum, 2);
  assert.equal(batches, 2);
  assert.deepEqual(Object.keys(result.previews), Object.keys(f.library));
  assert.deepEqual(
    result.assets.map((asset) => asset.bytes),
    [
      Buffer.from("page 0"),
      Buffer.from("page 1"),
      Buffer.from("page 0"),
      Buffer.from("page 1"),
    ],
  );
});
