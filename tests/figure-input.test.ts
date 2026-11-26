import { drawnArrows } from "../shared/chemical-library/figure-layout.ts";
import { validateFigureInstance } from "../shared/chemical-library/contract.ts";
import { arrowAt, drawingPanels, figureEntry } from "./helpers/figure-graph.ts";
import { appearances } from "../shared/chemical-library/figure-layout.ts";
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
import { finishFigureEntry } from "../scripts/figure-output.ts";
import { validateFigureInput } from "../scripts/figure-input.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  prepareCompound,
  drawingMolecule,
  placedCoordinates,
  graphSignature,
  compoundAbbreviations,
  compoundView,
} from "../shared/chemical-library/chemistry.ts";
import { figureRouteMetrics } from "../shared/chemical-library/routes.ts";
import type { Compound } from "../shared/chemical-library/types.ts";
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
      kind: "scheme",
      forming: true,
      states: {
        addition: {
          arrows: [{ from: "lp(1)", to: "between(1,2)", forming }],
          compounds: { structure: { smiles: "[O-:1].[CH2:2]=[O:3]" } },
        },
      },
      arrows: {},
      views: { addition: { items: ["addition"] } },
    });
    const scene = drawingPanels(compiled.entries[compiled.reference.ref])[0]
      .scene;
    assert.equal(scene.partialBonds?.length ?? 0, forming ? 1 : 0);
    assert.deepEqual(compiled.warnings, []);
  }
});

test("collection cells retain their selected forming bonds", async () => {
  const compiled = await compileFigure({
    kind: "scheme",
    states: {
      event: {
        compounds: {
          event: {
            smiles: "[O-:1].[CH2:2]=[O:3]",
            arrows: [{ from: "lp(1)", to: "between(1,2)", forming: true }],
          },
        },
      },
    },
    arrows: {},
  });
  const scene = drawingPanels(compiled.entries[compiled.reference.ref])[0]
    .scene;
  assert.equal(scene.partialBonds?.length, 1);
  assert.deepEqual(
    scene.partialBonds![0].atoms,
    scene.arrows![0].to.kind === "formingBond" ? scene.arrows![0].to.atoms : [],
  );
});

test("collection electron events align their reacting fragments", async () => {
  const compiled = await compileFigure({
    kind: "scheme",
    states: {
      event: {
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
      },
    },
    arrows: {},
  });
  const scene = drawingPanels(compiled.entries[compiled.reference.ref])[0]
    .scene;
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
    kind: "scheme",
    changes: "off",
    states: {
      event: {
        compounds: {
          structure: {
            label: "event",
            smiles: "[CH2:1]=[C:2](OC)[CH:5]=[CH2:6].[CH2:7]=[CH:8]C#N",
            arrows: [
              { from: "pi(1,2)", to: "between(1,7)" },
              { from: "pi(5,6)", to: "bond(2,5)" },
              { from: "pi(7,8)", to: "between(8,6)" },
            ],
          },
        },
      },
      product: {
        compounds: { structure: { label: "product", smiles: "CCO" } },
      },
      final: { compounds: { structure: { label: "final", smiles: "CC=O" } } },
    },
    arrows: {
      "1": {
        from: [{ state: "event", id: "event" }],
        to: [{ state: "product", id: "product-product" }],
        kind: "forward",
        role: "reaction",
      },
      "2": {
        from: [{ state: "product", id: "product" }],
        to: [{ state: "final", id: "product-final" }],
        kind: "forward",
        role: "reaction",
      },
    },
  });
  const route = figureEntry(compiled.entries[compiled.reference.ref]);
  const scene = arrowAt(route, 0).drawing.scene;
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
    kind: "scheme",
    states: {
      event: {
        arrows: [
          { from: "charge(5)", to: "atom(1)" },
          { from: "bond(1,2)", to: "bond(2,3)" },
          { from: "pi(3,4)", to: "atom(4)" },
        ],
        compounds: {
          structure: { smiles: "[2H:1][CH2:2][C:3](=[O:4])C.[OH-:5]" },
        },
      },
    },
    arrows: {},
    views: { event: { items: ["event"] } },
  });
  const placement = drawingPanels(compiled.entries[compiled.reference.ref])[0]
    .scene.molecules[0];
  const compound = compiled.entries[placement.compound] as Compound;
  const coords = compound.variants![placement.variant!].coords;
  // chemfig.depict: the free carbonyl fragment has its C=O vertical, O above C.
  assert.ok(Math.abs(coords.a4.x - coords.a3.x) < 0.001);
  assert.ok(Math.abs(coords.a4.y - coords.a3.y + 1) < 0.001);
});

test("mixed electron events straighten once after orienting their fragments", async () => {
  const compiled = await compileFigure({
    kind: "scheme",
    states: {
      event: {
        arrows: [
          { from: "radical(8)", to: "atom(1)", electrons: 1 },
          { from: "bond(1,2)", to: "atom(8)", electrons: 1 },
          { from: "bond(1,2)", to: "atom(2)", electrons: 1 },
        ],
        compounds: {
          structure: {
            smiles: "[Br:1][CH2:2]CCCC=C.[Sn:8](CCCC)(CCCC)CCCC |^1:7|",
          },
        },
      },
    },
    arrows: {},
    views: { event: { items: ["event"] } },
  });
  const placement = drawingPanels(compiled.entries[compiled.reference.ref])[0]
    .scene.molecules[0];
  const compound = compiled.entries[placement.compound] as Compound;
  const coords = compound.variants![placement.variant!].coords;
  // Mapped Br-C direction from chemfig.depict, in one-bond units with y down.
  assert.ok(Math.abs(coords.a2.x - coords.a1.x + 0.7436) < 0.002);
  assert.ok(Math.abs(coords.a2.y - coords.a1.y + 0.6685) < 0.002);
});

test("structures and reactions without electron events share their free orientation", async () => {
  const smiles = "[2H:1][CH2:2][C:3](=[O:4])C.[OH-:5]";
  let expected: Compound["layout"]["coords"] | undefined;
  for (const input of [
    {
      kind: "scheme",
      states: { event: { compounds: { structure: { smiles } } } },
      arrows: {},
      views: { event: { items: ["event"] } },
    },
    {
      kind: "scheme",
      changes: "off",
      states: {
        event: { compounds: { structure: { label: "event", smiles: smiles } } },
        product: {
          compounds: { structure: { label: "product", smiles: "CCO" } },
        },
      },
      arrows: {
        "1": {
          from: [{ state: "event", id: "event" }],
          to: [{ state: "product", id: "product-product" }],
          kind: "forward",
          role: "reaction",
        },
      },
      layout: { anchor: "event" },
    },
  ]) {
    const compiled = await compileFigure(input);
    const entry = compiled.entries[compiled.reference.ref];
    const scene = drawnArrows(figureEntry(entry).graph).length
      ? arrowAt(entry).drawing.scene
      : drawingPanels(entry)[0].scene;
    const placement = scene.molecules[0];
    const compound = compiled.entries[placement.compound] as Compound;
    const coords = compound.variants![placement.variant!].coords;
    expected ??= coords;
    assert.deepEqual(coords, expected);
  }
});

