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
  compoundAbbreviations,
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

test("forming arrows persist dashed bonds only when selected", async () => {
  for (const forming of [false, true]) {
    const compiled = await compileFigure({
      kind: "mechanism",
      forming: true,
      frames: [
        {
          id: "addition",
          smiles: "[O-:1].[CH2:2]=[O:3]",
          arrows: [{ from: "lp(1)", to: "between(1,2)", forming }],
        },
      ],
    });
    const scene = (compiled.entries[compiled.reference.ref] as Mechanism)
      .frames[0].scene;
    assert.equal(scene.partialBonds?.length ?? 0, forming ? 1 : 0);
    assert.deepEqual(compiled.warnings, []);
  }
});

test("collection cells retain their selected forming bonds", async () => {
  const compiled = await compileFigure({
    kind: "gallery",
    compounds: {
      event: {
        smiles: "[O-:1].[CH2:2]=[O:3]",
        arrows: [{ from: "lp(1)", to: "between(1,2)", forming: true }],
      },
    },
  });
  const scene = (compiled.entries[compiled.reference.ref] as Mechanism)
    .frames[0].scene;
  assert.equal(scene.partialBonds?.length, 1);
  assert.deepEqual(
    scene.partialBonds![0].atoms,
    scene.arrows![0].to.kind === "formingBond" ? scene.arrows![0].to.atoms : [],
  );
});

test("collection electron events align their reacting fragments", async () => {
  const compiled = await compileFigure({
    kind: "gallery",
    compounds: {
      event: {
        smiles: "[CH2:1]=[C:2](OC)[CH:5]=[CH2:6].[CH2:7]=[CH:8]C#N",
        arrows: [
          { from: "pi(1,2)", to: "between(1,7)", forming: true },
          { from: "pi(5,6)", to: "bond(2,5)" },
          { from: "pi(7,8)", to: "between(8,6)", forming: true },
        ],
      },
    },
  });
  const scene = (compiled.entries[compiled.reference.ref] as Mechanism)
    .frames[0].scene;
  const placement = scene.molecules[0];
  const compound = compiled.entries[placement.compound] as Compound;
  const coords =
    compound.variants?.[placement.variant!]?.coords ?? compound.layout.coords;
  const bonds = scene
    .arrows!.filter((a) => a.to.kind === "formingBond")
    .map((a) => {
      assert.equal(a.to.kind, "formingBond");
      return a.to.atoms.map((at) => coords[at.atom]);
    });
  const distance = ([a, b]: (typeof bonds)[number]) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(Math.abs(distance(bonds[0]) - distance(bonds[1])) < 1e-6);
});

test("route electron events align reacting fragments after depiction", async () => {
  const compiled = await compileFigure({
    kind: "route",
    changes: "off",
    compounds: {
      event: {
        smiles: "[CH2:1]=[C:2](OC)[CH:5]=[CH2:6].[CH2:7]=[CH:8]C#N",
        arrows: [
          { from: "pi(1,2)", to: "between(1,7)" },
          { from: "pi(5,6)", to: "bond(2,5)" },
          { from: "pi(7,8)", to: "between(8,6)" },
        ],
      },
      product: "CCO",
      final: "CC=O",
    },
    steps: [
      { from: "event", to: "product" },
      { from: "product", to: "final" },
    ],
  });
  const route = compiled.entries[compiled.reference.ref] as Route;
  const scene = (compiled.entries[route.steps[0].reaction] as Reaction).scene;
  const placement = scene.molecules.find((m) => m.id === "event")!;
  const compound = compiled.entries[placement.compound] as Compound;
  const coords = compound.variants![placement.variant!].coords;
  const bonds = scene
    .arrows!.filter((a) => a.to.kind === "formingBond")
    .map((a) => {
      assert.equal(a.to.kind, "formingBond");
      return a.to.atoms.map((at) => coords[at.atom]);
    });
  const distance = ([a, b]: (typeof bonds)[number]) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(Math.abs(distance(bonds[0]) - distance(bonds[1])) < 1e-6);
});

test("disconnected electron events keep each fragment's free orientation", async () => {
  const compiled = await compileFigure({
    kind: "mechanism",
    frames: [
      {
        id: "event",
        smiles: "[2H:1][CH2:2][C:3](=[O:4])C.[OH-:5]",
        arrows: [
          { from: "charge(5)", to: "atom(1)" },
          { from: "bond(1,2)", to: "bond(2,3)" },
          { from: "pi(3,4)", to: "atom(4)" },
        ],
      },
    ],
  });
  const placement = (compiled.entries[compiled.reference.ref] as Mechanism)
    .frames[0].scene.molecules[0];
  const compound = compiled.entries[placement.compound] as Compound;
  const coords = compound.variants![placement.variant!].coords;
  // chemfig.depict: the free carbonyl fragment has its C=O vertical, O above C.
  assert.ok(Math.abs(coords.a4.x - coords.a3.x) < 0.001);
  assert.ok(Math.abs(coords.a4.y - coords.a3.y + 1) < 0.001);
});

