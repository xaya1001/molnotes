import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { unescapedLocants } from "../scripts/figure-text-diagnostics.ts";

const run = promisify(execFile);
test("draw accepts standalone SMILES and the gallery structure fields", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "figure-draw-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "single.yaml"),
    out = join(root, "single.svg");
  for (const yaml of [
    "CCO\n",
    "smiles: CCO\nrot: 30\nabbreviate: false\nlabel: Sample\n",
    "template: chair\nsubs: {1a: CH3}\nrot: 30\n",
  ]) {
    await writeFile(source, yaml);
    await run(
      process.execPath,
      [
        new URL("../scripts/figure-draw.ts", import.meta.url).pathname,
        source,
        "--out",
        out,
      ],
      {
        env: {
          ...process.env,
          MOLNOTES_CONTENT_DIR: join(root, "missing-library"),
        },
      },
    );
    const svg = await readFile(out, "utf8");
    assert.match(svg, /<svg/);
    assert.match(
      svg,
      yaml.startsWith("template")
        ? /data-conformation="chair"/
        : /data-compound=/,
    );
  }
  assert.deepEqual((await readdir(root)).sort(), ["single.svg", "single.yaml"]);
});

test("draw works without a content library, emits every frame and retains diagnostics", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "figure-draw-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "figure.yaml"),
    out = join(root, "drawing.svg");
  await writeFile(
    source,
    "kind: scheme\nbond: 1\nstates:\n  first: {compounds: {structure: CCO}}\n  second: {compounds: {structure: 'CC=O'}}\narrows: {next: {from: first, to: second, kind: forward, role: elementary}}\n",
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
  await writeFile(source, "kind: scheme\ncompounds: {a: '[invalid'}\n");
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

test("figure:lint flags unescaped locants and ignores chemical formulas and escaped locants", async (t) => {
  assert.deepEqual(unescapedLocants("Attack at C2/C4 and N1"), [
    "C2",
    "C4",
    "N1",
  ]);
  assert.deepEqual(unescapedLocants("C3 位、O1=C2、N1 与 N2"), [
    "C3",
    "O1",
    "C2",
    "N1",
    "N2",
  ]);
  assert.deepEqual(
    unescapedLocants(
      "CH3, C6H5, H2O, CO2, NO2+, O2 (air), N2, -N2, C–N2+, N3-, Pd(PPh3)4, Cs2CO3, S8, P4, C\\2/C\\4, N\\1, C2 对称",
    ),
    [],
  );

  const root = await mkdtemp(join(tmpdir(), "figure-locant-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "route.yaml");
  const options = {
    cwd: root,
    env: {
      ...process.env,
      MOLNOTES_CONTENT_DIR: join(root, "missing-library"),
    },
  };
  await writeFile(
    source,
    [
      "kind: scheme",
      "title: Sample",
      "states:",
      "  a: {compounds: {structure: CCO}}",
      "  b: {compounds: {structure: CC=O}}",
      "arrows:",
      '  s1: { from: a, to: b, kind: forward, role: reaction, above: "C2/C4 activation" }',
      "",
    ].join("\n"),
  );
  await assert.rejects(
    run(
      process.execPath,
      [new URL("../scripts/figure-lint.ts", import.meta.url).pathname, source],
      options,
    ),
    (error: Error & { code: number; stdout: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /UNESCAPED_LOCANT/);
      assert.match(error.stdout, /C\\2/);
      return true;
    },
  );
  await writeFile(
    source,
    [
      "kind: scheme",
      "title: Sample",
      "states:",
      "  a: {compounds: {structure: CCO}}",
      "  b: {compounds: {structure: CC=O}}",
      "arrows:",
      '  s1: { from: a, to: b, kind: forward, role: reaction, above: "C\\\\2/C\\\\4, CH3, C6H5, O2 (air)" }',
      "",
    ].join("\n"),
  );
  const clean = await run(
    process.execPath,
    [new URL("../scripts/figure-lint.ts", import.meta.url).pathname, source],
    options,
  );
  assert.match(clean.stdout, /Figure lint: 0 issues/);
});