test("polar fragment contacts retain the source donor and carbonyl direction", async () => {
  const compiled = await compileFigure({
    kind: "scheme",
    states: {
      event: {
        compounds: {
          event: {
            smiles: "N#[C-:1].C[C:2](=[O:3])C",
            arrows: [
              { from: "lp(1)", to: "atom(2)" },
              { from: "pi(2,3)", to: "atom(3)" },
            ],
          },
        },
      },
    },
    arrows: {},
  });
  const scene = drawingPanels(compiled.entries[compiled.reference.ref])[0]
    .scene;
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
    kind: "scheme",
    states: {
      event: {
        compounds: {
          event: {
            smiles: "[CH2:1]=[CH2:2].[O:5]=[N+:3]=[O:4]",
            arrows: [
              { from: "pi(1,2)", to: "atom(3)" },
              { from: "pi(3,4)", to: "atom(4)" },
            ],
          },
        },
      },
    },
    arrows: {},
  });
  const scene = drawingPanels(compiled.entries[compiled.reference.ref])[0]
    .scene;
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
    kind: "scheme",
    states: {
      first: {
        arrows: [
          { from: "radical(8)", to: "atom(1)", electrons: 1 },
          { from: "bond(1,2)", to: "atom(8)", electrons: 1 },
          { from: "bond(1,2)", to: "atom(2)", electrons: 1 },
        ],
        compounds: {
          structure: {
            smiles: "[Br:1][CH2:2]CCCC=C.[Sn:8](CCCC)(CCCC)CCCC |^1:7|",
          },
        },
      },
      second: {
        arrows: [
          { from: "radical(1)", to: "atom(5)" },
          { from: "pi(5,6)", to: "atom(1)", electrons: 1 },
          { from: "pi(5,6)", to: "atom(6)", electrons: 1 },
        ],
        compounds: { structure: { smiles: "[CH2:1]CCC[CH:5]=[CH2:6]" } },
      },
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
  const frame = drawingPanels(compiled.entries[compiled.reference.ref])[1];
  const placement = frame.scene.molecules[0],
    compound = compiled.entries[placement.compound] as Compound;
  const coords = compound.variants![placement.variant!].coords;
  assert.ok(coords.a1.x > coords.a6.x);
});