test("mixed electron events straighten once after orienting their fragments", async () => {
  const compiled = await compileFigure({
    kind: "mechanism",
    frames: [
      {
        id: "event",
        smiles: "[Br:1][CH2:2]CCCC=C.[Sn:8](CCCC)(CCCC)CCCC |^1:7|",
        arrows: [
          { from: "radical(8)", to: "atom(1)", electrons: 1 },
          { from: "bond(1,2)", to: "atom(8)", electrons: 1 },
          { from: "bond(1,2)", to: "atom(2)", electrons: 1 },
        ],
      },
    ],
  });
  const placement = (compiled.entries[compiled.reference.ref] as Mechanism)
    .frames[0].scene.molecules[0];
  const compound = compiled.entries[placement.compound] as Compound;
  const coords = compound.variants![placement.variant!].coords;
  // Mapped Br-C direction from chemfig.depict, in one-bond units with y down.
  assert.ok(Math.abs(coords.a2.x - coords.a1.x + 0.7436) < 0.002);
  assert.ok(Math.abs(coords.a2.y - coords.a1.y + 0.6685) < 0.002);
});

test("structures and reactions without electron events retain their saved orientation", async () => {
  const smiles = "[2H:1][CH2:2][C:3](=[O:4])C.[OH-:5]";
  for (const input of [
    { kind: "mechanism", frames: [{ id: "event", smiles }] },
    {
      kind: "route",
      anchor: "event",
      changes: "off",
      compounds: { event: smiles, product: "CCO" },
      steps: [{ from: "event", to: "product" }],
    },
  ]) {
    const compiled = await compileFigure(input);
    const entry = compiled.entries[compiled.reference.ref] as
      Mechanism | Reaction;
    const scene =
      entry.kind === "mechanism" ? entry.frames[0].scene : entry.scene;
    const placement = scene.molecules[0];
    const compound = compiled.entries[placement.compound] as Compound;
    assert.deepEqual(compound.variants![placement.variant!].coords, {
      a1: { x: -1.155, y: -0.244 },
      a2: { x: -0.289, y: 0.256 },
      a3: { x: 0.577, y: -0.244 },
      a4: { x: 0.289, y: -0.922 },
      a5: { x: 1.155, y: 0.578 },
      a6: { x: 0.577, y: 0.922 },
    });
  }
});

test("polar fragment contacts retain the source donor and carbonyl direction", async () => {
  const compiled = await compileFigure({
    kind: "gallery",
    compounds: {
      event: {
        smiles: "N#[C-:1].C[C:2](=[O:3])C",
        arrows: [
          { from: "lp(1)", to: "atom(2)" },
          { from: "pi(2,3)", to: "atom(3)" },
        ],
      },
    },
  });
  const scene = (compiled.entries[compiled.reference.ref] as Mechanism)
    .frames[0].scene;
  const placement = scene.molecules[0],
    compound = compiled.entries[placement.compound] as Compound;
  const coords = compound.variants![placement.variant!].coords;
  const [attack, open] = scene.arrows!;
  const from = attack.from;
  assert.equal(from.kind, "lonePair");
  assert.equal(attack.to.kind, "atom");
  assert.equal(open.to.kind, "atom");
  const donor = coords[scene.labels!.find((l) => l.id === from.label)!.at.atom],
    carbon = coords[attack.to.at.atom],
    oxygen = coords[open.to.at.atom];
  assert.ok(carbon.x > donor.x);
  assert.ok(oxygen.x > carbon.x);
  assert.ok(Math.abs(oxygen.y - carbon.y) < 0.001);
});

test("fragment depiction retains a linear charged electrophile", async () => {
  const compiled = await compileFigure({
    kind: "gallery",
    compounds: {
      event: {
        smiles: "[CH2:1]=[CH2:2].[O:5]=[N+:3]=[O:4]",
        arrows: [
          { from: "pi(1,2)", to: "atom(3)" },
          { from: "pi(3,4)", to: "atom(4)" },
        ],
      },
    },
  });
  const scene = (compiled.entries[compiled.reference.ref] as Mechanism)
    .frames[0].scene;
  const placement = scene.molecules[0],
    compound = compiled.entries[placement.compound] as Compound;
  const coords = compound.variants![placement.variant!].coords;
  const [a, n, b] = [coords.a3, coords.a4, coords.a5];
  const u = { x: a.x - n.x, y: a.y - n.y },
    v = { x: b.x - n.x, y: b.y - n.y };
  assert.ok(
    Math.abs(
      (u.x * v.x + u.y * v.y) / Math.hypot(u.x, u.y) / Math.hypot(v.x, v.y) + 1,
    ) < 0.001,
  );
});

test("sequential electron frames inherit the reacting chain direction", async () => {
  const compiled = await compileFigure({
    kind: "mechanism",
    frames: [
      {
        id: "first",
        smiles: "[Br:1][CH2:2]CCCC=C.[Sn:8](CCCC)(CCCC)CCCC |^1:7|",
        arrows: [
          { from: "radical(8)", to: "atom(1)", electrons: 1 },
          { from: "bond(1,2)", to: "atom(8)", electrons: 1 },
          { from: "bond(1,2)", to: "atom(2)", electrons: 1 },
        ],
      },
      {
        id: "second",
        smiles: "[CH2:1]CCC[CH:5]=[CH2:6]",
        arrows: [
          { from: "radical(1)", to: "atom(5)" },
          { from: "pi(5,6)", to: "atom(1)", electrons: 1 },
          { from: "pi(5,6)", to: "atom(6)", electrons: 1 },
        ],
      },
    ],
  });
  const frame = (compiled.entries[compiled.reference.ref] as Mechanism)
    .frames[1];
  const placement = frame.scene.molecules[0],
    compound = compiled.entries[placement.compound] as Compound;
  const coords = compound.variants![placement.variant!].coords;
  assert.ok(coords.a1.x > coords.a6.x);
});

