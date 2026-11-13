import { test } from "node:test";
import assert from "node:assert/strict";
import { compileFigure } from "../scripts/figure-scene.ts";
import type { Mechanism } from "../shared/chemical-library/types.ts";

test("mechanism frames retain participant identity and electron events", async () => {
  const result = await compileFigure({
    kind: "mechanism",
    category: "resonance",
    frames: [
      {
        id: "event",
        compounds: {
          donor: { smiles: "[OH-:1]", label: "Donor" },
          acceptor: { smiles: "[CH2:1]=[O:2]", label: "Acceptor" },
        },
        arrows: [
          {
            id: "attack",
            from: "lp(donor:1)",
            to: "between(donor:1,acceptor:1)",
          },
        ],
        labels: [
          { id: "polar", at: "acceptor:2", kind: "partialCharge", text: "δ−" },
        ],
        partialBonds: [{ from: "donor:1", to: "acceptor:1" }],
        focus: { primary: ["attack"] },
      },
    ],
  });
  const entry = result.entries[result.reference.ref] as Mechanism;
  assert.equal(entry.category, "resonance");
  const scene = entry.frames[0].scene;
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
    kind: "mechanism",
    category: "examples",
    frames: [
      {
        id: "before",
        compounds: { input: { smiles: "[CH3:1][OH:2]", label: "Input" } },
      },
      {
        id: "after",
        compounds: {
          reactant: {
            smiles: "[CH3:1][OH:2]",
            label: "Input",
            arrows: [{ id: "cleavage", from: "bond(1,2)", to: "atom(2)" }],
            focus: { primary: ["cleavage"] },
          },
          product: { smiles: "[CH2:1]=[O:2]", label: "Output" },
        },
        steps: [
          { from: "reactant", to: "product", above: "[O]", arrow: "forward" },
        ],
        map: { "input:1": "product:1", "input:2": "product:2" },
      },
    ],
  });
  const entry = result.entries[result.reference.ref] as Mechanism;
  assert.equal(entry.category, "examples");
  const scene = entry.frames[1].scene;
  const reactant = scene.molecules.find((m) => m.id === "reactant")!;
  const product = scene.molecules.find((m) => m.id === "product")!;
  assert.ok(reactant.at.x < product.at.x);
  assert.deepEqual(scene.reactionArrows?.[0].above, ["[O]"]);
  assert.equal(scene.reactionArrows?.[0].kind, "forward");
  assert.deepEqual(scene.focus?.primary?.arrows, ["reactant/cleavage"]);
  assert.deepEqual(
    entry.maps?.map((m) => [m.from.molecule, m.to.molecule]),
    [
      ["input", "product"],
      ["input", "product"],
    ],
  );
});

async function frameDiagnostics(
  frame: import("../scripts/figure-input.ts").FrameInput,
) {
  const { drawFigure } = await import("../scripts/figure-draw.ts");
  const compiled = await compileFigure({ kind: "mechanism", frames: [frame] });
  const diagnostics = [];
  for await (const rendered of drawFigure(compiled.entries, compiled.reference))
    diagnostics.push(...rendered.diagnostics);
  return diagnostics;
}

test("electron shafts leave their own lone pair clear", async () => {
  const diagnostics = await frameDiagnostics({
    id: "event",
    smiles: "[CH3:1][CH:2]=[O+:3][CH3:4].[CH3:5][OH:6]",
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
  const diagnostics = await frameDiagnostics({
    id: "event",
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
  const diagnostics = await frameDiagnostics({
    id: "event",
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
  const diagnostics = await frameDiagnostics({
    id: "event",
    smiles: "[CH3:1][N:2]([CH3:3])[CH2:4][CH2:5][OH:6]",
    labels: [{ id: "note", at: "structure:2", kind: "text", text: "Site" }],
  });
  assert.deepEqual(
    diagnostics.filter((d) => d.code === "BOND_LABEL_OVERLAP"),
    [],
  );
});

test("neighboring bond transfers retain a readable arc length and height", async () => {
  const diagnostics = await frameDiagnostics({
    id: "event",
    smiles: "[CH3:1][C@H:2]1[CH:3]=[CH:4][C@H:5]1[CH3:6]",
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
  const diagnostics = await frameDiagnostics({
    id: "event",
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
  const diagnostics = await frameDiagnostics({
    id: "event",
    smiles: "[CH3:1][CH:2]([OH2+:3])[N:4]([CH3:5])[CH3:6]",
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
    kind: "mechanism",
    frames: [
      {
        id: "event",
        smiles: "[c:1]1[cH:2][cH:3][cH:4][cH:5][c:6]#1.[NH2-:7]",
        arrows: [
          { from: "charge(7)", to: "atom(1)" },
          { from: "pi(1,6)", to: "atom(6)" },
        ],
      },
    ],
  });
  const entry = compiled.entries[compiled.reference.ref] as Mechanism;
  const placement = entry.frames[0].scene.molecules[0];
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
    assert.equal(entry.frames[0].scene.arrows?.length, 2);
  } finally {
    molecule.delete();
  }
});

test("independent mechanism panels retain the library's saved depiction", async () => {
  const gallery = await compileFigure({
    kind: "gallery",
    compounds: { a: "CCO" },
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
    { kind: "mechanism", frames: [{ id: "panel", compounds: { a: "CCO" } }] },
    gallery.entries,
    "panel",
  );
  const entry = compiled.entries[compiled.reference.ref] as Mechanism;
  const placement = entry.frames[0].scene.molecules[0];
  const saved = compiled.entries[placement.compound];
  assert.ok(saved.kind === "compound");
  const layout = placement.variant
    ? saved.variants![placement.variant]
    : saved.layout;
  assert.deepEqual(layout.coords, compound.layout.coords);
});

test("fragment placement preserves the compound's shared default layout", async () => {
  const { moleculeToolkit } = await import("../shared/molecule-toolkit.ts");
  const { prepareCompound } =
    await import("../shared/chemical-library/chemistry.ts");
  const compound = prepareCompound(await moleculeToolkit(), {
    id: "cmp_mixture",
    title: "Mixture",
    smiles: "CCO.N",
    sources: [{ source: "unknown", locator: "test", note: "Test fixture" }],
  });
  const compiled = await compileFigure(
    {
      kind: "mechanism",
      frames: [{ id: "mixture", compounds: { a: "CCO.N" } }],
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
    kind: "mechanism",
    frames: [
      {
        id: "event",
        compounds: {
          a: {
            smiles: "[O:1]=[CH:2][CH2:3][CH2:4][CH2:5][CH2:6][CH2:7][CH3:8]",
            rot: 180,
            label: "",
          },
          b: { smiles: "[OH-:9]", label: "" },
        },
        arrows: [
          { from: "charge(b:9)", to: "between(b:9,a:2)" },
          { from: "pi(a:2,a:1)", to: "atom(a:1)" },
        ],
      },
    ],
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
  const entry = compiled.entries[compiled.reference.ref] as Mechanism;
  const arrow = entry.frames[0].scene.arrows![0];
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

test("terminal charged atom hydrogens face away from their bond", async () => {
  const diagnostics = await frameDiagnostics({
    id: "event",
    smiles: "[OH2+:1]/[N:2]=[C:3]1/[CH2:4][CH2:5][CH2:6][CH2:7][CH2:8]1",
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
