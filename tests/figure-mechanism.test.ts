import {
  appearances,
  graphPanels,
} from "../shared/chemical-library/figure-layout.ts";
import type { SchemeState } from "../scripts/figure-input.ts";
import { drawingPanels, figureEntry } from "./helpers/figure-graph.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFigureInstance } from "../shared/chemical-library/contract.ts";
import { prepareLibraryFigure } from "../scripts/figure-preparation.ts";
import { loadFigureStyle } from "../scripts/figure-route.ts";
import { walkGeometry } from "../src/ui/library/geometry-walk.ts";
import { compileFigure } from "../scripts/figure-scene.ts";
import { figureChargeDiagnostics } from "../scripts/figure-chemistry-diagnostics.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { prepareCompound } from "../shared/chemical-library/chemistry.ts";

test("compilation rejects an electron arrow from a positive charge", async () => {
  await assert.rejects(
    compileFigure({
      kind: "scheme",
      states: {
        event: {
          arrows: [{ id: "bad", from: "charge(1)", to: "atom(2)" }],
          compounds: { structure: { smiles: "[NH3+:1][CH3:2]" } },
        },
      },
      arrows: {},
      views: { event: { items: ["event"] } },
    }),
    /arrow bad.*positive charge/,
  );
});

test("lint reports a change in total formal charge between mechanism frames", async () => {
  const compiled = await compileFigure({
    kind: "scheme",
    states: {
      before: { compounds: { structure: { smiles: "[OH-:1]" } } },
      after: { compounds: { structure: { smiles: "[OH2:1]" } } },
    },
    arrows: {
      ["next-" + "before"]: {
        from: "before",
        to: "after",
        kind: "forward",
        role: "elementary",
      },
    },
    views: {
      before: { items: ["before"], arrows: ["next-" + "before"] },
      after: { items: ["after"] },
    },
  });
  const diagnostics = figureChargeDiagnostics(
    compiled.entries,
    await moleculeToolkit(),
  );
  assert.ok(
    diagnostics.some(
      (d) =>
        d.code === "FRAME_CHARGE_CHANGE" &&
        d.elements.join(",") === "before,after",
    ),
  );
});

test("mechanism frames retain participant identity and electron events", async () => {
  const result = await compileFigure({
    kind: "scheme",
    states: {
      event: {
        arrows: [
          {
            id: "attack",
            from: "lp(donor:1)",
            to: "between(donor:1,acceptor:1)",
          },
        ],
        focus: { primary: ["attack"] },
        labels: [
          { id: "polar", at: "acceptor:2", kind: "partialCharge", text: "δ−" },
        ],
        partialBonds: [{ from: "donor:1", to: "acceptor:1" }],
        compounds: {
          donor: { smiles: "[OH-:1]", label: "Donor" },
          acceptor: { smiles: "[CH2:1]=[O:2]", label: "Acceptor" },
        },
      },
    },
    arrows: {},
    views: { event: { items: ["event"] } },
  });
  const entry = figureEntry(result.entries[result.reference.ref]);
  const scene = drawingPanels(entry)[0].scene;
  assert.deepEqual(
    scene.molecules.map((m) => m.id),
    ["donor", "acceptor"],
  );
  assert.equal(scene.arrows?.[0].from.kind, "lonePair");
  assert.deepEqual(scene.arrows?.[0].to, {
    kind: "formingBond",
    atoms: [
      { molecule: "donor", atom: "a1" },
      { molecule: "acceptor", atom: "a1" },
    ],
  });
  assert.deepEqual(
    scene.partialBonds?.[0].atoms,
    scene.arrows?.[0].to.kind === "formingBond" ? scene.arrows[0].to.atoms : [],
  );
  assert.equal(
    scene.labels?.find((l) => l.id === "polar")?.at.molecule,
    "acceptor",
  );
  assert.deepEqual(scene.focus?.primary?.arrows, ["attack"]);
  assert.ok(scene.captions?.some((c) => c.text.includes("Donor")));
});

