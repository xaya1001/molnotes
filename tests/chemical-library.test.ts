import { test } from "node:test";
import assert from "node:assert/strict";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  prepareCompound,
  validateCompound,
  alignCoordinates,
  atomMaps,
  placedCoordinates,
  drawingMolecule,
  graphOf,
  validateSceneChemistry,
} from "../shared/chemical-library/chemistry.ts";
import {
  validateLibrary,
  validateFigureReference,
  validateLibraryEntry,
} from "../shared/chemical-library/contract.ts";
import { routeMetrics } from "../shared/chemical-library/routes.ts";
import type {
  Library,
  Reaction,
  Route,
  Scene,
} from "../shared/chemical-library/types.ts";
const sources = [{ source: "handbook", locator: "Example 1" }];
test("Kekulé variants preserve identity and bind pi anchors to their explicit bond orders", async () => {
  const rd = await moleculeToolkit();
  const c = prepareCompound(rd, {
    id: "cmp_ring",
    title: "Example ring",
    smiles: "c1ccccc1",
    sources,
  });
  const original = rd.get_mol(c.smiles)!;
  let molblock: string;
  try {
    molblock = original
      .get_v3Kmolblock()
      .split("\n")
      .map((line) =>
        /^M  V30 \d+ [12] \d+ \d+$/.test(line)
          ? line.replace(
              /^(M  V30 \d+ )([12])/,
              (_, prefix, order) => prefix + (order === "1" ? "2" : "1"),
            )
          : line,
      )
      .join("\n");
  } finally {
    original.delete();
  }
  c.variants = { alternate: { ...structuredClone(c.layout), molblock } };
  validateCompound(rd, c);
  const scene: Scene = {
    width: 10,
    height: 8,
    molecules: [
      { id: "ring", compound: c.id, variant: "alternate", at: { x: 4, y: 4 } },
    ],
    arrows: [
      {
        id: "push",
        electrons: 2,
        from: {
          kind: "pi",
          atoms: [
            { molecule: "ring", atom: "a2" },
            { molecule: "ring", atom: "a3" },
          ],
        },
        to: { kind: "atom", at: { molecule: "ring", atom: "a3" } },
      },
    ],
  };
  validateSceneChemistry(rd, { [c.id]: c }, scene, "example");
  const drawing = drawingMolecule(
    rd,
    c,
    placedCoordinates(rd, c, c.variants.alternate),
    c.variants.alternate,
  );
  try {
    assert.equal(
      graphOf(drawing).bonds.find(
        (b) => b.atoms.includes(1) && b.atoms.includes(2),
      )?.bo,
      2,
    );
  } finally {
    drawing.delete();
  }
  assert.throws(
    () =>
      validateSceneChemistry(
        rd,
        { [c.id]: c },
        {
          ...scene,
          molecules: [{ ...scene.molecules[0], variant: undefined }],
        },
        "example",
      ),
    /multiple bond/,
  );
  c.variants.alternate.molblock = molblock.replace(
    /(M  V30 \d+ C [^\n]* )1\n/,
    "$199\n",
  );
  assert.throws(() => validateCompound(rd, c), /atom maps/);
  c.variants.alternate.molblock = molblock.replace(" 1 C ", " 1 N ");
  assert.throws(() => validateCompound(rd, c), /graph|molecular/);
});
test("saved molecular identity survives 2D import and rejects a different stereoisomer", async () => {
  const rd = await moleculeToolkit();
  const input = {
    id: "cmp_example",
    title: "Example",
    smiles: "C[C@H](O)CO",
    sources,
  };
  const mol = rd.get_mol(input.smiles)!;
  try {
    mol.set_new_coords();
    const c = prepareCompound(rd, input, mol.get_molblock());
    validateCompound(rd, c);
    assert.equal(Object.keys(c.layout.coords).length, c.atomIds.length);
    assert.throws(
      () =>
        prepareCompound(
          rd,
          { ...input, smiles: "C[C@@H](O)CO" },
          mol.get_molblock(),
        ),
      /stereochemistry/,
    );
    const broken = structuredClone(c);
    delete broken.layout.coords.a1;
    assert.throws(() => validateCompound(rd, broken), /coordinates/);
  } finally {
    mol.delete();
  }
});
test("imported coordinates retain explicit stereochemical hydrogen atoms", async () => {
  const rd = await moleculeToolkit(),
    smiles = "C[C@]([H])(O)CO";
  const mol = rd.get_mol(smiles, JSON.stringify({ removeHs: false }))!;
  try {
    mol.set_new_coords(true);
    const compound = prepareCompound(
      rd,
      { id: "cmp_example", title: "Example", smiles, sources },
      mol.get_molblock(),
    );
    validateCompound(rd, compound);
    assert.equal(compound.atomIds.length, mol.get_num_atoms());
    assert.equal(
      Object.keys(compound.layout.coords).length,
      mol.get_num_atoms(),
    );
    assert.ok(
      Object.values(compound.layout.coords).every(
        (p) => Number.isFinite(p.x) && Number.isFinite(p.y),
      ),
    );
    const drawn = drawingMolecule(
      rd,
      compound,
      placedCoordinates(rd, compound, compound.layout),
    );
    try {
      assert.equal(graphOf(drawn).atoms.filter((a) => a.z === 1).length, 1);
    } finally {
      drawn.delete();
    }
  } finally {
    mol.delete();
  }
});

