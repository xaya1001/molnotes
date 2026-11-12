import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  readdir,
  mkdtemp,
  writeFile,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "yaml";
import { compileFigure } from "../scripts/figure-scene.ts";
import { validateFigureInput } from "../scripts/figure-input.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  prepareCompound,
  drawingMolecule,
  placedCoordinates,
  graphSignature,
} from "../shared/chemical-library/chemistry.ts";
import { routeMetrics } from "../shared/chemical-library/routes.ts";
import type {
  Compound,
  Mechanism,
  Reaction,
  Route,
} from "../shared/chemical-library/types.ts";
const fixture = async (name: string) =>
  parse(
    await readFile(
      new URL(`./fixtures/figures/${name}.yaml`, import.meta.url),
      "utf8",
    ),
  );

test("route YAML compiles linear, convergent and divergent step graphs", async () => {
  for (const [name, edges, length] of [
    ["linear", 2, 3],
    ["convergent", 2, 2],
    ["branched", 2, 2],
  ] as const) {
    const r = await compileFigure(await fixture(name)),
      route = r.entries[r.reference.ref] as Route;
    assert.equal(route.kind, "route");
    assert.equal(route.edges.length, edges);
    assert.equal(routeMetrics(route, r.entries).longestLinearSteps, length);
    assert.equal(route.steps.length, 3);
    for (const step of route.steps)
      assert.equal(r.entries[step.reaction].owner, route.id);
    assert.deepEqual(
      (await compileFigure(await fixture(name), r.entries)).entries,
      r.entries,
    );
  }
  const input = await fixture("convergent");
  input.steps[0].others = "text";
  const r = await compileFigure(input),
    route = r.entries[r.reference.ref] as Route;
  assert.equal(route.edges.length, 2);
  assert.equal(routeMetrics(route, r.entries).longestLinearSteps, 2);
});

test("chemical identity ignores source maps and labels, retaining stereo, isotope, charge and salt", async () => {
  const rd = await moleculeToolkit();
  const saved = prepareCompound(rd, {
    id: "cmp_saved",
    title: "Saved",
    smiles: "[CH3:21][CH2:22][OH:23]",
    sources: [{ source: "unknown", locator: "Fixture", note: "Authored" }],
  });
  const input = {
    kind: "mechanism",
    frames: [
      {
        id: "first",
        smiles: "[OH:9][CH2:8][CH3:7]",
        arrows: [{ id: "lp", from: "lp(9)", to: "atom(8)" }],
      },
    ],
  };
  const r = await compileFigure(input, { [saved.id]: saved }),
    m = r.entries[r.reference.ref] as Mechanism;
  assert.equal(m.frames[0].scene.molecules[0].compound, saved.id);
  assert.equal(m.frames[0].scene.labels![0].at.atom, "a23");
  const retained = r.entries[saved.id] as Compound;
  assert.deepEqual(retained.atomIds, saved.atomIds);
  assert.equal(retained.graph, saved.graph);
  assert.equal(retained.title, "Saved");
  const route = await compileFigure(
    {
      compounds: {
        a: { smiles: "CCO", label: "A", name: "Local" },
        b: "[CH3:4][CH2:5][OH:6]",
      },
      steps: [{ from: "a", to: "b" }],
    },
    { [saved.id]: saved },
  );
  assert.equal(
    Object.values(route.entries).filter((e) => e.kind === "compound").length,
    1,
  );
  assert.equal(
    (route.entries[route.reference.ref] as Reaction).reactants[0].name,
    "Local",
  );
  const compounds = {
    a: "C[C@H](O)CO",
    b: "C[C@@H](O)CO",
    c: "[13CH3]CO",
    d: "CCO",
    e: "CC[O-]",
    f: "CC[O-].[Na+]",
  };
  const distinct = await compileFigure({
    compounds,
    steps: [{ from: "a", to: ["b", "c", "d", "e", "f"] }],
  });
  assert.equal(
    Object.values(distinct.entries).filter((e) => e.kind === "compound").length,
    6,
  );
});

test("bracket abbreviations expand before graph deduplication", async () => {
  const r = await compileFigure({
    compounds: { a: "CO[TBS]", b: "CO[Si](C)(C)C(C)(C)C" },
    steps: [{ from: "a", to: "b" }],
  });
  const cs = Object.values(r.entries).filter(
    (e): e is Compound => e.kind === "compound",
  );
  assert.equal(cs.length, 1);
  assert.ok(!cs[0].smiles.includes("TBS"));
  assert.deepEqual(cs[0].layout.abbreviations, ["TBS"]);
  const ring = await compileFigure({
    compounds: { a: "c1ccc(O[PMB])cc1", b: "c1ccc(OCc2ccc(OC)cc2)cc1" },
    steps: [{ from: "a", to: "b" }],
  });
  assert.equal(
    Object.values(ring.entries).filter((e) => e.kind === "compound").length,
    1,
  );
});

