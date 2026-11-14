import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { prepareCompound } from "../shared/chemical-library/chemistry.ts";

const run = promisify(execFile);
test("render requires an explicit entry, reference list or all-library selection", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "figure-render-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = new URL("../scripts/figure-render.ts", import.meta.url)
    .pathname;
  const out = join(root, "missing-selection");
  await assert.rejects(
    run(process.execPath, [
      script,
      "--library",
      join(root, "missing-library"),
      "--out",
      out,
      "--check",
    ]),
    (error: Error & { code: number; stderr: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /--entry <id>.*--all/);
      return true;
    },
  );
  assert.ok(!(await readdir(root)).includes("missing-selection"));
  const toolkit = await moleculeToolkit();
  await mkdir(join(root, "library/compounds"), { recursive: true });
  for (const [id, smiles] of [
    ["cmp_first", "CCO"],
    ["cmp_second", "CCC"],
  ] as const) {
    const entry = prepareCompound(toolkit, {
      id,
      smiles,
      title: "Sample",
      sources: [
        {
          source: "unknown",
          locator: "Sample",
          note: "Neutral test structure",
        },
      ],
    });
    await writeFile(
      join(root, "library/compounds", `${id}.json`),
      JSON.stringify(entry),
    );
  }
  const references = join(root, "refs.json");
  await writeFile(references, JSON.stringify([{ ref: "cmp_second" }]));
  for (const [name, selection, expected] of [
    ["selected", ["--entry", "cmp_first"], ["cmp_first-1366.json"]],
    ["all", ["--all"], ["cmp_first-1366.json", "cmp_second-1366.json"]],
    ["references", ["--references", references], ["cmp_second-1366.json"]],
  ] as const) {
    const output = join(root, name);
    await run(process.execPath, [
      script,
      "--library",
      root,
      "--out",
      output,
      "--check",
      ...selection,
    ]);
    assert.deepEqual((await readdir(output)).sort(), [...expected]);
  }
});