test("inter-frame arrows center on the complete reacting fragments", async () => {
  const compiled = await compileFigure({
    kind: "scheme",
    states: {
      first: {
        arrows: [{ from: "lp(1)", to: "atom(2)" }],
        compounds: { structure: { smiles: "[O-:1].[CH2:2]=[O:3]" } },
      },
      second: { compounds: { structure: { smiles: "OCCO" } } },
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
  const scene = drawingPanels(compiled.entries[compiled.reference.ref])[0]
    .scene;
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
    kind: "scheme",
    states: {
      first: {
        arrows: [
          { from: "lp(3)", to: "atom(4)" },
          { from: "bond(4,5)", to: "atom(5)" },
        ],
        compounds: {
          structure: {
            smiles: "CC(C)([O-:3])C#N.[H:4][O+:5]([H])[H]",
            abbreviations: ["CN"],
          },
        },
      },
      second: {
        compounds: {
          structure: { smiles: "CC(C)(O)C#N", abbreviations: ["CN"] },
        },
      },
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
  const frames = drawingPanels(compiled.entries[compiled.reference.ref]);
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

test("ring stereocentre hydrogens participate before depicting a reacting mixture", async () => {
  const compiled = await compileFigure({
    kind: "scheme",
    coordgen: true,
    states: {
      event: {
        arrows: [{ from: "pi(1,2)", to: "atom(3)" }],
        compounds: {
          structure: {
            smiles: "C=C1CC[CH:1]=[C:2](C)CC[C@@H]2[C@H]1CC2(C)C.[H+:3]",
          },
        },
      },
    },
    arrows: {},
    views: { event: { items: ["event"] } },
  });
  const scene = drawingPanels(compiled.entries[compiled.reference.ref])[0]
    .scene;
  const placement = scene.molecules[0],
    compound = compiled.entries[placement.compound] as Compound;
  const coords = compound.variants![placement.variant!].coords;
  const from = scene.arrows![0].from;
  assert.equal(from.kind, "pi");
  const [a, b] = from.atoms.map((at) => coords[at.atom]);
  assert.ok(b.x < a.x);
  assert.ok(b.y > a.y);
});

test("electron-event routes retain the chemistry of their unannotated anchor", async () => {
  const compiled = await compileFigure({
    kind: "scheme",
    changes: "off",
    states: {
      start: {
        compounds: {
          structure: { label: "start", smiles: "CC#N", abbreviate: false },
        },
      },
      event: {
        compounds: {
          structure: {
            label: "event",
            smiles: "[O-:1].[CH2:2]=[O:3]",
            arrows: [{ from: "lp(1)", to: "atom(2)" }],
          },
        },
      },
      product: {
        compounds: { structure: { label: "product", smiles: "CC(O)C#N" } },
      },
    },
    arrows: {
      "1": {
        from: [{ state: "start", id: "start" }],
        to: [{ state: "event", id: "product-event" }],
        kind: "forward",
        role: "reaction",
      },
      "2": {
        from: [{ state: "event", id: "event" }],
        to: [{ state: "product", id: "product-product" }],
        kind: "forward",
        role: "reaction",
      },
    },
    layout: { anchor: "start" },
  });
  const route = figureEntry(compiled.entries[compiled.reference.ref]);
  const scene = arrowAt(route, 0).drawing.scene;
  const placement = scene.molecules.find((m) => m.id === "start")!,
    compound = compiled.entries[placement.compound] as Compound;
  const coords = compound.variants![placement.variant!].coords;
  const [a, n, b] = [coords.a1, coords.a2, coords.a3],
    u = { x: a.x - n.x, y: a.y - n.y },
    v = { x: b.x - n.x, y: b.y - n.y };
  assert.ok(
    Math.abs(
      (u.x * v.x + u.y * v.y) / Math.hypot(u.x, u.y) / Math.hypot(v.x, v.y) + 1,
    ) < 0.001,
  );
});

test("step enclosures override structure defaults and empty selections clear one step", async () => {
  const compiled = await compileFigure({
    kind: "scheme",
    states: {
      a: { compounds: { structure: { label: "a", smiles: "CCO" } } },
      b: {
        compounds: {
          structure: {
            label: "b",
            smiles: "[CH3:1][CH:2]=[O:3]",
            enclose: [{ atoms: [3] }],
          },
        },
      },
      c: { compounds: { structure: { label: "c", smiles: "CC(=O)O" } } },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a" }],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
        enclose: { b: [] },
      },
      "2": {
        from: [{ state: "b", id: "b" }],
        to: [{ state: "c", id: "product-c" }],
        kind: "forward",
        role: "reaction",
      },
    },
  });
  const route = figureEntry(compiled.entries[compiled.reference.ref]);
  const first = arrowAt(route, 0);
  const second = arrowAt(route, 1);
  assert.equal(first.drawing.scene.enclose, undefined);
  assert.deepEqual(second.drawing.scene.enclose?.[0].atoms, [
    { molecule: appearances(second.from)[0].id, atom: "a3" },
  ]);
  assert.deepEqual(compiled.warnings, []);
});

test("route YAML compiles linear, convergent and divergent step graphs", async () => {
  const arcs = (route: ReturnType<typeof figureEntry>) => {
    const edges = Object.values(route.graph.arrows);
    const products = new Set(
      edges.flatMap((arrow) => arrow.to.map((p) => p.state)),
    );
    return edges.flatMap((arrow) =>
      arrow.from.filter((p) => products.has(p.state)),
    ).length;
  };
  for (const [name, edges, length] of [
    ["linear", 2, 3],
    ["convergent", 2, 2],
    ["branched", 2, 2],
  ] as const) {
    const r = await compileFigure(await fixture(name)),
      route = figureEntry(r.entries[r.reference.ref]);
    assert.equal(route.kind, "figure");
    assert.equal(arcs(route), edges);
    assert.equal(figureRouteMetrics(route).longestLinearSteps, length);
    assert.equal(drawnArrows(route.graph).length, 3);
    assert.deepEqual(
      (await compileFigure(await fixture(name), r.entries)).entries,
      r.entries,
    );
  }
  const input = await fixture("convergent");
  input.arrows.join.others = "text";
  const r = await compileFigure(input),
    route = figureEntry(r.entries[r.reference.ref]);
  assert.equal(arcs(route), 2);
  assert.equal(figureRouteMetrics(route).longestLinearSteps, 2);
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
    kind: "scheme",
    states: {
      first: {
        arrows: [{ id: "lp", from: "lp(9)", to: "atom(8)" }],
        compounds: { structure: { smiles: "[OH:9][CH2:8][CH3:7]" } },
      },
    },
    arrows: {},
    views: { first: { items: ["first"] } },
  };
  const r = await compileFigure(input, { [saved.id]: saved }),
    m = figureEntry(r.entries[r.reference.ref]);
  assert.equal(drawingPanels(m)[0].scene.molecules[0].compound, saved.id);
  assert.equal(drawingPanels(m)[0].scene.labels![0].at.atom, "a23");
  const retained = r.entries[saved.id] as Compound;
  assert.deepEqual(retained.atomIds, saved.atomIds);
  assert.equal(retained.graph, saved.graph);
  assert.equal(retained.title, "Saved");
  const route = await compileFigure(
    {
      kind: "scheme",
      states: {
        a: {
          compounds: {
            structure: { smiles: "CCO", label: "A", name: "Local" },
          },
        },
        b: {
          compounds: {
            structure: { label: "b", smiles: "[CH3:4][CH2:5][OH:6]" },
          },
        },
      },
      arrows: {
        "1": {
          from: [{ state: "a", id: "a" }],
          to: [{ state: "b", id: "product-b" }],
          kind: "forward",
          role: "reaction",
        },
      },
    },
    { [saved.id]: saved },
  );
  assert.equal(
    Object.values(route.entries).filter((e) => e.kind === "compound").length,
    1,
  );
  assert.equal(
    appearances(arrowAt(route.entries[route.reference.ref]).from)[0].name,
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
    kind: "scheme",
    states: Object.fromEntries(
      Object.entries(compounds).map(([id, smiles]) => [
        id,
        { compounds: { structure: { smiles } } },
      ]),
    ),
    arrows: {
      expand: {
        from: "a",
        to: ["b", "c", "d", "e", "f"],
        kind: "forward",
        role: "reaction",
      },
    },
  });
  assert.equal(
    Object.values(distinct.entries).filter((e) => e.kind === "compound").length,
    6,
  );
});

test("explicit mapped hydrogens retain their endpoints beside an implicit-hydrogen library entry", async () => {
  const toolkit = await moleculeToolkit();
  const implicit = finishFigureEntry(
    prepareCompound(toolkit, {
      id: "cmp_water_pair",
      title: "Water pair",
      smiles: "O.[OH-]",
      sources: [{ source: "unknown", locator: "test", note: "Test structure" }],
    }),
  );
  const input = {
    kind: "scheme",
    states: {
      transfer: {
        arrows: [
          { from: "lp(9)", to: "between(9,10)" },
          { from: "bond(6,10)", to: "atom(6)" },
        ],
        compounds: { structure: { smiles: "[H:10][OH:6].[OH-:9]" } },
      },
    },
    arrows: {},
    views: { transfer: { items: ["transfer"] } },
  };
  const compiled = await compileFigure(input, { [implicit.id]: implicit });
  const scene = drawingPanels(compiled.entries[compiled.reference.ref])[0]
    .scene;
  const explicit = compiled.entries[scene.molecules[0].compound] as Compound;
  const layout = explicit.variants![scene.molecules[0].variant!];
  const view = compoundView(toolkit, explicit, layout);
  assert.equal(explicit.id, implicit.id);
  assert.equal(explicit.graph, implicit.graph);
  assert.deepEqual(explicit.atomIds, implicit.atomIds);
  assert.deepEqual(explicit.layout, implicit.layout);
  assert.equal(view.atomIds.length, implicit.atomIds.length + 1);
  const transfer = scene.arrows![1].from;
  assert.equal(transfer.kind, "bond");
  assert.ok(transfer.atoms.every((atom) => view.atomIds.includes(atom.atom)));
  assert.ok(
    transfer.atoms.some((atom) =>
      Object.hasOwn(layout.explicitHydrogens!, atom.atom),
    ),
  );
  const repeated = await compileFigure(input, compiled.entries);
  const repeatedScene = drawingPanels(
    repeated.entries[repeated.reference.ref],
  )[0].scene;
  assert.equal(repeatedScene.molecules[0].compound, explicit.id);
  const { prepareFigure } = await import("../src/ui/library/prepare.ts");
  const { loadFigureStyle } = await import("../scripts/figure-route.ts");
  const { loadFigureFonts } = await import("../scripts/figure-fonts.ts");
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit,
    style: await loadFigureStyle(),
    fonts: await loadFigureFonts(),
  });
  for (const atom of transfer.atoms) {
    const point = geometry.atomPoints[`${atom.molecule}:${atom.atom}`];
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  }
});

test("bracket abbreviations expand before graph deduplication", async () => {
  const r = await compileFigure({
    kind: "scheme",
    states: {
      a: { compounds: { structure: { label: "a", smiles: "CO[TBS]" } } },
      b: {
        compounds: {
          structure: { label: "b", smiles: "CO[Si](C)(C)C(C)(C)C" },
        },
      },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a" }],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
      },
    },
  });
  const cs = Object.values(r.entries).filter(
    (e): e is Compound => e.kind === "compound",
  );
  assert.equal(cs.length, 1);
  assert.ok(!cs[0].smiles.includes("TBS"));
  assert.deepEqual(cs[0].layout.abbreviations, ["TBS"]);
  const ring = await compileFigure({
    kind: "scheme",
    states: {
      a: {
        compounds: { structure: { label: "a", smiles: "c1ccc(O[PMB])cc1" } },
      },
      b: {
        compounds: {
          structure: { label: "b", smiles: "c1ccc(OCc2ccc(OC)cc2)cc1" },
        },
      },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a" }],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
      },
    },
  });
  assert.equal(
    Object.values(ring.entries).filter((e) => e.kind === "compound").length,
    1,
  );
});

