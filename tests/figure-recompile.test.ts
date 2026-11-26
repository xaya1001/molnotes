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
import { routeMetrics } from "../shared/chemical-library/routes.ts";

const run = promisify(execFile);
const command = new URL("../scripts/figure-recompile.ts", import.meta.url)
  .pathname;

test("scheme sources preserve compiled entries, geometry and saved identities", async () => {
  const convergent = parse(
    await readFile(
      new URL("./fixtures/figures/convergent.yaml", import.meta.url),
      "utf8",
    ),
  );
  const joinStep = convergent.steps[0];
  joinStep.to = { id: joinStep.to, yield: "80%" };
  const mechanism = {
    kind: "scheme",
    frames: [
      {
        id: "before",
        compounds: {
          donor: "[OH-:1]",
          acceptor: "[CH2:2]=[O:3]",
        },
        arrows: [
          {
            id: "attack",
            from: "lp(donor:1)",
            to: "between(donor:1,acceptor:2)",
            forming: true,
          },
        ],
      },
      {
        id: "after",
        compounds: { product: "[OH:1][CH2:2][O-:3]" },
        map: {
          "donor:1": "product:1",
          "acceptor:2": "product:2",
          "acceptor:3": "product:3",
        },
      },
    ],
  };
  const style = await loadFigureStyle();
  for (const [prefix, source] of [
    ["rte", convergent],
    ["rxn", { ...convergent, steps: [joinStep] }],
    ["mec", mechanism],
  ] as const) {
    const root = await mkdtemp(join(tmpdir(), "figure-scheme-"));
    const sourcePath = join(root, "figure.yaml");
    const library = await readChemicalLibrary(root);
    await writeFile(sourcePath, stringify(source));
    const { changes, ...baseline } = await saveFigureSource(
      sourcePath,
      root,
      library,
    );
    assert.ok(changes.length);
    const { ref } = baseline.reference;
    const entry = baseline.entries[ref];
    assert.ok(ref.startsWith(prefix + "_"));

    const compiled = await compileFigure(
      source,
      baseline.entries,
      entry.sourceKey,
    );
    assert.deepEqual(compiled.reference, baseline.reference);
    assert.deepEqual(compiled.entries, baseline.entries);

    const views = [baseline.reference];
    if (entry.kind === "route") {
      assert.deepEqual(entry.edges, [
        { from: "left", to: "join", product: "product-2", reactant: "2" },
        { from: "right", to: "join", product: "product-4", reactant: "4" },
      ]);
      assert.equal(routeMetrics(entry, compiled.entries).longestLinearSteps, 2);
    } else if (entry.kind === "reaction") {
      assert.equal(entry.products[0].yield, "80%");
    } else if (entry.kind === "mechanism") {
      assert.deepEqual(
        entry.frames.map((frame) => frame.id),
        ["before", "after"],
      );
      assert.equal(entry.maps?.length, 3);
      const scene = entry.frames[0].scene;
      assert.equal(scene.arrows?.[0].to.kind, "formingBond");
      assert.equal(scene.partialBonds?.length, 1);
      views.push(...entry.frames.map(({ id }) => ({ ref, frame: id })));
    }
    for (const view of views)
      assert.deepEqual(
        await prepareLibraryFigure(compiled.entries, view, style),
        await prepareLibraryFigure(baseline.entries, view, style),
      );

    const saved = join(root, baseline.sourceFile);
    const yaml = stringify(source);
    await writeFile(saved, yaml);
    const recompiled = await saveFigureSource(
      saved,
      root,
      await readChemicalLibrary(root),
    );
    assert.deepEqual(recompiled.changes, []);
    assert.deepEqual(recompiled.entries, baseline.entries);
    assert.equal(await readFile(saved, "utf8"), yaml);
  }
});

test("whole-library recompilation refreshes saved scenes, keeps identity and continues after a failed source", async () => {
  const root = await mkdtemp(join(tmpdir(), "figure-recompile-"));
  const library = await readChemicalLibrary(root);
  const inputs = [
    "kind: scheme\ntitle: Route\ncompounds: {a: CCO, b: 'CC=O', c: 'CC(=O)O'}\nsteps:\n  - {id: first, from: a, to: b}\n  - {id: second, from: b, to: c}\n",
    "kind: scheme\nframes: [{id: event, smiles: CCO}]\n",
    "kind: scheme\ncompounds: {a: CCO}\n",
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
  await writeFile(broken, "kind: scheme\nframes: [{smiles: '[invalid'}]\n");
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
    kind: "scheme",
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