test("inter-frame arrows center on the complete reacting fragments", async () => {
  const compiled = await compileFigure({
    kind: "mechanism",
    frames: [
      {
        id: "first",
        smiles: "[O-:1].[CH2:2]=[O:3]",
        arrows: [{ from: "lp(1)", to: "atom(2)" }],
      },
      { id: "second", smiles: "OCCO" },
    ],
  });
  const scene = (compiled.entries[compiled.reference.ref] as Mechanism)
    .frames[0].scene;
  const placement = scene.molecules[0],
    compound = compiled.entries[placement.compound] as Compound;
  const coords = Object.values(compound.variants![placement.variant!].coords);
  const center =
    placement.at.y +
    (Math.min(...coords.map((p) => p.y)) +
      Math.max(...coords.map((p) => p.y))) /
      2;
  assert.ok(Math.abs(scene.reactionArrows![0].from.y - center) < 0.001);
  assert.equal(scene.reactionArrows![0].from.y, scene.reactionArrows![0].to.y);
});

test("condensed reacting groups retain the source orientation across frames", async () => {
  const compiled = await compileFigure({
    kind: "mechanism",
    frames: [
      {
        id: "first",
        smiles: "CC(C)([O-:3])C#N.[H:4][O+:5]([H])[H]",
        arrows: [
          { from: "lp(3)", to: "atom(4)" },
          { from: "bond(4,5)", to: "atom(5)" },
        ],
      },
      { id: "second", smiles: "CC(C)(O)C#N" },
    ],
  });
  const frames = (compiled.entries[compiled.reference.ref] as Mechanism).frames;
  for (const frame of frames) {
    const placement = frame.scene.molecules[0],
      compound = compiled.entries[placement.compound] as Compound;
    const coords = compound.variants![placement.variant!].coords;
    assert.ok(Math.abs(coords.a5.x - coords.a2.x) < 0.001);
    assert.ok(coords.a5.y < coords.a2.y);
    assert.ok(coords.a4.x > coords.a2.x);
    assert.ok(Math.abs(coords.a4.y - coords.a2.y) < 0.001);
  }
});

test("step enclosures override structure defaults and empty selections clear one step", async () => {
  const compiled = await compileFigure({
    kind: "route",
    compounds: {
      a: "CCO",
      b: { smiles: "[CH3:1][CH:2]=[O:3]", enclose: [{ atoms: [3] }] },
      c: "CC(=O)O",
    },
    steps: [
      { from: "a", to: "b", enclose: { b: [] } },
      { from: "b", to: "c" },
    ],
  });
  const route = compiled.entries[compiled.reference.ref] as Route;
  const first = compiled.entries[route.steps[0].reaction] as Reaction;
  const second = compiled.entries[route.steps[1].reaction] as Reaction;
  assert.equal(first.scene.enclose, undefined);
  assert.deepEqual(second.scene.enclose?.[0].atoms, [
    { molecule: second.reactants[0].id, atom: "a3" },
  ]);
  assert.deepEqual(compiled.warnings, []);
});

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

test("reaction sources preserve equivalents, mixture fractions, tags and reagent position", async () => {
  const input = {
    compounds: { a: "CCO", b: "CC=O", c: "CC(=O)O" },
    steps: [
      {
        title: "First step",
        sources: [
          { source: "unknown", locator: "step source", note: "Fixture" },
        ],
        from: [{ id: "a", equivalents: 2 }],
        to: [
          { id: "b", fraction: 0.45 },
          { id: "c", fraction: 0.55 },
        ],
        tags: ["Oxidation"],
        reagentPosition: "below-arrow",
        above: "[O]",
      },
    ],
  };
  const result = await compileFigure(input);
  const reaction = result.entries[result.reference.ref] as Reaction;
  assert.equal(reaction.reactants[0].equivalents, 2);
  assert.deepEqual(
    reaction.products.map((p) => p.fraction),
    [0.45, 0.55],
  );
  assert.deepEqual(reaction.tags, ["Oxidation"]);
  assert.equal(reaction.reagentPosition, "below-arrow");
  assert.equal(reaction.title, "First step");
  assert.deepEqual(reaction.sources, input.steps[0].sources);
  assert.deepEqual(
    (await compileFigure(input, result.entries)).entries,
    result.entries,
  );
});

test("YAML boundary rejects unsupported kinds and style fields, validates deferred references", async () => {
  const input = {
    kind: "route",
    compounds: { a: "CCO", b: "CC=O" },
    steps: [{ from: "a", to: "b" }],
  };
  for (const field of ["bond", "width", "charges", "dots", "ring_h"])
    assert.throws(
      () => validateFigureInput({ ...input, [field]: 1 }),
      new RegExp(field),
    );
  for (const kind of ["table"])
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
  assert.deepEqual(r.warnings, []);
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
    id = stdout.trim().split("\n").at(-1)!;
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
  assert.equal(
    (await run(process.execPath, args)).stdout.trim().split("\n").at(-1),
    id,
  );
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
    ).stdout
      .trim()
      .split("\n")
      .at(-1),
    id,
  );
});