test("reaction participants preserve product text and text-only reagents", async () => {
  const r = await compileFigure(await fixture("products")),
    reaction = arrowAt(r.entries[r.reference.ref]);
  assert.equal(reaction.role, "reaction");
  assert.equal(reaction.kind, "equilibrium");
  assert.equal(appearances(reaction.to)[0].ratio, "45%");
  assert.equal(appearances(reaction.to)[1].yield, "82% combined");
  assert.ok(reaction.drawing.reagents.includes("NH2OH"));
  assert.equal(appearances(reaction.from).length, 1);
  assert.equal(
    reaction.drawing.scene.captions?.filter((c) => c.text === "+").length,
    1,
  );
  assert.deepEqual(
    (await compileFigure(await fixture("products"), r.entries)).entries,
    r.entries,
  );

  const rd = await moleculeToolkit();
  for (const placement of reaction.drawing.scene.molecules) {
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
      kind: "scheme",
      states: {
        a: { compounds: { structure: { label: "a", smiles: "CCO" } } },
        b: {
          compounds: {
            structure: { label: "b", smiles: "N", text: "Ammonia" },
          },
        },
        c: { compounds: { structure: { label: "c", smiles: "CCN" } } },
      },
      arrows: {
        "1": {
          from: [
            { state: "a", id: "a" },
            { state: "b", id: "b", show },
          ],
          to: [{ state: "c", id: "product-c" }],
          kind: "forward",
          role: "reaction",
        },
      },
    });
    const reaction = arrowAt(result.entries[result.reference.ref]);
    assert.equal(
      reaction.drawing.scene.molecules.length,
      show === "box" || show === "plus" ? 3 : 2,
    );
    assert.equal(
      reaction.drawing.reagents.includes("Ammonia"),
      show === "text",
    );
  }
});

test("mechanism YAML preserves maps, arrow IDs and focus", async () => {
  const r = await compileFigure(await fixture("mechanism")),
    m = figureEntry(r.entries[r.reference.ref]);
  assert.equal(drawingPanels(m).length, 2);
  assert.equal(Object.values(m.graph.arrows)[0].map?.length, 4);
  const scene = drawingPanels(m)[0].scene;
  assert.equal(scene.arrows![1].electrons, 1);
  assert.deepEqual(scene.focus, {
    primary: { arrows: ["main"] },
    supporting: [{ arrows: ["support"] }],
  });
  const aromatic = await compileFigure({
    kind: "scheme",
    states: {
      ring: {
        arrows: [{ id: "push", from: "pi(1,2)", to: "atom(2)" }],
        compounds: {
          structure: { smiles: "[CH:1]1=[CH:2][CH:3]=[CH:4][CH:5]=[CH:6]1" },
        },
      },
    },
    arrows: {},
    views: { ring: { items: ["ring"] } },
  });
  const ring = figureEntry(aromatic.entries[aromatic.reference.ref]),
    placement = drawingPanels(ring)[0].scene.molecules[0];
  assert.ok(placement.variant);
  assert.ok(
    (aromatic.entries[placement.compound] as Compound).variants![
      placement.variant!
    ].molblock,
  );
  const same = await compileFigure({
    kind: "scheme",
    states: {
      a: { compounds: { structure: { smiles: "[CH3:7][OH:8]" } } },
      b: { compounds: { structure: { smiles: "[CH3:7][O-:8]" } } },
    },
    arrows: {
      ["next-" + "a"]: {
        from: "a",
        to: "b",
        kind: "forward",
        role: "elementary",
      },
    },
    views: {
      a: { items: ["a"], arrows: ["next-" + "a"] },
      b: { items: ["b"] },
    },
  });
  assert.equal(
    figureEntry(same.entries[same.reference.ref]).graph.arrows["next-a"].map
      ?.length,
    2,
  );
  const comparison = await compileFigure(await fixture("comparison")),
    cmp = figureEntry(comparison.entries[comparison.reference.ref]);
  assert.ok(
    Object.values(cmp.graph.arrows).every(({ kind }) => kind === "none"),
  );
  assert.equal(drawingPanels(cmp)[0].scene.reactionArrows, undefined);
  for (const arrow of [
    "forward",
    "equilibrium",
    "resonance",
    "retro",
    "none",
  ]) {
    const r = await compileFigure({
      kind: "scheme",
      states: {
        a: { compounds: { structure: { label: "a", smiles: "CO" } } },
        b: { compounds: { structure: { label: "b", smiles: "C=O" } } },
      },
      arrows: {
        "1": {
          from: [{ state: "a", id: "a" }],
          to: [{ state: "b", id: "product-b" }],
          kind: arrow,
          role: "reaction",
        },
      },
    });
    assert.equal(arrowAt(r.entries[r.reference.ref]).drawing.arrow.kind, arrow);
  }
});