test("mechanism steps and qualified maps retain their roles across frames", async () => {
  const result = await compileFigure({
    kind: "scheme",
    states: {
      before: {
        tone: "comparison",
        compounds: { input: { smiles: "[CH3:1][OH:2]", label: "Input" } },
      },
      "after/reactant": {
        compounds: {
          reactant: {
            smiles: "[CH3:1][OH:2]",
            label: "Input",
            arrows: [{ id: "cleavage", from: "bond(1,2)", to: "atom(2)" }],
            focus: { primary: ["cleavage"] },
          },
        },
      },
      "after/product": {
        compounds: { product: { smiles: "[CH2:1]=[O:2]", label: "Output" } },
      },
    },
    arrows: {
      ["next-" + "before"]: {
        from: "before",
        to: "after",
        kind: "forward",
        role: "display",
        map: { "input:1": "product:1", "input:2": "product:2" },
      },
      "after/1": {
        from: ["after/reactant"],
        to: ["after/product"],
        kind: "forward",
        role: "elementary",
        above: "[O]",
      },
    },
    views: { before: { items: ["before"] }, after: { items: ["after"] } },
    groups: {
      after: {
        tone: "comparison",
        items: ["after/reactant", "after/product"],
        edges: ["after/1"],
      },
    },
  });
  const entry = figureEntry(result.entries[result.reference.ref]);
  assert.ok(Object.values(entry.graph.groups ?? {}).length);
  const scene = drawingPanels(entry)[1].scene;
  const reactant = scene.molecules.find((m) => m.id === "reactant")!;
  const product = scene.molecules.find((m) => m.id === "product")!;
  assert.ok(reactant.at.x < product.at.x);
  assert.deepEqual(scene.reactionArrows?.[0].above, ["[O]"]);
  assert.equal(scene.reactionArrows?.[0].kind, "forward");
  assert.deepEqual(scene.focus?.primary?.arrows, ["reactant/cleavage"]);
  const overview = await prepareLibraryFigure(
    result.entries,
    result.reference,
    await loadFigureStyle(),
  );
  for (const drawing of [overview, overview.cardPlans!.at(-1)!.geometry]) {
    const arrows = new Set<string>();
    const labels = new Set<string>();
    walkGeometry(drawing.root, (node) => {
      const id = node.attributes["data-reaction-arrow"];
      if (id) arrows.add(id);
      if (node.kind === "text") labels.add(node.text);
    });
    assert.ok(arrows.has("after/after/1"));
    assert.ok(arrows.has("next-before"));
    assert.ok(labels.has("[O]"));
  }
  assert.deepEqual(
    Object.values(entry.graph.arrows).flatMap(({ map }) =>
      (map ?? []).map((m) => [
        m.from.molecule.split("/").at(-1),
        m.to.molecule.split("/").at(-1),
      ]),
    ),
    [
      ["input", "product"],
      ["input", "product"],
    ],
  );
});

test("comparison states and absent arrowheads retain explicit atom maps", async () => {
  for (const [tone, kind] of [
    ["comparison", "forward"],
    [undefined, "none"],
    [undefined, "forward"],
  ] as const) {
    const structure = { smiles: "[CH3:1][OH:2]" };
    const compiled = await compileFigure({
      kind: "scheme",
      states: {
        before: { compounds: { structure }, ...(tone && { tone }) },
        after: { compounds: { structure } },
      },
      arrows: {
        compare: {
          from: "before",
          to: "after",
          kind,
          role: "elementary",
          map: { 2: 2 },
        },
      },
    });
    const entry = figureEntry(compiled.entries[compiled.reference.ref]);
    assert.deepEqual(
      entry.graph.arrows.compare.map?.map(({ from }) => from.atom),
      !tone && kind === "forward" ? ["a1", "a2"] : ["a2"],
    );
  }
});

async function stateDiagnostics(state: SchemeState) {
  const { drawFigure } = await import("../scripts/figure-draw.ts");
  const compiled = await compileFigure({
    kind: "scheme",
    states: { event: state },
    arrows: {},
  });
  const diagnostics = [];
  for await (const rendered of drawFigure(compiled.entries, compiled.reference))
    diagnostics.push(...rendered.diagnostics);
  return diagnostics;
}

test("electron shafts leave their own lone pair clear", async () => {
  const diagnostics = await stateDiagnostics({
    compounds: {
      structure: { smiles: "[CH3:1][CH:2]=[O+:3][CH3:4].[CH3:5][OH:6]" },
    },
    arrows: [
      { from: "lp(6)", to: "atom(2)" },
      { from: "pi(2,3)", to: "atom(3)" },
    ],
  });
  assert.deepEqual(
    diagnostics.filter((d) => d.code === "ARROW_LABEL_OVERLAP"),
    [],
  );
});

