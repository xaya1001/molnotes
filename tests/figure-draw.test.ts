import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const run = promisify(execFile);
test("draw works without a content library, emits every frame and retains diagnostics", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "figure-draw-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "figure.yaml"),
    out = join(root, "drawing.svg");
  await writeFile(
    source,
    "kind: mechanism\nbond: 1\nframes:\n  - {id: first, smiles: CCO}\n  - {id: second, smiles: 'CC=O'}\n",
  );
  const options = {
    cwd: root,
    env: {
      ...process.env,
      MOLNOTES_CONTENT_DIR: join(root, "missing-library"),
    },
  };
  const result = await run(
    process.execPath,
    [
      new URL("../scripts/figure-draw.ts", import.meta.url).pathname,
      source,
      "--out",
      out,
    ],
    options,
  );
  assert.match(result.stderr, /\[first\].*LABEL_OVERLAP/);
  assert.match(await readFile(join(root, "drawing-1.svg"), "utf8"), /<svg/);
  assert.match(await readFile(join(root, "drawing-2.svg"), "utf8"), /<svg/);
  assert.deepEqual((await readdir(root)).sort(), [
    "drawing-1.svg",
    "drawing-2.svg",
    "figure.yaml",
  ]);
  await assert.rejects(
    run(
      process.execPath,
      [new URL("../scripts/figure-lint.ts", import.meta.url).pathname, source],
      options,
    ),
    (error: Error & { code: number; stdout: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /\[first\].*LABEL_OVERLAP/);
      assert.match(error.stdout, /Figure lint: [1-9]\d* issues/);
      return true;
    },
  );
  await writeFile(source, "kind: gallery\ncompounds: {a: '[invalid'}\n");
  await assert.rejects(
    run(
      process.execPath,
      [
        new URL("../scripts/figure-draw.ts", import.meta.url).pathname,
        source,
        "--out",
        out,
      ],
      options,
    ),
  );
});