test("reaction sources preserve equivalents, mixture fractions, tags and reagent position", async () => {
  const input = {
    kind: "scheme",
    states: {
      a: { compounds: { structure: { label: "a", smiles: "CCO" } } },
      b: { compounds: { structure: { label: "b", smiles: "CC=O" } } },
      c: { compounds: { structure: { label: "c", smiles: "CC(=O)O" } } },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a", equivalents: 2 }],
        to: [
          { state: "b", id: "product-b", fraction: 0.45 },
          { state: "c", id: "product-c", fraction: 0.55 },
        ],
        kind: "forward",
        role: "reaction",
        title: "First step",
        sources: [
          { source: "unknown", locator: "step source", note: "Fixture" },
        ],
        tags: ["Oxidation"],
        reagentPosition: "below-arrow",
        above: "[O]",
      },
    },
  };
  const result = await compileFigure(input);
  const reaction = arrowAt(result.entries[result.reference.ref]);
  assert.equal(appearances(reaction.from)[0].equivalents, 2);
  assert.deepEqual(
    appearances(reaction.to).map((p) => p.fraction),
    [0.45, 0.55],
  );
  assert.deepEqual(reaction.tags, ["Oxidation"]);
  assert.equal(reaction.drawing.reagentPosition, "below-arrow");
  assert.equal(reaction.title, "First step");
  assert.deepEqual(reaction.sources, input.arrows["1"].sources);
  assert.deepEqual(
    (await compileFigure(input, result.entries)).entries,
    result.entries,
  );
});