test("compiled linear routes draw their connected intermediates once", async () => {
  const { prepareFigure } = await import("../src/ui/library/prepare.ts");
  const { loadFigureFonts } = await import("../scripts/figure-fonts.ts");
  const { figureStyle } = await import("./fixtures/figures/style.ts");
  const { walkGeometry } = await import("../src/ui/library/geometry-walk.ts");
  const compiled = await compileFigure(await fixture("linear"));
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit: await moleculeToolkit(),
    fonts: await loadFigureFonts(),
    style: figureStyle,
  });
  const instances: string[] = [];
  walkGeometry(geometry.root, (node) => {
    if (node.attributes["data-compound"])
      instances.push(node.attributes["data-compound"]);
  });
  assert.equal(instances.length, 4);
});

test("shared intermediates draw their electron annotations once", async () => {
  const { prepareFigure } = await import("../src/ui/library/prepare.ts"),
    { loadFigureFonts } = await import("../scripts/figure-fonts.ts"),
    { figureStyle } = await import("./fixtures/figures/style.ts"),
    { walkGeometry } = await import("../src/ui/library/geometry-walk.ts");
  const compiled = await compileFigure({
    compounds: {
      a: "CC(O)C",
      b: {
        smiles: "C[C:1](=[O:2])C",
        arrows: [{ id: "push", from: "pi(1,2)", to: "atom(2)" }],
        enclose: [{ id: "oxygen", atoms: [2] }],
      },
      c: "CC(O)C",
    },
    steps: [
      { from: "a", to: "b" },
      { from: "b", to: "c" },
    ],
  });
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit: await moleculeToolkit(),
    fonts: await loadFigureFonts(),
    style: figureStyle,
  });
  let count = 0,
    enclosures = 0;
  walkGeometry(geometry.root, (n) => {
    if (n.attributes["data-electron-arrow"]) count++;
    if (n.attributes["data-enclose"]) enclosures++;
  });
  assert.equal(count, 1);
  assert.equal(enclosures, 1);
});

test("route depiction propagates from its largest anchor independently of compound declaration order", async () => {
  const compounds = {
    a: "CCOc1ccc(CO)cc1",
    b: "CCOc1ccc(C=O)cc1",
    c: "CCOc1ccc(C(=O)OCCCCCCCC)cc1",
  };
  const steps = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
  ];
  const forward = await compileFigure({ compounds, steps });
  const reverse = await compileFigure({
    compounds: Object.fromEntries(Object.entries(compounds).reverse()),
    steps,
  });
  const layouts = (result: typeof forward) => {
    const route = result.entries[result.reference.ref] as Route;
    return route.steps.flatMap((s) => {
      const reaction = result.entries[s.reaction] as Reaction;
      return reaction.scene.molecules.map((p) => {
        const c = result.entries[p.compound] as Compound;
        return p.variant ? c.variants![p.variant].coords : c.layout.coords;
      });
    });
  };
  assert.deepEqual(layouts(forward), layouts(reverse));
});

test("figure abbreviations follow defaults, optional groups and arrow-visible atoms", async () => {
  const toolkit = await moleculeToolkit();
  const input = {
    compounds: { a: "CCNC(=O)OC(C)(C)C", b: "CCC(=O)OC(C)(C)C" },
    steps: [{ from: "a", to: "b" }],
  };
  const compiled = await compileFigure(input);
  const reaction = compiled.entries[compiled.reference.ref] as Reaction;
  const active = (
    result: typeof compiled,
    placement: Reaction["scene"]["molecules"][number],
  ) => {
    const compound = result.entries[placement.compound] as Compound;
    const layout = placement.variant
      ? compound.variants![placement.variant]
      : compound.layout;
    return compoundAbbreviations(toolkit, compound, layout).map((g) => g.name);
  };
  assert.deepEqual(active(compiled, reaction.scene.molecules[0]), ["NHBoc"]);
  const off = await compileFigure({
    ...input,
    compounds: {
      ...input.compounds,
      a: { smiles: input.compounds.a, abbreviate: false },
    },
  });
  assert.deepEqual(
    active(
      off,
      (off.entries[off.reference.ref] as Reaction).scene.molecules[0],
    ),
    [],
  );
  const optional = await compileFigure({
    abbreviate: ["Ph"],
    compounds: { a: "CCc1ccccc1", b: "CCOc1ccccc1" },
    steps: input.steps,
  });
  assert.ok(
    active(
      optional,
      (optional.entries[optional.reference.ref] as Reaction).scene.molecules[0],
    )!.includes("Ph"),
  );
  const arrows = await compileFigure({
    compounds: {
      a: {
        smiles: "[CH3:1][NH:2][C:3](=[O:4])OC(C)(C)C",
        arrows: [{ from: "pi(3,4)", to: "atom(4)" }],
      },
      b: input.compounds.b,
    },
    steps: input.steps,
  });
  assert.deepEqual(
    active(
      arrows,
      (arrows.entries[arrows.reference.ref] as Reaction).scene.molecules[0],
    ),
    [],
  );
});

