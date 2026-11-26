import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { parse, stringify } from "yaml";
import { readChemicalLibrary } from "../scripts/content/chemical-library.ts";
import { prepareLibraryFigure } from "../scripts/figure-preparation.ts";
import { loadFigureStyle } from "../scripts/figure-route.ts";
import { saveFigureSource } from "../scripts/figure-save.ts";
import { compileFigure } from "../scripts/figure-scene.ts";
import { figureEntry, drawingPanels } from "./helpers/figure-graph.ts";

const run = promisify(execFile);
const command = new URL("../scripts/figure-recompile.ts", import.meta.url)
  .pathname;
const fixture = (name: string) =>
  readFile(new URL(`./fixtures/figures/${name}.yaml`, import.meta.url), "utf8");
const recompile = (root: string, ...sources: string[]) =>
  run(process.execPath, [command, "--library", root, ...sources]);

test("recompiling a graph retains its identities and prepared views", async () => {
  const style = await loadFigureStyle();
  for (const name of ["convergent", "products", "mechanism"]) {
    const root = await mkdtemp(join(tmpdir(), "figure-scheme-"));
    const source = join(root, "figure.yaml");
    const text = await fixture(name);
    await writeFile(source, text);
    const first = await saveFigureSource(
      source,
      root,
      await readChemicalLibrary(root),
    );
    const figure = figureEntry(first.entries[first.reference.ref]);
    assert.ok(first.changes.length);
    const compiled = await compileFigure(
      parse(text),
      first.entries,
      figure.sourceKey,
    );
    assert.deepEqual(compiled.reference, first.reference);
    assert.deepEqual(compiled.entries, first.entries);
    for (const ref of [
      first.reference,
      ...Object.keys(figure.views).map((frame) => ({
        ...first.reference,
        frame,
      })),
    ])
      assert.deepEqual(
        await prepareLibraryFigure(compiled.entries, ref, style),
        await prepareLibraryFigure(first.entries, ref, style),
      );
    const saved = join(root, first.sourceFile);
    const next = await saveFigureSource(
      saved,
      root,
      await readChemicalLibrary(root),
    );
    assert.deepEqual(next.changes, []);
    assert.equal(await readFile(saved, "utf8"), text);
  }
});

test("whole-library recompilation refreshes saved geometry and continues after a broken source", async () => {
  const root = await mkdtemp(join(tmpdir(), "figure-recompile-"));
  const library = await readChemicalLibrary(root);
  const files = [];
  for (const name of ["linear", "mechanism", "comparison"]) {
    const source = join(root, name + ".yaml");
    const text = await fixture(name);
    await writeFile(source, text);
    const saved = await saveFigureSource(source, root, library);
    files.push({
      id: saved.reference.ref,
      source: join(root, saved.sourceFile),
      text,
    });
  }
  const baseline = structuredClone(library.entries);
  const [route, broken, comparison] = files;
  const page = join(root, "page.json");
  const pageReference = JSON.stringify({ type: "figure-ref", ref: route.id });
  await writeFile(page, pageReference);
  const jsonPath = library.files[comparison.id].replace(/\.yaml$/, ".json");
  await rename(library.files[comparison.id], jsonPath);
  const staleComparison = figureEntry(structuredClone(baseline[comparison.id]));
  drawingPanels(staleComparison)[0].scene.width += 10;
  await writeFile(jsonPath, JSON.stringify(staleComparison, null, 2) + "\n");
  const staleBroken = figureEntry(structuredClone(baseline[broken.id]));
  drawingPanels(staleBroken)[0].scene.width += 10;
  await writeFile(
    library.files[broken.id],
    stringify(staleBroken, { lineWidth: 0 }),
  );
  await writeFile(
    broken.source,
    stringify({
      kind: "scheme",
      states: { broken: { compounds: { structure: "[invalid" } } },
      arrows: {},
    }),
  );

  await assert.rejects(recompile(root));
  const refreshed = await readChemicalLibrary(root);
  assert.deepEqual(refreshed.entries[route.id], baseline[route.id]);
  assert.deepEqual(refreshed.entries[comparison.id], baseline[comparison.id]);
  assert.equal(refreshed.files[comparison.id], jsonPath);
  assert.equal(await readFile(page, "utf8"), pageReference);
  assert.deepEqual(refreshed.entries[broken.id], staleBroken);

  await writeFile(broken.source, broken.text);
  await recompile(root, broken.source);
  const unchanged = await recompile(root);
  assert.match(
    unchanged.stdout,
    /3 sources, 0 added, 0 modified, 0 deleted, 0 failed/,
  );
});

test("selected compilation updates the containing figure when an arrow is removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "figure-recompile-selected-"));
  const source = join(root, "route.yaml");
  const input = parse(await fixture("linear"));
  await writeFile(source, stringify(input));
  const saved = await saveFigureSource(
    source,
    root,
    await readChemicalLibrary(root),
  );
  const figure = figureEntry(saved.entries[saved.reference.ref]);
  const [retained, removed] = Object.keys(input.arrows);
  delete input.arrows[removed];
  const selected = join(root, saved.sourceFile);
  await writeFile(selected, stringify(input));
  const additional = join(root, "additional.yaml");
  await writeFile(
    additional,
    "kind: conformation\ntemplate: chair\nsubs: {1a: H}\n",
  );
  const result = await recompile(root, selected, additional, selected);
  assert.match(
    result.stdout,
    /2 sources, 1 added, \d+ modified, 0 deleted, 0 failed/,
  );
  const current = await readChemicalLibrary(root);
  assert.ok(figureEntry(current.entries[figure.id]).graph.arrows[retained]);
  assert.equal(
    figureEntry(current.entries[figure.id]).graph.arrows[removed],
    undefined,
  );
  assert.ok(
    Object.values(current.entries).some(
      (entry) => entry.kind === "conformation",
    ),
  );
});