test("electron shafts clear intervening ring bonds", async () => {
  const diagnostics = await stateDiagnostics({
    compounds: {
      a: { smiles: "[Pd:1]", label: "" },
      b: { smiles: "[Br:2][c:3]1[cH:4][cH:5][cH:6][cH:7][cH:8]1", label: "" },
    },
    arrows: [
      { from: "lp(a:1)", to: "between(a:1,b:3)" },
      { from: "bond(b:2,b:3)", to: "atom(a:1)" },
    ],
  });
  assert.deepEqual(
    diagnostics.filter((d) => d.code === "ARROW_BOND_CROSSING"),
    [],
  );
});

test("electron shafts clear labels on the selected side", async () => {
  const diagnostics = await stateDiagnostics({
    compounds: {
      a: { smiles: "[CH3:1][C:2](=[O:3])[C:4](=[O:5])[OH:6]", label: "" },
      b: { smiles: "[H-:7]", label: "" },
    },
    arrows: [
      { from: "charge(b:7)", to: "atom(a:2)", side: "right" },
      { from: "pi(a:2,a:3)", to: "atom(a:3)" },
    ],
  });
  assert.deepEqual(
    diagnostics.filter((d) => d.code === "ARROW_LABEL_OVERLAP"),
    [],
  );
});

test("atom annotations occupy free space outside neighboring bonds", async () => {
  const diagnostics = await stateDiagnostics({
    compounds: {
      structure: { smiles: "[CH3:1][N:2]([CH3:3])[CH2:4][CH2:5][OH:6]" },
    },
    labels: [{ id: "note", at: "structure:2", kind: "text", text: "Site" }],
  });
  assert.deepEqual(
    diagnostics.filter((d) => d.code === "BOND_LABEL_OVERLAP"),
    [],
  );
});

test("neighboring bond transfers retain a readable arc length and height", async () => {
  const diagnostics = await stateDiagnostics({
    compounds: {
      structure: { smiles: "[CH3:1][C@H:2]1[CH:3]=[CH:4][C@H:5]1[CH3:6]" },
    },
    arrows: [
      { from: "bond(5,2)", to: "bond(2,3)" },
      { from: "pi(3,4)", to: "bond(4,5)" },
    ],
  });
  assert.deepEqual(
    diagnostics.filter((d) =>
      ["ARROW_TOO_SHORT", "ARROW_TOO_FLAT"].includes(d.code),
    ),
    [],
  );
});

test("electron heads clear neighboring charge markers", async () => {
  const diagnostics = await stateDiagnostics({
    compounds: {
      a: {
        smiles: "[CH3:1][S+:2]([CH3:3])[CH2:4][CH:5]([O-:6])[CH3:7]",
        label: "",
      },
    },
    arrows: [
      { from: "charge(a:6)", to: "atom(a:4)" },
      { from: "bond(a:2,a:4)", to: "atom(a:2)" },
    ],
  });
  assert.deepEqual(
    diagnostics.filter((d) => d.code === "ARROW_HEAD_OVERLAP"),
    [],
  );
});

test("lone-pair donation clears adjacent substituent bonds", async () => {
  const diagnostics = await stateDiagnostics({
    compounds: {
      structure: { smiles: "[CH3:1][CH:2]([OH2+:3])[N:4]([CH3:5])[CH3:6]" },
    },
    arrows: [
      { from: "lp(4)", to: "bond(2,4)" },
      { from: "bond(2,3)", to: "atom(3)" },
    ],
  });
  assert.deepEqual(
    diagnostics.filter((d) =>
      ["ARROW_BOND_CROSSING", "BOND_LABEL_OVERLAP"].includes(d.code),
    ),
    [],
  );
});

