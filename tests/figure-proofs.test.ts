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
      let current = "";
      return {
        async render(reference, width) {
          current = reference.ref;
          calls.push({ ref: current, width });
          return {
            diagnostics: blocked.has(current)
              ? [
                  {
                    code: "BOND_TOO_SMALL",
                    severity: "error" as const,
                    object: current,
                    elements: ["a1", "a2"],
                    message: "Restore bond geometry",
                  },
                ]
              : [],
          };
        },
        async thumbnail() {
          return Buffer.from(`example preview ${current}`);
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
  assert.equal(f.calls.length, 8);
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
  assert.deepEqual(f.calls.map((r) => r.ref).sort(), [
    "cmp_a",
    "cmp_a",
    "rxn_example",
    "rxn_example",
  ]);
});
test("a changed renderer fingerprint invalidates every viewport proof", async (t) => {
  const f = await fixture(t);
  await f.run();
  f.calls.length = 0;
  await f.run();
  assert.equal(f.calls.length, 0);
  f.options.renderer = "renderer-two";
  await f.run();
  assert.equal(f.calls.length, 8);
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