test("YAML boundary rejects unsupported style fields and validates deferred references", async () => {
  const input = {
    kind: "scheme",
    states: {
      a: { compounds: { structure: { label: "a", smiles: "CCO" } } },
      b: { compounds: { structure: { label: "b", smiles: "CC=O" } } },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a" }],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
      },
    },
  };
  for (const field of ["charges", "dots", "ring_h"])
    assert.throws(
      () => validateFigureInput({ ...input, [field]: 1 }),
      new RegExp(field),
    );
  const deferred = {
    kind: "scheme",
    states: {
      one: {
        arrows: [{ from: "lp(2)", to: "atom(1)", forming: true }],
        enclose: [{ atoms: [1] }],
        compounds: { structure: { smiles: "[CH3:1][OH:2]", scale: 1.5 } },
      },
    },
    arrows: {},
    views: { one: { items: ["one"] } },
  };
  const r = await compileFigure(deferred);
  assert.deepEqual(r.warnings, []);
  await assert.rejects(
    compileFigure({
      ...deferred,
      states: { one: { ...deferred.states.one, enclose: [{ atoms: [99] }] } },
    }),
    /unknown atom/,
  );
  await assert.rejects(
    compileFigure({
      kind: "scheme",
      states: {
        a: {
          arrows: [{ from: "lp(99)", to: "atom(1)" }],
          compounds: { structure: { smiles: "[CH3:1][OH:2]" } },
        },
      },
      arrows: {},
      views: { a: { items: ["a"] } },
    }),
    /unknown atom/i,
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
    for (const dir of ["sources", "compounds", "figures"]) {
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
  const first = arrowAt(parse(before[`figures/${id}.yaml`]));
  assert.equal(first.drawing.scene.arrows, undefined);
  assert.equal(first.drawing.scene.labels, undefined);
  assert.equal(first.drawing.scene.focus, undefined);
  assert.ok(
    first.drawing.scene.molecules.every(
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

  await writeFile(source, text.replace('above: "MeOH"', 'above: "EtOH"'));
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
    kind: "scheme",
    states: {
      a: { compounds: { structure: { label: "a", smiles: "CC(O)C" } } },
      b: {
        compounds: {
          structure: {
            label: "b",
            smiles: "C[C:1](=[O:2])C",
            arrows: [{ id: "push", from: "pi(1,2)", to: "atom(2)" }],
            enclose: [{ id: "oxygen", atoms: [2] }],
          },
        },
      },
      c: { compounds: { structure: { label: "c", smiles: "CC(O)C" } } },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a" }],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
      },
      "2": {
        from: [{ state: "b", id: "b" }],
        to: [{ state: "c", id: "product-c" }],
        kind: "forward",
        role: "reaction",
      },
    },
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
  const arrows = {
    "1": { from: "a", to: "b", kind: "forward", role: "reaction" },
    "2": { from: "b", to: "c", kind: "forward", role: "reaction" },
  };
  const states = (order: [string, string][]) =>
    Object.fromEntries(
      order.map(([id, smiles]) => [
        id,
        { compounds: { structure: { smiles } } },
      ]),
    );
  const forward = await compileFigure({
    kind: "scheme",
    states: states(Object.entries(compounds)),
    arrows,
  });
  const reverse = await compileFigure({
    kind: "scheme",
    states: states(Object.entries(compounds).reverse()),
    arrows,
  });
  const layouts = (result: typeof forward) => {
    const route = figureEntry(result.entries[result.reference.ref]);
    return drawnArrows(route.graph).flatMap(([, reaction]) => {
      return reaction.drawing.scene.molecules.map((p) => {
        const c = result.entries[p.compound] as Compound;
        return p.variant ? c.variants![p.variant].coords : c.layout.coords;
      });
    });
  };
  assert.deepEqual(layouts(forward), layouts(reverse));

  const route = figureEntry(forward.entries[forward.reference.ref]);
  const { ref, variant } = route.graph.states.b.compounds!.structure;
  const compound = forward.entries[ref] as Compound;
  const edited = compound.variants![variant!];
  edited.coords = Object.fromEntries(
    Object.entries(edited.coords).map(([atom, { x, y }]) => [
      atom,
      { x: 0 - y, y: x },
    ]),
  );
  const selected = await compileFigure(
    {
      kind: "scheme",
      states: {
        ...states(Object.entries(compounds)),
        b: { compounds: { structure: { smiles: compounds.b, variant } } },
      },
      arrows,
    },
    forward.entries,
  );
  const updated = figureEntry(selected.entries[selected.reference.ref]);
  const placements = drawnArrows(updated.graph).flatMap(([, arrow]) =>
    arrow.drawing.scene.molecules.filter(
      (molecule) => molecule.compound === ref,
    ),
  );
  assert.equal(placements.length, 2);
  assert.ok(placements.every((molecule) => molecule.variant === variant));
  assert.deepEqual(
    (selected.entries[ref] as Compound).variants![variant!].coords,
    edited.coords,
  );
});

test("figure substitutions preserve defaults and override one mapped instance", async () => {
  const toolkit = await moleculeToolkit();
  const smiles = "[N+:11](=O)([O-])c1ccc([N+:22](=O)[O-])cc1";
  for (const [settings, expected] of [
    [{}, [11, 22]],
    [{ abbreviate: false }, []],
    [{ abbreviations: [{ name: "NO2", atom: 22 }] }, [22]],
    [{ abbreviations: [{ name: "NO2", atom: 22, expand: true }] }, [11]],
  ] as const) {
    const result = await compileFigure({
      kind: "scheme",
      states: { a: { compounds: { a: { smiles, ...settings } } } },
      arrows: {},
    });
    const gallery = figureEntry(result.entries[result.reference.ref]);
    const placement = drawingPanels(gallery)[0].scene.molecules[0];
    const compound = result.entries[placement.compound] as Compound;
    const layout = placement.variant
      ? compound.variants![placement.variant]
      : compound.layout;
    const groups = compoundAbbreviations(toolkit, compound, layout);
    // The second written nitro substituent is rooted at the N following the ring.
    assert.deepEqual(
      groups.map((group) => (group.atoms[0] === 0 ? 11 : 22)),
      [...expected],
    );
  }
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
  const azide = figureTextRuns("N3^-", 20, fonts);
  assert.equal(azide.map((run) => run.text).join(""), "N3−");
  assert.ok(azide.at(-1)!.shift < 0);
  const compiled = await compileFigure({
    kind: "scheme",
    states: {
      a: { compounds: { structure: { label: "a", smiles: "CCO" } } },
      b: { compounds: { structure: { label: "b", smiles: "CC=O" } } },
      reagent: { text: "PhB(OH)2" },
    },
    arrows: {
      "1": {
        from: [
          { state: "a", id: "a" },
          { state: "reagent", id: "reagent" },
        ],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
        above: "Pd(PPh3)4, K2CO3",
      },
    },
  });
  assert.deepEqual(
    arrowAt(compiled.entries[compiled.reference.ref]).drawing.reagents,
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
  const route = figureEntry(first.entries[first.reference.ref]);
  const compound = Object.values(first.entries).find(
    (entry): entry is Compound => entry.kind === "compound",
  )!;
  const duplicate = { ...structuredClone(compound), id: "cmp_duplicate" };
  const entries = { [duplicate.id]: duplicate, ...first.entries };
  const second = await compileFigure(input, entries, "saved");
  const saved = figureEntry(second.entries[route.id]);
  assert.deepEqual(
    Object.keys(saved.graph.arrows),
    Object.keys(route.graph.arrows),
  );
  for (const [id, arrow] of drawnArrows(saved.graph)) {
    assert.deepEqual(arrow.from, route.graph.arrows[id].from);
    assert.deepEqual(arrow.to, route.graph.arrows[id].to);
    assert.ok(appearances(arrow.from)[0].compound !== duplicate.id);
  }
  assert.deepEqual(
    (await compileFigure(input, second.entries, "saved")).entries,
    second.entries,
  );
  const singleInput = {
    ...input,
    arrows: Object.fromEntries(Object.entries(input.arrows).slice(0, 1)),
  };
  const single = await compileFigure(singleInput, second.entries, "saved");
  assert.equal(single.reference.ref, route.id);
  assert.equal(single.entries[route.id].kind, "figure");
  assert.equal(
    drawnArrows(figureEntry(single.entries[route.id]).graph).length,
    1,
  );
});

test("compiled reactions include boxed structures, placement brackets and styled footnotes", async () => {
  const { prepareFigure } = await import("../src/ui/library/prepare.ts");
  const { loadFigureFonts } = await import("../scripts/figure-fonts.ts");
  const { figureStyle } = await import("./fixtures/figures/style.ts");
  const { walkGeometry } = await import("../src/ui/library/geometry-walk.ts");
  const input = {
    kind: "scheme",
    footnote: "^{a} t-BuOH, n-Hexane, 20 °C",
    states: {
      a: {
        compounds: { structure: { label: "a", smiles: "CCO", bracket: "ts" } },
      },
      b: { compounds: { structure: { label: "b", smiles: "CC=O" } } },
      c: { compounds: { structure: { label: "c", smiles: "CBr" } } },
    },
    arrows: {
      "1": {
        from: [
          { state: "a", id: "a" },
          { state: "c", id: "c" },
        ],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
        others: "box",
        above: "n-BuLi",
        below: "cis-isomer",
      },
    },
  };
  const compiled = await compileFigure(input),
    reaction = arrowAt(compiled.entries[compiled.reference.ref]);
  assert.equal(reaction.drawing.scene.molecules[0].bracket, "ts");
  assert.equal(
    figureEntry(compiled.entries[compiled.reference.ref]).footnote,
    input.footnote,
  );
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
    arrows: { "1": { ...input.arrows["1"], turn: "down" } },
  });
  const verticalReaction = arrowAt(vertical.entries[vertical.reference.ref]);
  assert.equal(
    verticalReaction.drawing.arrow.from.x,
    verticalReaction.drawing.arrow.to.x,
  );
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
    kind: "scheme",
    states: {
      a: {
        compounds: {
          structure: {
            label: "a",
            smiles: "N#CC1CCCCCCCCCCC1",
            coordgen: true,
            abbreviations: ["CN"],
          },
        },
      },
      b: {
        compounds: {
          structure: {
            label: "b",
            smiles: "N#CC1CCCCCCCCCCC1",
            abbreviations: ["CN"],
          },
        },
      },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a" }],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
      },
    },
  });
  const reaction = arrowAt(result.entries[result.reference.ref]);
  const placement = reaction.drawing.scene.molecules[0];
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

test("a mechanism rejects shortening an arrow-bearing group, while a reaction can abbreviate it", async () => {
  const smiles = "CCN[C:3](=[O:4])OC(C)(C)C";
  const state = {
    compounds: { structure: { smiles } },
    arrows: [{ from: "lp(4)", to: "atom(4)" }],
  };
  await assert.rejects(
    compileFigure({
      kind: "scheme",
      states: {
        protonation: {
          ...state,
          compounds: {
            structure: { ...state.compounds.structure, abbreviations: ["Boc"] },
          },
        },
      },
      arrows: {},
    }),
    /protonation.*Boc must be expanded.*atom 4/,
  );
  const mechanism = await compileFigure({
    kind: "scheme",
    states: { protonation: state },
    arrows: {},
  });
  const entry = figureEntry(mechanism.entries[mechanism.reference.ref]);
  const mechanismPlacement = drawingPanels(entry)[0].scene.molecules[0];
  const mechanismCompound = mechanism.entries[
    mechanismPlacement.compound
  ] as Compound;
  assert.deepEqual(
    compoundAbbreviations(
      await moleculeToolkit(),
      mechanismCompound,
      mechanismCompound.variants![mechanismPlacement.variant!],
    ),
    [],
  );

  const result = await compileFigure({
    kind: "scheme",
    states: {
      a: {
        compounds: {
          structure: { label: "a", smiles, abbreviations: ["Boc"] },
        },
      },
      b: { compounds: { structure: { label: "b", smiles: "CCN" } } },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a" }],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
      },
    },
  });
  const reaction = arrowAt(result.entries[result.reference.ref]);
  const placement = reaction.drawing.scene.molecules[0];
  const compound = result.entries[placement.compound] as Compound;
  const layout = compound.variants![placement.variant!];
  assert.deepEqual(
    compoundAbbreviations(await moleculeToolkit(), compound, layout).map(
      (group) => group.name,
    ),
    ["Boc"],
  );
});