test("aromatic triple-bond pi sources retain their molecular graph", async () => {
  const compiled = await compileFigure({
    kind: "scheme",
    states: {
      event: {
        arrows: [
          { from: "charge(7)", to: "atom(1)" },
          { from: "pi(1,6)", to: "atom(6)" },
        ],
        compounds: {
          structure: {
            smiles: "[c:1]1[cH:2][cH:3][cH:4][cH:5][c:6]#1.[NH2-:7]",
          },
        },
      },
    },
    arrows: {},
    views: { event: { items: ["event"] } },
  });
  const entry = figureEntry(compiled.entries[compiled.reference.ref]);
  const placement = drawingPanels(entry)[0].scene.molecules[0];
  const compound = compiled.entries[placement.compound];
  assert.ok(compound.kind === "compound");
  const { moleculeToolkit } = await import("../shared/molecule-toolkit.ts");
  const toolkit = await moleculeToolkit();
  const layout = compound.variants![placement.variant!];
  const molecule = toolkit.get_mol(
    layout.molblock!,
    JSON.stringify({ sanitize: false, removeHs: false }),
  )!;
  try {
    const graph = JSON.parse(molecule.get_json()).molecules[0];
    assert.equal(
      graph.bonds.filter((bond: { bo?: number }) => bond.bo === 3).length,
      1,
    );
    assert.equal(drawingPanels(entry)[0].scene.arrows?.length, 2);
  } finally {
    molecule.delete();
  }
});

test("independent mechanism panels retain the library's saved depiction", async () => {
  const gallery = await compileFigure({
    kind: "scheme",
    states: { a: { compounds: { a: "CCO" } } },
    arrows: {},
  });
  const compound = Object.values(gallery.entries).find(
    (entry) => entry.kind === "compound",
  )!;
  assert.ok(compound.kind === "compound");
  for (const point of Object.values(compound.layout.coords)) {
    const x = point.x;
    point.x = -point.y;
    point.y = x;
  }
  const compiled = await compileFigure(
    {
      kind: "scheme",
      states: { panel: { compounds: { a: "CCO" } } },
      arrows: {},
      views: { panel: { items: ["panel"] } },
    },
    gallery.entries,
    "panel",
  );
  const entry = figureEntry(compiled.entries[compiled.reference.ref]);
  const placement = drawingPanels(entry)[0].scene.molecules[0];
  const saved = compiled.entries[placement.compound];
  assert.ok(saved.kind === "compound");
  const layout = placement.variant
    ? saved.variants![placement.variant]
    : saved.layout;
  assert.deepEqual(layout.coords, compound.layout.coords);
});

test("fragment placement preserves the compound's shared default layout", async () => {
  const { moleculeToolkit } = await import("../shared/molecule-toolkit.ts");
  const compound = prepareCompound(await moleculeToolkit(), {
    id: "cmp_mixture",
    title: "Mixture",
    smiles: "CCO.N",
    sources: [{ source: "unknown", locator: "test", note: "Test fixture" }],
  });
  const compiled = await compileFigure(
    {
      kind: "scheme",
      states: { mixture: { compounds: { a: "CCO.N" } } },
      arrows: {},
      views: { mixture: { items: ["mixture"] } },
    },
    { [compound.id]: compound },
  );
  const saved = compiled.entries[compound.id];
  assert.ok(saved.kind === "compound");
  assert.equal(saved.layout.ionPairs, compound.layout.ionPairs);
  for (const [atom, point] of Object.entries(compound.layout.coords)) {
    assert.ok(Math.abs(saved.layout.coords[atom].x - point.x) < 0.001);
    assert.ok(Math.abs(saved.layout.coords[atom].y - point.y) < 0.001);
  }
});

test("reacting ends face each other across independent panels", async () => {
  const compiled = await compileFigure({
    kind: "scheme",
    states: {
      event: {
        arrows: [
          { from: "charge(b:9)", to: "between(b:9,a:2)" },
          { from: "pi(a:2,a:1)", to: "atom(a:1)" },
        ],
        compounds: {
          a: {
            smiles: "[O:1]=[CH:2][CH2:3][CH2:4][CH2:5][CH2:6][CH2:7][CH3:8]",
            rot: 180,
            label: "",
          },
          b: { smiles: "[OH-:9]", label: "" },
        },
      },
    },
    arrows: {},
    views: { event: { items: ["event"] } },
  });
  const { prepareFigure } = await import("../src/ui/library/prepare.ts");
  const { loadFigureFonts } = await import("../scripts/figure-fonts.ts");
  const { loadFigureStyle } = await import("../scripts/figure-route.ts");
  const { moleculeToolkit } = await import("../shared/molecule-toolkit.ts");
  const geometry = await prepareFigure(
    compiled.entries,
    { ...compiled.reference, frame: "event" },
    {
      toolkit: await moleculeToolkit(),
      fonts: await loadFigureFonts(),
      style: await loadFigureStyle(),
    },
  );
  const entry = figureEntry(compiled.entries[compiled.reference.ref]);
  const arrow = drawingPanels(entry)[0].scene.arrows![0];
  assert.ok(arrow.from.kind === "charge" && arrow.to.kind === "formingBond");
  const donor =
    geometry.atomPoints[`${arrow.from.at.molecule}:${arrow.from.at.atom}`];
  const acceptorRef = arrow.to.atoms.find((at) => at.molecule === "a")!;
  const acceptor = geometry.atomPoints[`a:${acceptorRef.atom}`];
  const xs = Object.entries(geometry.atomPoints)
    .filter(([key]) => key.startsWith("a:"))
    .map(([, point]) => point.x);
  const midpoint = (donor.x + acceptor.x) / 2;
  assert.ok(midpoint < Math.min(...xs) || midpoint > Math.max(...xs));
});