test("conditions retain reagent order and chemical digit typography", async () => {
  const { figureTextRuns } = await import("../src/ui/library/text-runs.ts");
  const { loadFigureFonts } = await import("../scripts/figure-fonts.ts");
  const { prepareFigure } = await import("../src/ui/library/prepare.ts");
  const { walkGeometry } = await import("../src/ui/library/geometry-walk.ts");
  const { figureStyle } = await import("./fixtures/figures/style.ts");
  const fonts = await loadFigureFonts();
  const runs = figureTextRuns("NaClO2 Pd(PPh3)4 H2O 25 °C C\\11", 20, fonts);
  assert.deepEqual(
    runs.filter((r) => r.size < 20).map((r) => r.text),
    ["2", "3", "4", "2"],
  );
  assert.equal(
    runs.map((r) => r.text).join(""),
    "NaClO2 Pd(PPh3)4 H2O 25 °C C11",
  );
  const compiled = await compileFigure({
    compounds: { a: "CCO", b: "CC=O", reagent: { text: "PhB(OH)2" } },
    steps: [{ from: ["a", "reagent"], to: "b", above: "Pd(PPh3)4, K2CO3" }],
  });
  assert.deepEqual(
    (compiled.entries[compiled.reference.ref] as Reaction).reagents,
    ["PhB(OH)2", "Pd(PPh3)4, K2CO3"],
  );
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit: await moleculeToolkit(),
    fonts,
    style: figureStyle,
  });
  const conditions: { text: string; y: number }[] = [];
  walkGeometry(geometry.root, (n) => {
    if (
      n.kind === "text" &&
      n.attributes["data-label"]?.includes(":condition:-1:")
    )
      conditions.push({ text: n.text, y: n.position.y });
  });
  conditions.sort((a, b) => a.y - b.y);
  assert.deepEqual(
    conditions.map((n) => n.text),
    ["PhB(OH)2", "Pd(PPh3)4, K2CO3"],
  );
});

test("recompilation preserves bound compound and participant identities", async () => {
  const input = await fixture("linear");
  const first = await compileFigure(input, {}, "saved");
  const route = first.entries[first.reference.ref] as Route;
  for (const step of route.steps) {
    const reaction = first.entries[step.reaction] as Reaction;
    for (const [role, participants] of [
      ["input", reaction.reactants],
      ["output", reaction.products],
    ] as const) {
      for (const [i, participant] of participants.entries()) {
        reaction.scene.molecules.find((m) => m.id === participant.id)!.id =
          `${role}${i + 1}`;
        participant.id = `${role}${i + 1}`;
      }
    }
  }
  for (const edge of route.edges) {
    edge.product = "output1";
    edge.reactant = "input1";
  }
  const compound = Object.values(first.entries).find(
    (entry): entry is Compound => entry.kind === "compound",
  )!;
  const duplicate = { ...structuredClone(compound), id: "cmp_duplicate" };
  const entries = { [duplicate.id]: duplicate, ...first.entries };
  const second = await compileFigure(input, entries, "saved");
  const saved = second.entries[route.id] as Route;
  assert.deepEqual(
    saved.steps.map((s) => [s.id, s.reaction]),
    route.steps.map((s) => [s.id, s.reaction]),
  );
  for (const step of saved.steps) {
    const reaction = second.entries[step.reaction] as Reaction;
    assert.equal(reaction.reactants[0].id, "input1");
    assert.equal(reaction.products[0].id, "output1");
    assert.equal(
      reaction.reactants[0].compound,
      (first.entries[step.reaction] as Reaction).reactants[0].compound,
    );
    assert.ok(reaction.reactants[0].compound !== duplicate.id);
    assert.ok(step.display!.input1);
  }
  assert.deepEqual(
    (await compileFigure(input, second.entries, "saved")).entries,
    second.entries,
  );
  const singleInput = { ...input, steps: input.steps.slice(0, 1) };
  const single = await compileFigure(singleInput, second.entries, "saved");
  assert.equal(single.reference.ref, route.id);
  assert.equal(single.entries[route.id].kind, "route");
  assert.equal((single.entries[route.id] as Route).steps.length, 1);
});

test("compiled reactions include boxed structures, placement brackets and styled footnotes", async () => {
  const { prepareFigure } = await import("../src/ui/library/prepare.ts");
  const { loadFigureFonts } = await import("../scripts/figure-fonts.ts");
  const { figureStyle } = await import("./fixtures/figures/style.ts");
  const { walkGeometry } = await import("../src/ui/library/geometry-walk.ts");
  const input = {
    compounds: { a: { smiles: "CCO", bracket: "ts" }, b: "CC=O", c: "CBr" },
    steps: [
      {
        from: ["a", "c"],
        to: "b",
        others: "box",
        above: "n-BuLi",
        below: "cis-isomer",
      },
    ],
    footnote: "^{a} t-BuOH, n-Hexane, 20 °C",
  };
  const compiled = await compileFigure(input),
    reaction = compiled.entries[compiled.reference.ref] as Reaction;
  assert.equal(reaction.scene.molecules[0].bracket, "ts");
  assert.equal(reaction.footnote, input.footnote);
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit: await moleculeToolkit(),
    fonts: await loadFigureFonts(),
    style: figureStyle,
  });
  let brackets = 0,
    boxes = 0;
  const italic: string[] = [];
  walkGeometry(geometry.root, (node) => {
    brackets += Number(node.attributes["data-bracket"] !== undefined);
    boxes += Number(node.attributes["data-overhead-box"] !== undefined);
    if (node.kind === "text")
      italic.push(...node.runs.filter((r) => r.italic).map((r) => r.text));
  });
  assert.equal(brackets, 1);
  assert.equal(boxes, 1);
  for (const prefix of ["n-", "t-", "cis-"])
    assert.ok(italic.includes(prefix), prefix);
  const vertical = await compileFigure({
    ...input,
    steps: [{ ...input.steps[0], turn: "down" }],
  });
  const verticalReaction = vertical.entries[vertical.reference.ref] as Reaction;
  assert.equal(verticalReaction.arrow.from.x, verticalReaction.arrow.to.x);
  const drawing = await prepareFigure(vertical.entries, vertical.reference, {
    toolkit: await moleculeToolkit(),
    fonts: await loadFigureFonts(),
    style: figureStyle,
  });
  const shafts: string[] = [];
  walkGeometry(drawing.root, (node) => {
    if (node.kind === "path" && node.attributes["data-reaction-arrow"])
      shafts.push(node.attributes["data-curve-points"]);
  });
  assert.equal(shafts.length, 1);
  const points: { x: number; y: number }[] = JSON.parse(shafts[0]);
  assert.ok(points.every((p) => Math.abs(p.x - points[0].x) < 0.01));
});