test("a shared substituent keeps its direction when a ring bond is reduced", async () => {
  const result = await compileFigure({
    kind: "scheme",
    coordgen: true,
    states: {
      a: {
        compounds: {
          structure: {
            label: "a",
            smiles: "COC(=O)C1=CC[C@]2([H])CCN(C(C)=O)[C@@]12[H]",
            abbreviations: ["CO₂Me", "Ac"],
          },
        },
      },
      b: {
        compounds: {
          structure: {
            label: "b",
            smiles: "COC(=O)[C@]1([H])CC[C@]2([H])CCN(C(C)=O)[C@@]12[H]",
            abbreviations: ["CO₂Me", "Ac"],
          },
        },
      },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a" }],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
      },
    },
    layout: { anchor: "a" },
  });
  const toolkit = await moleculeToolkit(),
    reaction = arrowAt(result.entries[result.reference.ref]),
    query = toolkit.get_qmol("*C(=O)OC")!;
  try {
    const vectors = reaction.drawing.scene.molecules.map((p) => {
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
    kind: "scheme",
    states: {
      a: {
        compounds: {
          structure: { label: "a", smiles: "CCCOCC |Sg:n:2:n:ht|" },
        },
      },
      b: {
        compounds: {
          structure: { label: "b", smiles: "CCCOC=O |Sg:n:2:n:ht|" },
        },
      },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a" }],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
      },
    },
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
    kind: "scheme",
    states: {
      a: {
        compounds: { structure: { label: "a", smiles: "CCO", scale: 1.45 } },
      },
      b: { compounds: { structure: { label: "b", smiles: "CC=O" } } },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a" }],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
      },
    },
  });
  const reaction = arrowAt(result.entries[result.reference.ref]),
    p = reaction.drawing.scene.molecules[0],
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
    kind: "scheme",
    states: {
      a: { compounds: { structure: { label: "a", smiles: "CC(O)C=O" } } },
      b: { compounds: { structure: { label: "b", smiles: "CC(O)C=O" } } },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a" }],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
      },
    },
    layout: { anchor: "a" },
  };
  const fonts = await loadFigureFonts(),
    toolkit = await moleculeToolkit();
  const vector = async (
    result: Awaited<ReturnType<typeof compileFigure>>,
    role: "reactants" | "products",
  ) => {
    const r = arrowAt(result.entries[result.reference.ref]),
      p = appearances(role === "reactants" ? r.from : r.to)[0],
      c = result.entries[p.compound] as Compound;
    const g = await prepareFigure(result.entries, result.reference, {
      toolkit,
      fonts,
      style: figureStyle,
    });
    const a = g.atomPoints["1/" + p.id + ":" + c.atomIds[0]],
      b = g.atomPoints["1/" + p.id + ":" + c.atomIds[2]];
    return { x: b.x - a.x, y: b.y - a.y };
  };
  const base = await compileFigure(input),
    rotated = await compileFigure({
      ...input,
      states: {
        ...input.states,
        a: {
          compounds: {
            structure: { ...input.states.a.compounds.structure, rot: 90 },
          },
        },
      },
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
    kind: "scheme",
    states: {
      a: {
        compounds: {
          structure: {
            label: "a",
            smiles: "[CH3:7][CH:14]([OH:21])C=O",
            numbers: true,
          },
        },
      },
      b: { compounds: { structure: { label: "b", smiles: "CC(O)C=O" } } },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a" }],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
      },
    },
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
    kind: "scheme",
    title: "Charged transformation",
    states: {
      a: {
        compounds: { structure: { label: "a", smiles: "COC(=O)c1cccnc1" } },
      },
      b: {
        compounds: {
          structure: { label: "b", smiles: "COC(=O)c1ccc[n+](C)c1" },
        },
      },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a" }],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
      },
    },
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

test("schemes with compounds save grouped panels and grids with ordered labels", async () => {
  const input = {
    kind: "scheme",
    states: {
      a: { compounds: { a: { smiles: "CCO", yield: "80%", note: "1 h" } } },
      b: { compounds: { b: { smiles: "CCCO", label: "**B**", yield: "72%" } } },
      c: { compounds: { c: "CC(C)O" } },
    },
    arrows: {},
    groups: {
      group1: { title: "First group", items: ["b", "a"] },
      group2: { subtitle: "Second group", items: ["c"] },
    },
  };
  const result = await compileFigure(input, {}, "scope");
  const entry = figureEntry(result.entries[result.reference.ref]);
  const scene = drawingPanels(entry)[0].scene;
  assert.equal(Object.keys(entry.graph.groups ?? {}).length, 2);
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
    kind: "scheme",
    layout: { cols: 2 },
    states: input.states,
    arrows: {},
  });
  const grid = drawingPanels(gallery.entries[gallery.reference.ref])[0].scene;
  assert.deepEqual(
    grid.molecules.map((m) => m.id),
    ["a", "b", "c"],
  );
  assert.ok(grid.molecules[2].at.y > grid.molecules[0].at.y);
  const comparison = await compileFigure({
    kind: "scheme",
    states: {
      sideBySide: {
        title: "Comparison",
        tone: "comparison",
        compounds: {
          a: { smiles: "[CH3:1]O", label: "A" },
          b: { smiles: "CCO", label: "B" },
        },
        labels: [
          {
            id: "note",
            at: "a:1",
            kind: "text",
            text: "C",
            offset: { x: -1, y: 0.5 },
          },
        ],
      },
    },
    arrows: {},
  });
  const panel = drawingPanels(comparison.entries[comparison.reference.ref])[0]
    .scene;
  assert.deepEqual(
    panel.captions?.map(({ text }) => text),
    ["**A**", "**B**"],
  );
  assert.deepEqual(panel.labels?.find(({ id }) => id === "note")?.offset, {
    x: -1,
    y: 0.5,
  });
  const defaults = await compileFigure({
    kind: "scheme",
    states: {
      a: { compounds: { a: "CCO" } },
      b: { compounds: { b: "CCCO" } },
      c: { compounds: { c: "CC(C)O" } },
      d: { compounds: { d: "CCF" } },
      e: { compounds: { e: "CCCl" } },
    },
    arrows: {},
  });
  const molecules = drawingPanels(defaults.entries[defaults.reference.ref])[0]
    .scene.molecules;
  assert.ok(molecules[3].at.x > molecules[2].at.x);
  assert.ok(molecules[4].at.x < molecules[3].at.x);
  assert.ok(molecules[4].at.y > molecules[3].at.y);
  await assert.rejects(
    compileFigure({ ...input, groups: { extra: { items: ["missing"] } } }),
    /unknown|undefined/i,
  );
});