test("partial bonds bring two compounds together while using the named layout", async () => {
  const toolkit = await moleculeToolkit();
  const saved = prepareCompound(toolkit, {
    id: "cmp_contact",
    title: "Contact partner",
    sources: [{ source: "example", locator: "fixture" }],
    smiles: "C=C",
  });
  saved.variants = { contact: structuredClone(saved.layout) };
  const compiled = await compileFigure(
    {
      kind: "scheme",
      states: {
        contact: {
          partialBonds: [
            { from: "a:1", to: "b:1" },
            { from: "b:2", to: "a:4" },
          ],
          compounds: {
            a: { smiles: "[CH2:1]=[CH:2][CH:3]=[CH2:4]", label: "" },
            b: { smiles: "[CH2:1]=[CH2:2]", label: "", variant: "contact" },
          },
        },
      },
      arrows: {},
      views: { contact: { items: ["contact"] } },
    },
    { [saved.id]: saved },
  );
  const entry = figureEntry(compiled.entries[compiled.reference.ref]);
  const scene = drawingPanels(entry)[0].scene;
  assert.equal(scene.molecules[1].compound, saved.id);
  assert.equal(scene.molecules[1].variant, "contact");
  const retained = compiled.entries[saved.id];
  assert.ok(retained.kind === "compound");
  assert.deepEqual(retained.variants?.contact, saved.variants.contact);
  const style = await loadFigureStyle();
  const geometry = await prepareLibraryFigure(
    compiled.entries,
    compiled.reference,
    style,
  );
  const bond = parseFloat(style.values["--chemical-bond"]);
  for (const { atoms } of scene.partialBonds!) {
    const [a, b] = atoms.map(
      ({ molecule, atom }) => geometry.atomPoints[`${molecule}:${atom}`],
    );
    const length = Math.hypot(a.x - b.x, a.y - b.y) / bond;
    assert.ok(length >= 1 && length < 2, `Contact is ${length} bond lengths`);
  }
});

test("compilation rejects a partial bond whose placements all run through another atom", async () => {
  const smiles = "[C:1]([CH3:2])([CH3:3])([CH3:4])[CH3:5]";
  const saved = prepareCompound(await moleculeToolkit(), {
    id: "cmp_surrounded",
    title: "Surrounded atom",
    sources: [{ source: "example", locator: "fixture" }],
    smiles,
  });
  saved.variants = {
    surrounded: {
      coords: {
        a1: { x: 0, y: 0 },
        a2: { x: 1, y: 0 },
        a3: { x: -1, y: 0 },
        a4: { x: 0, y: 1 },
        a5: { x: 0, y: -1 },
      },
    },
  };
  await assert.rejects(
    compileFigure(
      {
        kind: "scheme",
        states: {
          blocked: {
            partialBonds: [{ from: "fixed:1", to: "moving:6" }],
            compounds: {
              fixed: { smiles, variant: "surrounded" },
              moving: "[Li+:6]",
            },
          },
        },
        arrows: {},
        views: { blocked: { items: ["blocked"] } },
      },
      { [saved.id]: saved },
    ),
    /no clear placement for partial bonds/i,
  );
});

test("terminal charged atom hydrogens face away from their bond", async () => {
  const diagnostics = await stateDiagnostics({
    compounds: {
      structure: {
        smiles: "[OH2+:1]/[N:2]=[C:3]1/[CH2:4][CH2:5][CH2:6][CH2:7][CH2:8]1",
      },
    },
    arrows: [
      { from: "bond(1,2)", to: "atom(1)" },
      { from: "bond(8,3)", to: "atom(2)" },
    ],
  });
  assert.deepEqual(
    diagnostics.filter((d) => d.code === "BOND_LABEL_OVERLAP"),
    [],
  );
});

