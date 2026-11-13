import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { parse, stringify } from "yaml";
import { readChemicalLibrary } from "../scripts/content/chemical-library.ts";
import { saveFigureSource } from "../scripts/figure-save.ts";

const run = promisify(execFile);
const command = new URL("../scripts/figure-recompile.ts", import.meta.url)
  .pathname;

test("whole-library recompilation refreshes saved scenes, keeps identity and continues after a failed source", async () => {
  const root = await mkdtemp(join(tmpdir(), "figure-recompile-"));
  const library = await readChemicalLibrary(root);
  const inputs = [
    "title: Route\ncompounds: {a: CCO, b: 'CC=O', c: 'CC(=O)O'}\nsteps:\n  - {id: first, from: a, to: b}\n  - {id: second, from: b, to: c}\n",
    "kind: mechanism\nframes: [{id: event, smiles: CCO}]\n",
    "kind: gallery\ncompounds: {a: CCO}\n",
  ];
  const compiled = [];
  for (const [index, text] of inputs.entries()) {
    const source = join(root, `${index}.yaml`);
    await writeFile(source, text);
    compiled.push(await saveFigureSource(source, root, library));
  }
  const baseline = structuredClone(library.entries);
  const route = Object.values(library.entries).find(
    (entry) => entry.kind === "route",
  )!;
  assert.equal(route.kind, "route");
  // Preserve a real page reference and the existing JSON storage format.
  const page = join(root, "page.json");
  const reference = JSON.stringify({ type: "figure-ref", ref: route.id });
  await writeFile(page, reference);
  const galleryId = compiled[2].reference.ref;
  const jsonPath = library.files[galleryId].replace(/\.yaml$/, ".json");
  await rename(library.files[galleryId], jsonPath);
  await writeFile(
    jsonPath,
    JSON.stringify(baseline[galleryId], null, 2) + "\n",
  );
  for (const entry of Object.values(baseline)) {
    if (entry.kind !== "reaction" && entry.kind !== "mechanism") continue;
    const stale = structuredClone(entry);
    if (stale.kind === "reaction") stale.scene.width += 10;
    else stale.frames[0].scene.width += 10;
    await writeFile(
      entry.id === galleryId ? jsonPath : library.files[entry.id],
      entry.id === galleryId
        ? JSON.stringify(stale, null, 2) + "\n"
        : stringify(stale, { lineWidth: 0 }),
    );
  }
  const broken = join(root, compiled[1].sourceFile);
  await writeFile(broken, "kind: mechanism\nframes: [{smiles: '[invalid'}]\n");
  await assert.rejects(
    run(process.execPath, [command], {
      env: { ...process.env, MOLNOTES_CONTENT_DIR: root },
    }),
    (error: Error & { code: number; stdout: string; stderr: string }) => {
      assert.equal(error.code, 1);
      assert.ok(error.stderr.includes(broken));
      assert.match(
        error.stdout,
        /3 sources, 0 added, 3 modified, 0 deleted, 1 failed/,
      );
      return true;
    },
  );
  const refreshed = await readChemicalLibrary(root);
  assert.deepEqual(refreshed.entries[route.id], baseline[route.id]);
  for (const step of route.steps)
    assert.deepEqual(refreshed.entries[step.reaction], baseline[step.reaction]);
  assert.deepEqual(refreshed.entries[galleryId], baseline[galleryId]);
  assert.equal(refreshed.files[galleryId], jsonPath);
  assert.equal(await readFile(page, "utf8"), reference);
  const failedId = compiled[1].reference.ref;
  const staleMechanism = refreshed.entries[failedId];
  const originalMechanism = baseline[failedId];
  assert.equal(staleMechanism.kind, "mechanism");
  assert.equal(originalMechanism.kind, "mechanism");
  assert.equal(
    staleMechanism.frames[0].scene.width,
    originalMechanism.frames[0].scene.width + 10,
  );

  await writeFile(broken, inputs[1]);
  await run(process.execPath, [command, "--library", root, broken]);
  const noChanges = await run(process.execPath, [command, "--library", root]);
  assert.match(
    noChanges.stdout,
    /3 sources, 0 added, 0 modified, 0 deleted, 0 failed/,
  );
});

test("selected sources report new entries and remove only obsolete owned reactions", async () => {
  const root = await mkdtemp(join(tmpdir(), "figure-recompile-selected-"));
  const source = join(root, "route.yaml");
  const input = {
    compounds: { a: "CCO", b: "CC=O", c: "CC(=O)O" },
    steps: [
      { id: "first", from: "a", to: "b" },
      { id: "second", from: "b", to: "c" },
    ],
  };
  await writeFile(source, stringify(input));
  const saved = await saveFigureSource(
    source,
    root,
    await readChemicalLibrary(root),
  );
  const route = saved.entries[saved.reference.ref];
  assert.equal(route.kind, "route");
  const retained = route.steps[0].reaction,
    removed = route.steps[1].reaction;
  input.steps.pop();
  const selected = join(root, saved.sourceFile);
  await writeFile(selected, stringify(input));
  const additional = join(root, "additional.yaml");
  await writeFile(
    additional,
    "kind: conformation\ntemplate: chair\nsubs: {1a: H}\n",
  );
  const result = await run(process.execPath, [
    command,
    "--library",
    root,
    selected,
    additional,
    selected,
  ]);
  assert.match(
    result.stdout,
    /2 sources, 1 added, 2 modified, 1 deleted, 0 failed/,
  );
  assert.ok(result.stdout.includes(`deleted: ${removed}`));
  const current = await readChemicalLibrary(root);
  assert.ok(current.entries[retained]);
  assert.equal(current.entries[removed], undefined);
  assert.equal(current.entries[route.id].id, route.id);
  assert.deepEqual(current.entries[retained], saved.entries[retained]);
  assert.ok(
    Object.values(current.entries).some(
      (entry) => entry.kind === "conformation",
    ),
  );
  assert.equal(parse(await readFile(selected, "utf8")).steps.length, 1);
});