test("contracted CoordGen layouts retain the shared bond length", async () => {
  const result = await compileFigure({
    compounds: {
      a: { smiles: "N#CC1CCCCCCCCCCC1", coordgen: true },
      b: "N#CC1CCCCCCCCCCC1",
    },
    steps: [{ from: "a", to: "b" }],
  });
  const reaction = result.entries[result.reference.ref] as Reaction;
  const placement = reaction.scene.molecules[0];
  const c = result.entries[placement.compound] as Compound;
  const layout = c.variants![placement.variant!];
  const mol = (await moleculeToolkit()).get_mol(c.smiles)!;
  try {
    const bonds: { atoms: [number, number] }[] = JSON.parse(mol.get_json())
      .molecules[0].bonds;
    const lengths = bonds
      .map(({ atoms: [a, b] }) => {
        const p = layout.coords[c.atomIds[a]],
          q = layout.coords[c.atomIds[b]];
        return Math.hypot(p.x - q.x, p.y - q.y);
      })
      .sort((a, b) => a - b);
    assert.ok(Math.abs(lengths[Math.floor(lengths.length / 2)] - 1) < 0.05);
  } finally {
    mol.delete();
  }
});

test("electron endpoints retain root abbreviations and expand only targeted interiors", async () => {
  const { abbreviatedGroups } =
    await import("../shared/molecule-abbreviations.ts");
  const toolkit = await moleculeToolkit();
  for (const [smiles, arrows, expected] of [
    [
      "C[CH:1]([O:2]S(=O)(=O)c1ccc(C)cc1)N(C(=O)C)[CH:3]=[CH:4]C(=O)OC",
      [
        { from: "bond(1,2)", to: "atom(2)" },
        { from: "pi(3,4)", to: "bond(3,4)" },
      ],
      ["Ac", "CO₂Me", "OTs"],
    ],
    ["CC(=O)NCCNC(=[O:2])C", [{ from: "lp(2)", to: "atom(2)" }], ["Ac"]],
  ] as const) {
    const result = await compileFigure({
      compounds: { a: { smiles, arrows: [...arrows] }, b: "CCO" },
      steps: [{ from: "a", to: "b" }],
    });
    const reaction = result.entries[result.reference.ref] as Reaction,
      p = reaction.scene.molecules[0],
      c = result.entries[p.compound] as Compound,
      layout = c.variants![p.variant!],
      mol = toolkit.get_mol(c.smiles)!;
    try {
      const groups = abbreviatedGroups(
        toolkit,
        mol,
        layout.abbreviations,
      ).filter(
        (g) =>
          !layout.abbreviationAtoms ||
          layout.abbreviationAtoms.includes(c.atomIds[g.atoms[0]]),
      );
      assert.deepEqual(groups.map((g) => g.name).sort(), [...expected].sort());
    } finally {
      mol.delete();
    }
  }
});

test("a shared substituent keeps its direction when a ring bond is reduced", async () => {
  const result = await compileFigure({
    coordgen: true,
    anchor: "a",
    compounds: {
      a: "COC(=O)C1=CC[C@]2([H])CCN(C(C)=O)[C@@]12[H]",
      b: "COC(=O)[C@]1([H])CC[C@]2([H])CCN(C(C)=O)[C@@]12[H]",
    },
    steps: [{ from: "a", to: "b" }],
  });
  const toolkit = await moleculeToolkit(),
    reaction = result.entries[result.reference.ref] as Reaction,
    query = toolkit.get_qmol("*C(=O)OC")!;
  try {
    const vectors = reaction.scene.molecules.map((p) => {
      const c = result.entries[p.compound] as Compound,
        layout = c.variants![p.variant!],
        mol = toolkit.get_mol(c.smiles)!;
      try {
        const ids: number[] = JSON.parse(mol.get_substruct_match(query)).atoms,
          a = layout.coords[c.atomIds[ids[0]]],
          b = layout.coords[c.atomIds[ids[1]]];
        return { x: b.x - a.x, y: b.y - a.y };
      } finally {
        mol.delete();
      }
    });
    const [a, b] = vectors;
    assert.ok(
      (a.x * b.x + a.y * b.y) / Math.hypot(a.x, a.y) / Math.hypot(b.x, b.y) >
        0.95,
    );
  } finally {
    query.delete();
  }
});