test("isotope labels remain part of saved molecular identity", async () => {
  const rd = await moleculeToolkit();
  const make = (smiles: string) =>
    prepareCompound(rd, {
      id: "cmp_isotope",
      title: "Isotope",
      smiles,
      sources,
    });
  const labelled = make("[2H]CC(=O)C");
  assert.notEqual(labelled.graph, make("CC(=O)C").graph);
  assert.equal(make("[H]C([H])([H])O").graph, make("CO").graph);
  validateCompound(rd, labelled);
});

test("page references cannot own molecular facts or layout and limit semantic focus", () => {
  assert.throws(
    () => validateFigureReference({ ref: "cmp_example", smiles: "CC" }),
    /unknown reference/,
  );
  assert.throws(
    () =>
      validateFigureReference({
        ref: "cmp_example",
        focus: { supporting: [{}, {}, {}] },
      }),
    /two supporting/,
  );
  validateFigureReference({
    ref: "cmp_example",
    numbers: { compound: "7" },
    focus: { primary: { atoms: [{ molecule: "compound", atom: "a1" }] } },
  });
});
test("a convergent route validates graph edges and counts the longest path", async () => {
  const rd = await moleculeToolkit();
  const c = prepareCompound(rd, {
    id: "cmp_example",
    title: "Example",
    smiles: "CCO",
    sources,
  });
  const rx = (id: string, yieldValue: string): Reaction => ({
    kind: "reaction",
    id,
    title: id,
    sources,
    reactants: [{ id: "input", compound: c.id }],
    products: [{ id: "output", compound: c.id, yield: yieldValue }],
    reagents: [],
    conditions: [],
    explanation: "Example transformation",
    scene: {
      width: 12,
      height: 6,
      molecules: [
        { id: "input", compound: c.id, at: { x: 2, y: 3 } },
        { id: "output", compound: c.id, at: { x: 10, y: 3 } },
      ],
    },
    arrow: { from: { x: 4, y: 3 }, to: { x: 8, y: 3 }, textWidth: 4 },
  });
  const library: Library = {
    [c.id]: c,
    rxn_a: rx("rxn_a", "80%"),
    rxn_b: rx("rxn_b", "40%"),
    rxn_c: rx("rxn_c", "50%"),
  };
  const convergent = library.rxn_c as Reaction;
  convergent.reactants.push({ id: "second", compound: c.id });
  convergent.scene.molecules.push({
    id: "second",
    compound: c.id,
    at: { x: 2, y: 5 },
  });
  const route: Route = {
    kind: "route",
    id: "rte_example",
    title: "Convergent",
    sources,
    width: 30,
    height: 20,
    steps: [
      { id: "a", reaction: "rxn_a", at: { x: 0, y: 0 } },
      { id: "b", reaction: "rxn_b", at: { x: 15, y: 0 } },
      { id: "c", reaction: "rxn_c", at: { x: 7, y: 10 } },
    ],
    edges: [
      { from: "a", to: "c", product: "output", reactant: "input" },
      { from: "b", to: "c", product: "output", reactant: "second" },
    ],
  };
  library[route.id] = route;
  validateLibrary(library);
  assert.equal(routeMetrics(route, library).longestLinearSteps, 2);
  assert.throws(
    () =>
      routeMetrics(
        {
          ...route,
          edges: [
            ...route.edges,
            { from: "c", to: "a", product: "output", reactant: "input" },
          ],
        },
        library,
      ),
    /cycle/,
  );
});
test("alignment preserves distances while placing explicitly corresponding atoms", () => {
  const coords = { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, c: { x: 1, y: 1 } };
  const result = alignCoordinates(
    coords,
    { p: { x: 2, y: 2 }, q: { x: 2, y: 3 } },
    [
      ["a", "p"],
      ["b", "q"],
    ],
  );
  assert.deepEqual(result.a, { x: 2, y: 2 });
  assert.ok(Math.abs(result.c.x - 1) < 1e-10);
  assert.ok(Math.abs(result.c.y - 3) < 1e-10);
});

