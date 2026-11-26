import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { compileFigure } from "../scripts/figure-scene.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDefaultCoords } from "../shared/chemical-toolkit.ts";
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
} from "../shared/chemical-library/contract.ts";
import { figureRouteMetrics } from "../shared/chemical-library/routes.ts";
import type { Library, Scene } from "../shared/chemical-library/types.ts";
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
    computeDefaultCoords(mol);
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
    computeDefaultCoords(mol, true);
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
test("a convergent graph counts the longest route and rejects a reaction cycle", async () => {
  const source = parse(
    await readFile(
      new URL("./fixtures/figures/convergent.yaml", import.meta.url),
      "utf8",
    ),
  );
  const { entries, reference } = await compileFigure(source);
  const figure = entries[reference.ref];
  assert.equal(figure.kind, "figure");
  validateLibrary(entries);
  assert.equal(figureRouteMetrics(figure).longestLinearSteps, 2);
  const first = Object.values(figure.graph.arrows)[0];
  figure.graph.arrows.loop = { ...first, from: first.to, to: first.from };
  assert.throws(() => figureRouteMetrics(figure), /cycle/);
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
    {
      value: {
        type: "panels",
        mode: "steps",
        items: [
          { title: "First", text: "Input", ref: compound.id },
          {
            title: "Second",
            text: "Result",
            ref: compound.id,
            numbers: { compound: "2" },
          },
        ],
      },
      path: "/sites/second/",
      title: "Panels",
    },
  ]);
  assert.equal(usage.snapshot.uses[compound.id].length, 4);
  assert.equal(usage.references.length, 4);
  assert.deepEqual(usage.references[3].numbers, { compound: "2" });
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
    kind: "scheme",
    states: {
      first: { compounds: { structure: { smiles: "CCO" } } },
      second: { compounds: { structure: { smiles: "CCO", rot: 90 } } },
    },
    arrows: {
      ["next-" + "first"]: {
        from: "first",
        to: "second",
        kind: "forward",
        role: "elementary",
      },
    },
    views: {
      first: { items: ["first"], arrows: ["next-" + "first"] },
      second: { items: ["second"] },
    },
  });
  for (const e of Object.values(compiled.entries)) {
    const folder = e.kind === "compound" ? "compounds" : "figures";
    await mkdir(join(root, "library", folder), { recursive: true });
    await writeFile(
      join(root, "library", folder, e.id + ".yaml"),
      stringify(e),
    );
  }
  const { entries } = await readChemicalLibrary(root);
  assert.deepEqual(entries, compiled.entries);
  const mechanism = entries[compiled.reference.ref];
  assert.equal(mechanism.kind, "figure");
  assert.equal(
    mechanism.graph.states.first.scene!.molecules[0].compound,
    mechanism.graph.states.second.scene!.molecules[0].compound,
  );
  assert.equal(mechanism.graph.states.second.scene!.molecules[0].rotate, -90);
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