test("CXSMILES repeat units retain their brackets and multiplier", async () => {
  const { prepareFigure } = await import("../src/ui/library/prepare.ts"),
    { loadFigureFonts } = await import("../scripts/figure-fonts.ts"),
    { figureStyle } = await import("./fixtures/figures/style.ts"),
    { walkGeometry } = await import("../src/ui/library/geometry-walk.ts");
  const result = await compileFigure({
    compounds: { a: "CCCOCC |Sg:n:2:n:ht|", b: "CCCOC=O |Sg:n:2:n:ht|" },
    steps: [{ from: "a", to: "b" }],
  });
  const geometry = await prepareFigure(result.entries, result.reference, {
    toolkit: await moleculeToolkit(),
    fonts: await loadFigureFonts(),
    style: figureStyle,
  });
  let brackets = 0,
    multipliers = 0;
  walkGeometry(geometry.root, (n) => {
    if (n.attributes["data-repeat-bracket"]) brackets++;
    if (
      n.kind === "text" &&
      n.attributes["data-label"]?.includes(":repeat:") &&
      n.text === "n"
    )
      multipliers++;
  });
  assert.equal(brackets, 4);
  assert.equal(multipliers, 2);
});

test("an authored structure scale enlarges saved bond geometry", async () => {
  const result = await compileFigure({
    compounds: { a: { smiles: "CCO", scale: 1.45 }, b: "CC=O" },
    steps: [{ from: "a", to: "b" }],
  });
  const reaction = result.entries[result.reference.ref] as Reaction,
    p = reaction.scene.molecules[0],
    c = result.entries[p.compound] as Compound,
    coords = c.variants![p.variant!].coords;
  const a = coords[c.atomIds[0]],
    b = coords[c.atomIds[1]];
  assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 1.45) < 0.005);
});

test("positive authored rotation turns counterclockwise and propagates from the anchor", async () => {
  const { prepareFigure } = await import("../src/ui/library/prepare.ts"),
    { loadFigureFonts } = await import("../scripts/figure-fonts.ts"),
    { figureStyle } = await import("./fixtures/figures/style.ts");
  const input = {
    anchor: "a",
    compounds: { a: { smiles: "CC(O)C=O" }, b: "CC(O)C=O" },
    steps: [{ from: "a", to: "b" }],
  };
  const fonts = await loadFigureFonts(),
    toolkit = await moleculeToolkit();
  const vector = async (
    result: Awaited<ReturnType<typeof compileFigure>>,
    role: "reactants" | "products",
  ) => {
    const r = result.entries[result.reference.ref] as Reaction,
      p = r[role][0],
      c = result.entries[p.compound] as Compound;
    const g = await prepareFigure(result.entries, result.reference, {
      toolkit,
      fonts,
      style: figureStyle,
    });
    const a = g.atomPoints[p.id + ":" + c.atomIds[0]],
      b = g.atomPoints[p.id + ":" + c.atomIds[2]];
    return { x: b.x - a.x, y: b.y - a.y };
  };
  const base = await compileFigure(input),
    rotated = await compileFigure({
      ...input,
      compounds: { ...input.compounds, a: { ...input.compounds.a, rot: 90 } },
    });
  const original = await vector(base, "reactants"),
    actual = await vector(rotated, "reactants"),
    inherited = await vector(rotated, "products");
  assert.ok(Math.abs(actual.x - original.y) < 0.2);
  assert.ok(Math.abs(actual.y + original.x) < 0.2);
  assert.ok(Math.abs(inherited.x - actual.x) < 0.2);
  assert.ok(Math.abs(inherited.y - actual.y) < 0.2);
});

test("authored atom maps render as native atom numbers", async () => {
  const { prepareFigure } = await import("../src/ui/library/prepare.ts"),
    { loadFigureFonts } = await import("../scripts/figure-fonts.ts"),
    { figureStyle } = await import("./fixtures/figures/style.ts"),
    { walkGeometry } = await import("../src/ui/library/geometry-walk.ts");
  const result = await compileFigure({
    compounds: {
      a: { smiles: "[CH3:7][CH:14]([OH:21])C=O", numbers: true },
      b: "CC(O)C=O",
    },
    steps: [{ from: "a", to: "b" }],
  });
  const g = await prepareFigure(result.entries, result.reference, {
    toolkit: await moleculeToolkit(),
    fonts: await loadFigureFonts(),
    style: figureStyle,
  });
  const numbers: number[] = [];
  walkGeometry(g.root, (n) => {
    if (n.attributes["data-atom-number"]) {
      assert.ok(n.kind === "group" && n.children.length > 0);
      assert.ok(n.bounds && n.bounds.width > 0 && n.bounds.height > 0);
      numbers.push(Number(n.attributes["data-atom-number"]));
    }
  });
  assert.deepEqual(
    numbers.sort((a, b) => a - b),
    [7, 14, 21],
  );
});