test("cycle YAML saves clockwise closed steps with incoming and outgoing branches", async () => {
  const input = {
    kind: "scheme",
    states: {
      "1": { text: "A" },
      "2": { compounds: { "2": { smiles: "CCO", label: "B" } } },
      "3": { text: "C" },
      "4": { text: "D" },
    },
    arrows: {
      "step-1": {
        from: "1",
        to: "2",
        role: "elementary",
        kind: "forward",
        in: "X",
        out: "Y",
        title: "Exchange",
      },
      "step-2": { from: "2", to: "3", role: "elementary", kind: "forward" },
      "step-3": {
        from: "3",
        to: "4",
        role: "elementary",
        kind: "forward",
        out: "Z",
      },
      "step-4": {
        from: "4",
        to: "1",
        role: "elementary",
        kind: "forward",
        in: "W",
      },
    },
  };
  const result = await compileFigure(input, {}, "cycle");
  const scene = drawingPanels(result.entries[result.reference.ref])[0].scene;
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
    () => validateFigureInput({ ...input, arrows: { incomplete: {} } }),
    /from/,
  );
});

test("gallery line spacing includes superscripts and subscripts in adjacent captions", async () => {
  const result = await compileFigure({
    kind: "scheme",
    states: {
      a: {
        compounds: {
          a: { smiles: "CCO", yield: "46% yield^b,e", note: "**Me3N**\n1 h" },
        },
      },
    },
    arrows: {},
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

test("a route inherits the core after an electron event places its fragments", async () => {
  const compiled = await compileFigure({
    kind: "scheme",
    changes: "off",
    states: {
      precursor: {
        compounds: { structure: { label: "precursor", smiles: "CCC=C" } },
      },
      event: {
        compounds: {
          structure: {
            label: "event",
            smiles: "[CH3:1][C:2](=[O:3])[CH3:4].[CH3:5][CH2:6][CH:7]=[CH2:8]",
            arrows: [
              { from: "pi(7,8)", to: "between(8,2)" },
              { from: "pi(2,3)", to: "atom(3)" },
            ],
          },
        },
      },
      product: {
        compounds: { structure: { label: "product", smiles: "C=CCCC" } },
      },
    },
    arrows: {
      "1": {
        from: [{ state: "precursor", id: "precursor" }],
        to: [{ state: "event", id: "product-event" }],
        kind: "forward",
        role: "reaction",
      },
      "2": {
        from: [{ state: "event", id: "event" }],
        to: [{ state: "product", id: "product-product" }],
        kind: "forward",
        role: "reaction",
      },
    },
  });
  const route = figureEntry(compiled.entries[compiled.reference.ref]);
  const reaction = arrowAt(route, 0);
  const points = (id: string) => {
    const placement = reaction.drawing.scene.molecules.find(
      (m) => m.id === id,
    )!;
    return (compiled.entries[placement.compound] as Compound).variants![
      placement.variant!
    ].coords;
  };
  const precursor = points("precursor"),
    event = points("product-event");
  const direction = (
    coords: Compound["layout"]["coords"],
    first: string,
    second: string,
  ) => ({
    x: coords[second].x - coords[first].x,
    y: coords[second].y - coords[first].y,
  });
  const a = direction(precursor, "a3", "a4"),
    b = direction(event, "a7", "a8");
  assert.ok(
    (a.x * b.x + a.y * b.y) / Math.hypot(a.x, a.y) / Math.hypot(b.x, b.y) >
      0.99,
  );
});

test("figure density fields survive compilation and library validation", async () => {
  const result = await compileFigure({
    kind: "scheme",
    bond: 24,
    width: 600,
    states: {
      a: { compounds: { structure: { label: "a", smiles: "CCO" } } },
      b: { compounds: { structure: { label: "b", smiles: "CC=O" } } },
    },
    arrows: {
      "1": {
        from: [{ state: "a", id: "a" }],
        to: [{ state: "b", id: "product-b" }],
        kind: "forward",
        role: "reaction",
      },
    },
  });
  const entry = result.entries[result.reference.ref];
  assert.equal(entry.style?.bond, 24);
  assert.equal(entry.style?.width, 600);
});
test("compiles state graphs for convergence, substitution, resonance and a catalytic cycle", async () => {
  for (const name of ["convergence", "substitution", "resonance", "cycle"]) {
    const { entries, reference, generated } = await compileFigure(
      await fixture("graph/" + name),
      {},
      name,
    );
    const figure = entries[reference.ref];
    assert.equal(figure.kind, "figure");
    assert.equal(
      generated.filter((id) => entries[id].kind === "figure").length,
      1,
    );
    if (name === "convergence") {
      assert.equal(figureRouteMetrics(figure).longestLinearSteps, 2);
      assert.deepEqual(
        figure.graph.arrows.couple.from.map(({ state }) => state),
        ["acyl", "amine"],
      );
      assert.equal(
        figure.graph.arrows.couple.via?.arrows.add.role,
        "elementary",
      );
      validateFigureInstance(entries, {
        ...reference,
        frame: "couple/tetrahedral",
      });
    } else if (name === "substitution") {
      assert.equal(figure.graph.states.encounter.scene?.arrows?.length, 2);
      assert.equal(figure.graph.arrows.substitution.map?.length, 3);
    } else if (name === "resonance") {
      assert.equal(figure.graph.arrows.delocalization.kind, "resonance");
      assert.equal(figure.graph.arrows.delocalization.map?.length, 3);
    } else {
      assert.equal(figure.graph.states.excited.text, "\\*PC");
      assert.equal(figure.graph.arrows["step-3"].to[0].state, "ground");
    }
  }
});