test("a route step renders its mechanism in place and can reference one frame", async () => {
  const result = await compileFigure({
    kind: "scheme",
    states: {
      alcohol: {
        compounds: {
          structure: { smiles: "[CH3:1][OH:2]", label: 1, name: "Alcohol" },
        },
      },
      anion: {
        compounds: { structure: { label: "anion", smiles: "[CH3:1][O-:2]" } },
      },
      ether: { compounds: { structure: { label: "ether", smiles: "COC" } } },
    },
    arrows: {
      transfer: {
        from: [{ state: "alcohol", id: "alcohol" }],
        to: [{ state: "anion", id: "product-anion" }],
        kind: "forward",
        role: "reaction",
        via: {
          states: {
            start: {
              arrows: [
                {
                  id: "shift",
                  from: "bond(donor:1,donor:2)",
                  to: "atom(donor:2)",
                },
              ],
              compounds: { donor: { use: "alcohol" + "/structure" } },
            },
            intermediate: {
              compounds: {
                donor: { use: "alcohol" + "/structure" },
                solvent: "O",
              },
            },
            end: { compounds: { donor: { use: "anion" + "/structure" } } },
          },
          arrows: {
            ["next-" + "start"]: {
              from: "start",
              to: "intermediate",
              kind: "forward",
              role: "elementary",
            },
            ["next-" + "intermediate"]: {
              from: "intermediate",
              to: "end",
              kind: "forward",
              role: "elementary",
            },
          },
          views: {
            start: { items: ["start"] },
            intermediate: { items: ["intermediate"] },
            end: { items: ["end"] },
          },
          bind: {
            from: { ["alcohol" + "/structure"]: "start" + "/" + "donor" },
            to: { ["anion" + "/structure"]: "end" + "/" + "donor" },
          },
        },
      },
      finish: {
        from: [{ state: "anion", id: "anion" }],
        to: [{ state: "ether", id: "product-ether" }],
        kind: "forward",
        role: "reaction",
      },
    },
  });
  const { entries, reference } = result;
  const route = figureEntry(entries[reference.ref]);
  const step = route.graph.arrows.transfer;
  const via = step.via!;
  assert.equal(
    graphPanels(via)[0].scene.molecules[0].compound,
    appearances(step.from)[0].compound,
  );
  assert.equal(
    Object.values(via.arrows).flatMap(({ map }) => map ?? []).length,
    4,
  );
  assert.equal(step.to[0].state, route.graph.arrows.finish.from[0].state);
  const local = {
    ...reference,
    numbers: { "transfer/start/donor": "A" },
    focus: {
      primary: { atoms: [{ molecule: "transfer/start/donor", atom: "a2" }] },
    },
  };
  validateFigureInstance(entries, local);
  const style = await loadFigureStyle();
  const drawing = await prepareLibraryFigure(entries, local, style);
  const visible = drawing.cardPlans!.at(-1)!.geometry;
  const attributes = (geometry: typeof drawing, name: string) => {
    const values: string[] = [];
    walkGeometry(geometry.root, (node) => {
      if (node.attributes[name]) values.push(node.attributes[name]);
    });
    return values;
  };
  assert.deepEqual(attributes(visible, "data-frame"), ["intermediate"]);
  assert.ok(
    attributes(visible, "data-arrow-head").includes("transfer/start/shift"),
  );
  assert.ok(
    attributes(visible, "data-label").includes("transfer/alcohol:number:0"),
  );
  assert.ok(
    attributes(visible, "data-reaction-arrow").includes("finish/finish"),
  );
  assert.ok(
    attributes(visible, "data-reaction-arrow").includes("transfer/transfer"),
  );

  assert.ok(
    attributes(visible, "data-reaction-arrow").includes(
      "transfer/next-intermediate",
    ),
  );
  const selected = {
    ...reference,
    frame: "transfer/end",
    numbers: { donor: "B" },
  };
  validateFigureInstance(entries, selected);
  const independent = await prepareLibraryFigure(entries, selected, style);
  assert.deepEqual(attributes(independent, "data-molecule"), ["donor"]);
  assert.deepEqual(attributes(independent, "data-number"), ["donor:number"]);
});