test("reaction participants preserve product text and text-only reagents", async () => {
  const r = await compileFigure(await fixture("products")),
    reaction = r.entries[r.reference.ref] as Reaction;
  assert.equal(reaction.kind, "reaction");
  assert.equal(reaction.arrow.kind, "equilibrium");
  assert.equal(reaction.products[0].ratio, "45%");
  assert.equal(reaction.products[1].yield, "82% combined");
  assert.ok(reaction.reagents.includes("NH2OH"));
  assert.equal(reaction.reactants.length, 1);
  assert.equal(
    reaction.scene.captions?.filter((c) => c.text === "+").length,
    1,
  );
  assert.deepEqual(
    (await compileFigure(await fixture("products"), r.entries)).entries,
    r.entries,
  );

  const rd = await moleculeToolkit();
  for (const placement of reaction.scene.molecules) {
    const compound = r.entries[placement.compound] as Compound;
    const layout = placement.variant
      ? compound.variants![placement.variant]
      : compound.layout;
    const drawing = drawingMolecule(
      rd,
      compound,
      placedCoordinates(
        rd,
        compound,
        layout,
        placement.rotate,
        placement.mirror,
      ),
      layout,
      placement.rotate,
      placement.mirror,
    );
    try {
      assert.equal(graphSignature(rd, drawing), compound.graph);
    } finally {
      drawing.delete();
    }
  }

  for (const show of ["box", "text", "plus", "none"]) {
    const result = await compileFigure({
      compounds: { a: "CCO", b: { smiles: "N", text: "Ammonia" }, c: "CCN" },
      steps: [{ from: ["a", { id: "b", show }], to: "c" }],
    });
    const reaction = result.entries[result.reference.ref] as Reaction;
    assert.equal(
      reaction.scene.molecules.length,
      show === "box" || show === "plus" ? 3 : 2,
    );
    assert.equal(reaction.reagents.includes("Ammonia"), show === "text");
  }
});

test("mechanism YAML preserves explanation, maps, arrow IDs and focus", async () => {
  const r = await compileFigure(await fixture("mechanism")),
    m = r.entries[r.reference.ref] as Mechanism;
  assert.equal(m.frames.length, 2);
  assert.equal(m.maps?.length, 4);
  assert.equal(m.frames[0].explanation, "Two arrows in one event.");
  const scene = m.frames[0].scene;
  assert.equal(scene.arrows![1].electrons, 1);
  assert.deepEqual(scene.focus, {
    primary: { arrows: ["main"] },
    supporting: [{ arrows: ["support"] }],
  });
  const aromatic = await compileFigure({
    kind: "mechanism",
    frames: [
      {
        id: "ring",
        smiles: "[CH:1]1=[CH:2][CH:3]=[CH:4][CH:5]=[CH:6]1",
        arrows: [{ id: "push", from: "pi(1,2)", to: "atom(2)" }],
      },
    ],
  });
  const ring = aromatic.entries[aromatic.reference.ref] as Mechanism,
    placement = ring.frames[0].scene.molecules[0];
  assert.ok(placement.variant);
  assert.ok(
    (aromatic.entries[placement.compound] as Compound).variants![
      placement.variant!
    ].molblock,
  );
  const same = await compileFigure({
    kind: "mechanism",
    frames: [
      { id: "a", smiles: "[CH3:7][OH:8]" },
      { id: "b", smiles: "[CH3:7][O-:8]" },
    ],
  });
  assert.equal((same.entries[same.reference.ref] as Mechanism).maps?.length, 2);
  const comparison = await compileFigure(await fixture("comparison")),
    cmp = comparison.entries[comparison.reference.ref] as Mechanism;
  assert.equal(cmp.category, "comparison");
  assert.equal(cmp.frames[0].scene.reactionArrows, undefined);
  for (const arrow of [
    "forward",
    "equilibrium",
    "resonance",
    "retro",
    "none",
  ]) {
    const r = await compileFigure({
      compounds: { a: "CO", b: "C=O" },
      steps: [{ from: "a", to: "b", arrow }],
    });
    assert.equal((r.entries[r.reference.ref] as Reaction).arrow.kind, arrow);
  }
});