test("new depictions place charge markers for their new bond directions", async () => {
  const { prepareFigure } = await import("../src/ui/library/prepare.ts"),
    { loadFigureFonts } = await import("../scripts/figure-fonts.ts"),
    { figureStyle } = await import("./fixtures/figures/style.ts"),
    { figureGeometryDiagnostics } =
      await import("../src/ui/library/geometry-diagnostics.ts");
  const input = {
    title: "Charged transformation",
    compounds: { a: "COC(=O)c1cccnc1", b: "COC(=O)c1ccc[n+](C)c1" },
    steps: [{ from: "a", to: "b" }],
  };
  const first = await compileFigure(input);
  const rd = await moleculeToolkit();
  for (const c of Object.values(first.entries)) {
    if (c.kind !== "compound") continue;
    const mol = rd.get_mol(c.smiles)!;
    const data = JSON.parse(mol.get_json()).molecules[0];
    mol.delete();
    const index = data.atoms.findIndex((a: { chg?: number }) => a.chg === 1);
    if (index < 0) continue;
    for (const layout of [c.layout, ...Object.values(c.variants ?? {})]) {
      layout.chargeAngles = { [c.atomIds[index]]: 0 };
    }
  }
  const next = await compileFigure(input, first.entries);
  const geometry = await prepareFigure(next.entries, next.reference, {
    toolkit: rd,
    fonts: await loadFigureFonts(),
    style: figureStyle,
  });
  assert.ok(
    !figureGeometryDiagnostics(geometry, figureStyle).some(
      (d) =>
        d.code === "BOND_LABEL_OVERLAP" &&
        d.elements.some((e) => e.endsWith(":charge")),
    ),
  );
});

test("grouped scope and gallery YAML save reusable structures with ordered labels", async () => {
  const input = {
    kind: "scope",
    compounds: {
      a: { smiles: "CCO", yield: "80%", note: "1 h" },
      b: { smiles: "CCCO", label: "**B**", yield: "72%" },
      c: "CC(C)O",
    },
    groups: [
      { title: "First group", items: ["b", "a"] },
      { subtitle: "Second group", items: ["c"] },
    ],
  };
  const result = await compileFigure(input, {}, "scope");
  const entry = result.entries[result.reference.ref] as Mechanism;
  const scene = entry.frames[0].scene;
  assert.equal(entry.category, "examples");
  assert.deepEqual(
    scene.molecules.map((m) => m.id),
    ["b", "a", "c"],
  );
  assert.ok(scene.captions?.some((c) => c.text === "80%"));
  assert.ok(scene.captions?.some((c) => c.text === "1 h"));
  assert.ok(scene.molecules[2].at.y > scene.molecules[0].at.y);
  assert.deepEqual(
    (await compileFigure(input, result.entries, "scope")).entries,
    result.entries,
  );
  const gallery = await compileFigure({
    kind: "gallery",
    cols: 2,
    compounds: input.compounds,
  });
  const grid = (gallery.entries[gallery.reference.ref] as Mechanism).frames[0]
    .scene;
  assert.ok(grid.molecules[2].at.y > grid.molecules[0].at.y);
  assert.throws(
    () => validateFigureInput({ ...input, groups: [{ items: ["missing"] }] }),
    /unknown compound/,
  );
});

test("cycle YAML saves clockwise closed steps with incoming and outgoing branches", async () => {
  const input = {
    kind: "cycle",
    nodes: ["A", { smiles: "CCO", label: "B" }, "C", "D"],
    steps: [
      { in: "X", out: "Y", label: "Exchange" },
      {},
      { out: "Z" },
      { in: "W" },
    ],
  };
  const result = await compileFigure(input, {}, "cycle");
  const scene = (result.entries[result.reference.ref] as Mechanism).frames[0]
    .scene;
  const arrows = scene.reactionArrows!;
  assert.deepEqual(
    arrows.filter((a) => a.id.startsWith("step-")).map((a) => a.id),
    ["step-1", "step-2", "step-3", "step-4"],
  );
  assert.deepEqual(
    arrows.filter((a) => /^(in|out)-/.test(a.id)).map((a) => a.id),
    ["in-1", "out-1", "out-3", "in-4"],
  );
  assert.ok(arrows.every((a) => a.controls?.length === 2));
  assert.ok(
    arrows.find((a) => a.id === "step-1")!.to.x >
      arrows.find((a) => a.id === "step-1")!.from.x,
  );
  assert.ok(
    arrows.find((a) => a.id === "step-4")!.to.y <
      arrows.find((a) => a.id === "step-4")!.from.y,
  );
  assert.equal(scene.molecules[0].id, "2");
  assert.deepEqual(
    (await compileFigure(input, result.entries, "cycle")).entries,
    result.entries,
  );
  assert.throws(
    () => validateFigureInput({ ...input, steps: [{}] }),
    /one step per species/,
  );
});

test("gallery line spacing includes superscripts and subscripts in adjacent captions", async () => {
  const result = await compileFigure({
    kind: "gallery",
    compounds: {
      a: { smiles: "CCO", yield: "46% yield^b,e", note: "**Me3N**\n1 h" },
    },
  });
  const { prepareFigure } = await import("../src/ui/library/prepare.ts");
  const { loadFigureStyle } = await import("../scripts/figure-route.ts");
  const { loadFigureFonts } = await import("../scripts/figure-fonts.ts");
  const { diagnoseFigure } = await import("../scripts/figure-diagnostics.ts");
  const style = await loadFigureStyle();
  const geometry = await prepareFigure(result.entries, result.reference, {
    toolkit: await moleculeToolkit(),
    fonts: await loadFigureFonts(),
    style,
  });
  assert.deepEqual(diagnoseFigure(geometry, style), []);
});