test("R templates join only the selected permitted attachment and retain a real molecular graph", async () => {
  const { instantiateTemplate } =
    await import("../shared/chemical-library/templates.ts");
  const rd = await moleculeToolkit();
  const t = prepareCompound(rd, {
    id: "cmp_template",
    title: "Template",
    smiles: "CC(=O)[*:1]",
    sources,
  });
  const side = prepareCompound(rd, {
    id: "cmp_side",
    title: "Substituent",
    smiles: "[*:1]OC",
    sources,
  });
  side.attachment = side.atomIds[0];
  validateCompound(rd, side);
  t.template = [
    {
      atom: t.atomIds[3],
      label: "R¹",
      allowed: [side.id],
      description: "Acyl substituent",
    },
  ];
  const result = instantiateTemplate(
    rd,
    t,
    { [t.atomIds[3]]: side.id },
    { [side.id]: side },
  );
  const mol = rd.get_mol(result)!;
  try {
    assert.equal(mol.get_smiles(), "COC(C)=O");
  } finally {
    mol.delete();
  }
  assert.throws(
    () =>
      instantiateTemplate(
        rd,
        t,
        { [t.atomIds[3]]: "cmp_missing" },
        { [side.id]: side },
      ),
    /not allowed/,
  );
});

test("persistent atom maps survive traversal changes and mirrored geometry preserves stereochemistry", async () => {
  const rd = await moleculeToolkit();
  const c = prepareCompound(rd, {
    id: "cmp_mapped",
    title: "Mapped",
    smiles: "C[C@H](O)CO",
    sources,
  });
  const m = rd.get_mol(c.smiles)!;
  try {
    c.smiles = m.get_smiles();
  } finally {
    m.delete();
  }
  const reordered = rd.get_mol(c.smiles)!;
  try {
    c.atomIds = atomMaps(reordered).map((n) => `a${n}`);
  } finally {
    reordered.delete();
  }
  validateCompound(rd, c);
  const mirrored = drawingMolecule(
    rd,
    c,
    placedCoordinates(rd, c, c.layout, 30, true),
  );
  try {
    assert.equal(mirrored.get_smiles(), c.graph);
  } finally {
    mirrored.delete();
  }
  const invalid = structuredClone(c);
  [invalid.atomIds[0], invalid.atomIds[1]] = [
    invalid.atomIds[1],
    invalid.atomIds[0],
  ];
  assert.throws(() => validateCompound(rd, invalid), /persistent SMILES maps/);
});

test("library dependencies include scene participants and report reverse references without copying facts", async () => {
  const { libraryUsage } =
    await import("../scripts/content/chemical-library.ts");
  const rd = await moleculeToolkit();
  const compound = prepareCompound(rd, {
    id: "cmp_example",
    title: "Example",
    smiles: "CCO",
    sources,
  });
  const entries: Library = { [compound.id]: compound };
  const usage = libraryUsage(entries, [
    {
      value: {
        blocks: [
          { type: "figure-ref", ref: compound.id, numbers: { compound: "1" } },
        ],
      },
      path: "/sites/example/",
      title: "Topic",
    },
    {
      value: { type: "figure-ref", ref: compound.id },
      path: "/notes/example/first",
      title: "Note",
    },
  ]);
  assert.equal(usage.snapshot.uses[compound.id].length, 2);
  assert.equal(usage.snapshot.entries[compound.id], compound);
  assert.throws(
    () =>
      libraryUsage(entries, [
        {
          value: { type: "figure-ref", ref: compound.id, variant: "missing" },
          path: "/notes/example/first",
          title: "Note",
        },
      ]),
    /variant/,
  );
  assert.throws(
    () =>
      libraryUsage(entries, [
        {
          value: {
            type: "figure-ref",
            ref: compound.id,
            focus: {
              primary: { atoms: [{ molecule: "compound", atom: "missing" }] },
            },
          },
          path: "/notes/example/first",
          title: "Note",
        },
      ]),
    /unknown atom/,
  );
});