test("YAML boundary rejects unsupported kinds and style fields, validates deferred references", async () => {
  const input = {
    kind: "route",
    compounds: { a: "CCO", b: "CC=O" },
    steps: [{ from: "a", to: "b" }],
  };
  for (const field of [
    "bond",
    "width",
    "charges",
    "dots",
    "ring_h",
    "abbreviate",
  ])
    assert.throws(
      () => validateFigureInput({ ...input, [field]: 1 }),
      new RegExp(field),
    );
  for (const kind of ["gallery", "scope", "table", "cycle"])
    assert.throws(() => validateFigureInput({ ...input, kind }), /尚未支持/);
  assert.throws(
    () =>
      validateFigureInput({
        ...input,
        compounds: { a: { template: "chair" } },
      }),
    /尚未支持/,
  );
  const deferred = {
    kind: "mechanism",
    forming: true,
    frames: [
      {
        id: "one",
        smiles: "[CH3:1][OH:2]",
        scale: 1.5,
        enclose: [{ atoms: [1] }],
        arrows: [{ from: "lp(2)", to: "atom(1)", forming: true }],
      },
    ],
  };
  const r = await compileFigure(deferred);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /已保存、渲染待实现/);
  await assert.rejects(
    compileFigure({
      ...deferred,
      frames: [{ ...deferred.frames[0], enclose: [{ atoms: [99] }] }],
    }),
    /unknown atom/,
  );
  await assert.rejects(
    compileFigure({
      kind: "mechanism",
      frames: [
        {
          id: "a",
          smiles: "[CH3:1][OH:2]",
          arrows: [{ from: "lp(99)", to: "atom(1)" }],
        },
      ],
    }),
    /Unknown atom/,
  );
});

test("compilation stores source and stable entries, and recompilation writes no changes", async () => {
  const root = await mkdtemp(
      join(process.env.TMPDIR ?? tmpdir(), "figure-input-"),
    ),
    source = join(root, "input.yaml");
  const text = await readFile(
    new URL("./fixtures/figures/linear.yaml", import.meta.url),
    "utf8",
  );
  await writeFile(source, text);
  const run = promisify(execFile),
    args = ["scripts/figure-compile.ts", "--source", source, "--library", root];
  const { stdout } = await run(process.execPath, args),
    id = stdout.trim();
  const scan = async () => {
    const files: Record<string, string> = {};
    for (const dir of ["sources", "compounds", "reactions", "routes"]) {
      for (const name of await readdir(join(root, "library", dir))) {
        files[dir + "/" + name] = await readFile(
          join(root, "library", dir, name),
          "utf8",
        );
      }
    }
    return files;
  };
  const before = await scan();
  const first = parse(
    before[
      `reactions/${(parse(before[`routes/${id}.yaml`]) as Route).steps[0].reaction}.yaml`
    ],
  ) as Reaction;
  assert.equal(first.scene.arrows, undefined);
  assert.equal(first.scene.labels, undefined);
  assert.equal(first.scene.focus, undefined);
  assert.ok(
    first.scene.molecules.every(
      (p) =>
        Number(p.at.x.toFixed(3)) === p.at.x &&
        Number(p.at.y.toFixed(3)) === p.at.y,
    ),
  );

  assert.equal(before[`sources/${id}.yaml`], text);
  await run(process.execPath, args);
  assert.deepEqual(await scan(), before);
  const compounds = Object.entries(before).filter(([path]) =>
    path.startsWith("compounds/"),
  );
  const [yamlPath, compoundText] = compounds.find(
    ([, text]) => parse(text).variants,
  )!;
  const compound = parse(compoundText),
    jsonPath = join(root, "library", yamlPath.replace(/\.yaml$/, ".json"));
  await writeFile(jsonPath, JSON.stringify(compound));
  await unlink(join(root, "library", yamlPath));
  await run(process.execPath, args);
  const { readChemicalLibrary } =
    await import("../scripts/content/chemical-library.ts");
  const loaded = await readChemicalLibrary(root);
  assert.equal(loaded.entries[compound.id].kind, "compound");

  await writeFile(
    source,
    text.replace("First transformation.", "Updated explanation."),
  );
  assert.equal((await run(process.execPath, args)).stdout.trim(), id);
  const saved = join(root, "library", "sources", id + ".yaml");
  assert.equal(
    (
      await run(process.execPath, [
        "scripts/figure-compile.ts",
        "--source",
        saved,
        "--library",
        root,
      ])
    ).stdout.trim(),
    id,
  );
});