test("filled heads meet the visible shaft at their notch and distinguish one electron", async () => {
  const { solidArrow } = await import("../src/ui/library/arrow-layout.ts");
  for (const B of [20, 32]) {
    const p = (x: number, y: number) => ({ x: x * B, y: y * B });
    const controls = [p(1.5, -1), p(3, -1)];
    const full = solidArrow(p(0, 0), p(4, 0), B, controls);
    const half = solidArrow(p(0, 0), p(4, 0), B, controls, true);
    assert.equal(full.vertices.length, 4);
    assert.equal(half.vertices.length, 3);
    for (const shape of [full, half]) {
      const end = shape.points.at(-1)!,
        notch = shape.vertices[2];
      assert.ok(Math.hypot(end.x - notch.x, end.y - notch.y) < 1e-7);
      assert.ok(Math.hypot(end.x - 4 * B, end.y) > B * 0.29);
    }
    assert.deepEqual(half.vertices[0], full.vertices[0]);
  }
});

test("content reads compiled YAML figures with shared compound identity", async () => {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { stringify } = await import("yaml");
  const { compileFigure } = await import("../scripts/figure-scene.ts");
  const { readChemicalLibrary } =
    await import("../scripts/content/chemical-library.ts");
  const root = await mkdtemp(
    join(process.env.TMPDIR ?? tmpdir(), "chemical-library-"),
  );
  const compiled = await compileFigure({
    kind: "mechanism",
    frames: [
      { id: "first", smiles: "CCO" },
      { id: "second", smiles: "CCO", rot: 90, arrow: "none" },
    ],
  });
  for (const e of Object.values(compiled.entries)) {
    const folder = e.kind === "compound" ? "compounds" : "mechanisms";
    await mkdir(join(root, "library", folder), { recursive: true });
    await writeFile(
      join(root, "library", folder, e.id + ".yaml"),
      stringify(e),
    );
  }
  const { entries } = await readChemicalLibrary(root);
  assert.deepEqual(entries, compiled.entries);
  const mechanism = entries[compiled.reference.ref];
  if (mechanism.kind !== "mechanism") throw new Error("Expected mechanism");
  assert.equal(
    mechanism.frames[0].scene.molecules[0].compound,
    mechanism.frames[1].scene.molecules[0].compound,
  );
  assert.equal(mechanism.frames[1].scene.molecules[0].rotate, 90);
});

test("process entries load once and accept reusable references while validating node boundaries", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readChemicalLibrary, libraryUsage } =
    await import("../scripts/content/chemical-library.ts");
  const entry = {
    kind: "process",
    id: "prc_transfer",
    title: "Transfer",
    sources,
    label: "Transfer steps",
    nodes: [{ name: "Input" }, { name: "Output" }],
    scenarios: [
      {
        name: "Default",
        steps: [
          {
            title: "Move",
            text: "Transfer the input",
            state: "At output",
            kind: "transfer",
            from: 0,
            to: 1,
          },
        ],
      },
    ],
  };
  validateLibraryEntry(entry);
  const invalid = structuredClone(entry);
  invalid.scenarios[0].steps[0].to = 2;
  assert.throws(() => validateLibraryEntry(invalid), /unknown node/);
  assert.throws(
    () => validateLibraryEntry({ ...entry, id: "img_transfer" }),
    /kind mismatch/,
  );
  const root = await mkdtemp(join(tmpdir(), "process-library-"));
  try {
    await mkdir(join(root, "library/processes"), { recursive: true });
    await writeFile(
      join(root, "library/processes/prc_transfer.json"),
      JSON.stringify(entry),
    );
    const { entries } = await readChemicalLibrary(root);
    const usage = libraryUsage(
      entries,
      ["first", "second"].map((name) => ({
        value: { type: "figure-ref", ref: entry.id },
        path: `/sites/${name}/`,
        title: name,
      })),
    );
    assert.deepEqual(entries[entry.id], entry);
    assert.equal(usage.snapshot.uses[entry.id].length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("compound identity preserves relative stereo groups as well as isotopes", async () => {
  const rd = await moleculeToolkit();
  const make = (smiles: string) =>
    prepareCompound(rd, { id: "cmp_stereo", title: "Stereo", smiles, sources });
  const absolute = make("C[C@H](O)F"),
    relative = make("C[C@H](O)F |&1:1|");
  assert.notEqual(absolute.graph, relative.graph);
  assert.match(relative.smiles, /&1:/);
  validateCompound(rd, relative);
});
