import { pathContours } from "../src/ui/library/path-geometry.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  prepareCompound,
  validateCompound,
  drawingMolecule,
  graphSignature,
  placedCoordinates,
} from "../shared/chemical-library/chemistry.ts";
import { scaffoldLayout } from "../scripts/figure-scaffolds.ts";
import { conformations, scaffolds } from "../scripts/figure-template-data.ts";
import { compileFigure } from "../scripts/figure-scene.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
import { geometrySvg } from "../src/ui/library/geometry-tree.ts";
import { loadFigureFonts } from "../scripts/figure-fonts.ts";
import { validateLibraryEntry } from "../shared/chemical-library/contract.ts";
import { figureStyle as style } from "./fixtures/figures/style.ts";
import { figureGeometryDiagnostics } from "../src/ui/library/geometry-diagnostics.ts";
import type { Conformation } from "../shared/chemical-library/types.ts";
import { walkGeometry } from "../src/ui/library/geometry-walk.ts";
const toolkit = await moleculeToolkit(),
  fonts = await loadFigureFonts();
const sources = [
  {
    source: "unknown",
    locator: "Neutral example",
    note: "Template geometry test",
  },
];

test("registered skeletal views retain chemical identity through native wedging and mirrored placement", () => {
  for (const data of scaffolds) {
    const c = prepareCompound(toolkit, {
      id: "cmp_example",
      title: "Example",
      smiles: "C" + data.smiles,
      sources,
    });
    for (const mode of ["flat", "perspective"] as const) {
      c.layout = scaffoldLayout(toolkit, c, mode);
      validateLibraryEntry(c);
      validateCompound(toolkit, c);
      assert.equal(c.layout.scaffold?.id, data.id);
      for (const mirror of [false, true]) {
        const points = placedCoordinates(toolkit, c, c.layout, 35, mirror),
          mol = drawingMolecule(toolkit, c, points, c.layout, 35, mirror);
        try {
          assert.equal(graphSignature(toolkit, mol), c.graph);
        } finally {
          mol.delete();
        }
      }
    }
  }
});

test("drawing selects a matched scaffold in route and mechanism compilation", async () => {
  const smiles = "C1CC2CCC1C2";
  const ordinary = await compileFigure({
    compounds: { a: smiles, b: smiles },
    steps: [{ from: "a", to: "b" }],
  });
  for (const e of Object.values(ordinary.entries))
    if (e.kind === "compound")
      for (const l of [e.layout, ...Object.values(e.variants ?? {})])
        assert.equal(l.scaffold, undefined);
  for (const kind of ["route", "mechanism"]) {
    const input =
      kind === "route"
        ? {
            compounds: {
              a: { smiles, drawing: "perspective" },
              b: { smiles, drawing: "flat" },
            },
            steps: [{ from: "a", to: "b" }],
          }
        : {
            kind: "mechanism",
            frames: [
              { id: "one", smiles, drawing: "perspective" },
              { id: "two", smiles, drawing: "flat" },
            ],
          };
    const result = await compileFigure(input);
    const modes = Object.values(result.entries).flatMap((e) =>
      e.kind === "compound"
        ? Object.values(e.variants ?? {}).flatMap((l) =>
            l.scaffold ? [l.scaffold.drawing] : [],
          )
        : [],
    );
    assert.ok(modes.includes("perspective"));
    assert.ok(modes.includes("flat"));
  }
  await assert.rejects(
    compileFigure({
      compounds: { a: { smiles: "CCO", drawing: "perspective" }, b: "CC=O" },
      steps: [{ from: "a", to: "b" }],
    }),
    /no registered scaffold/,
  );
});

test("all saved ring and generated projection templates render as graph-free library entries", async () => {
  for (const template of [
    ...conformations.keys(),
    "newman",
    "fischer",
    "sawhorse",
  ]) {
    const entry: Conformation = {
      id: "cnf_example",
      kind: "conformation",
      title: "Example",
      sources,
      template,
      slots: true,
    };
    validateLibraryEntry(entry);
    const geometry = await prepareFigure(
      { [entry.id]: entry },
      { ref: entry.id },
      { toolkit, fonts, style },
    );
    assert.ok(geometry.width > 0 && geometry.height > 0);
    assert.ok(geometrySvg(geometry).includes("data-conformation"));
  }
  const compiled = await compileFigure(
    {
      kind: "conformation",
      template: "chair",
      subs: { "1a": "CH3", "1e": "H" },
      sources,
    },
    {},
    "neutral",
  );
  const entry = compiled.entries[compiled.reference.ref];
  assert.equal(entry.kind, "conformation");
  if (entry.kind !== "conformation") return;
  assert.equal(entry.template, "chair");
  const count = (
    await prepareFigure(compiled.entries, compiled.reference, {
      toolkit,
      fonts,
      style,
    })
  ).atomPoints;
  assert.equal(Object.keys(count).length, 0);
});

test("chair inversion keeps the substituent face while exchanging axial and equatorial rays", async () => {
  const at = async (flip: boolean) => {
    const entry: Conformation = {
      id: "cnf_example",
      kind: "conformation",
      title: "Example",
      sources,
      template: "chair",
      flip,
      subs: { "1a": "CH3" },
    };
    const g = await prepareFigure(
      { [entry.id]: entry },
      { ref: entry.id },
      { toolkit, fonts, style },
    );
    const shafts: string[] = [];
    walkGeometry(g.root, (n) => {
      if (n.kind === "path" && n.paint.stroke !== "none") shafts.push(n.d);
    });
    assert.equal(shafts.length, 7);
    const points = pathContours(shafts.at(-1)!)[0].points;
    return { x: points[1].x - points[0].x, y: points[1].y - points[0].y };
  };
  const axial = await at(false),
    equatorial = await at(true);
  assert.ok(Math.abs(axial.x) < 0.001 && axial.y < 0);
  assert.ok(Math.abs(equatorial.x) > 1 && equatorial.y < 0);
});

test("template projection lengths are accepted while an external stretched substituent is diagnosed", async () => {
  const c = prepareCompound(toolkit, {
    id: "cmp_example",
    title: "Example",
    smiles: "CC1CC2CCC1CC2",
    sources,
  });
  c.layout = scaffoldLayout(toolkit, c, "perspective");
  const diagnose = async () =>
    figureGeometryDiagnostics(
      await prepareFigure(
        { [c.id]: c },
        { ref: c.id },
        { toolkit, fonts, style },
      ),
      style,
    );
  assert.ok(!(await diagnose()).some((d) => d.code === "BOND_TOO_LONG"));
  const p = c.layout.coords[c.atomIds[0]],
    q = c.layout.coords[c.atomIds[1]];
  p.x = q.x + (p.x - q.x) * 3;
  p.y = q.y + (p.y - q.y) * 3;
  assert.ok((await diagnose()).some((d) => d.code === "BOND_TOO_LONG"));
});

test("crossing gaps remove complete hidden hatch fragments without leaving invisible clipped ink", async () => {
  const c = prepareCompound(toolkit, {
    id: "cmp_example",
    title: "Example",
    smiles: "C1C[C@H]2C[C@@H]1C=C2",
    sources,
  });
  c.layout = scaffoldLayout(toolkit, c, "perspective");
  const geometry = await prepareFigure(
    { [c.id]: c },
    { ref: c.id },
    { toolkit, fonts, style },
  );
  assert.ok(
    !figureGeometryDiagnostics(geometry, style).some(
      (d) => d.code === "CLIPPED_INK",
    ),
  );
  const empty: string[] = [];
  walkGeometry(geometry.root, (n) => {
    if (n.kind === "path" && n.attributes["data-bond"] && !n.d.trim())
      empty.push(n.attributes["data-bond"]);
  });
  assert.equal(empty.length, 0);
});

test("conformation labels follow their own slot endpoints", async () => {
  const entry: Conformation = {
    id: "cnf_example",
    kind: "conformation",
    title: "Example",
    sources,
    template: "chair",
    subs: { "1a": "CH3", "1e": "H" },
  };
  const g = await prepareFigure(
    { [entry.id]: entry },
    { ref: entry.id },
    { toolkit, fonts, style },
  );
  const labels = new Map<string, number>();
  walkGeometry(g.root, (n) => {
    if (n.kind === "text" && n.bounds)
      labels.set(n.text, n.bounds.y + n.bounds.height / 2);
  });
  assert.ok(labels.get("CH3")! < labels.get("H")! - 20);
});

test("template structures participate in routes, panels and mechanism frames", async () => {
  const chair = {
    template: "chair",
    subs: { "1a": { t: "CH3", color: "#c00" } },
    bracket: "ts",
  };
  for (const input of [
    {
      compounds: { a: "CCO", b: chair, c: "CC=O" },
      steps: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    },
    {
      kind: "gallery",
      compounds: {
        a: chair,
        b: { template: "newman", front: ["H", "H", "CH3"] },
      },
    },
    {
      kind: "mechanism",
      frames: [
        { id: "a", ...chair, above: "Heat", explain: "First view" },
        { id: "b", ...chair, flip: true },
      ],
    },
  ]) {
    const result = await compileFigure(input, {}, "embedded");
    const entry = result.entries[result.reference.ref];
    const refs =
      entry.kind === "mechanism"
        ? entry.frames.map((f) => ({ ...result.reference, frame: f.id }))
        : [result.reference];
    for (const ref of refs) {
      const geometry = await prepareFigure(result.entries, ref, {
        toolkit,
        fonts,
        style,
      });
      const svg = geometrySvg(geometry);
      assert.ok(svg.includes('data-conformation="chair"'));
      assert.ok(svg.includes("#c00"));
      assert.ok(geometry.width > 0 && geometry.height > 0);
      const labels: string[] = [];
      walkGeometry(geometry.root, (n) => {
        const id = n.attributes["data-label"];
        if (id?.includes(":text")) labels.push(id);
      });
      assert.equal(new Set(labels).size, labels.length);
      if (entry.kind === "route") assert.ok(svg.includes("data-number"));
    }
    assert.deepEqual(
      (await compileFigure(input, result.entries, "embedded")).entries,
      result.entries,
    );
  }
});

test("ring hydrogen defaults and structure overrides are saved per depiction", async () => {
  const smiles = "C1CC[C@H]2CCCC[C@@H]2C1";
  const result = await compileFigure({
    kind: "gallery",
    ring_h: false,
    compounds: { a: { smiles }, b: { smiles, ring_h: true } },
  });
  const entry = result.entries[result.reference.ref];
  assert.equal(entry.kind, "mechanism");
  if (entry.kind !== "mechanism") return;
  const layouts = entry.frames[0].scene.molecules.map((p) => {
    const c = result.entries[p.compound];
    assert.equal(c.kind, "compound");
    if (c.kind !== "compound") throw new Error("Expected compound");
    return p.variant ? c.variants![p.variant] : c.layout;
  });
  assert.deepEqual(
    layouts.map((l) => l.ringHydrogens),
    [false, true],
  );
  const counts = [];
  for (const p of entry.frames[0].scene.molecules) {
    const c = result.entries[p.compound];
    assert.equal(c.kind, "compound");
    if (c.kind !== "compound") continue;
    const geometry = await prepareFigure(
      result.entries,
      { ref: c.id, variant: p.variant },
      { toolkit, fonts, style },
    );
    const bonds = new Set<string>();
    walkGeometry(geometry.root, (n) => {
      if (n.attributes["data-bond"]) bonds.add(n.attributes["data-bond"]);
    });
    counts.push(bonds.size);
  }
  assert.ok(counts[1] > counts[0]);
});

test("flat skeletal views separate external groups and keep linear branches straight", () => {
  for (const stereoGroup of ["", " |&1:2|"]) {
    const c = prepareCompound(toolkit, {
      id: "cmp_example",
      title: "Example",
      sources,
      smiles: "C#C[C@]1(O)CCC2C3CCC4CCCCC4C3CCC12C" + stereoGroup,
    });
    c.layout = scaffoldLayout(toolkit, c, "flat");
    const root = c.layout.coords[c.atomIds[2]],
      hydroxyl = c.layout.coords[c.atomIds[3]],
      first = c.layout.coords[c.atomIds[1]],
      last = c.layout.coords[c.atomIds[0]];
    assert.ok(Math.hypot(first.x - hydroxyl.x, first.y - hydroxyl.y) > 0.8);
    assert.ok(first.x < root.x && hydroxyl.x > root.x);
    const a = [first.x - root.x, first.y - root.y],
      b = [last.x - first.x, last.y - first.y];
    assert.ok(Math.abs(a[0] * b[1] - a[1] * b[0]) < 0.01);
    assert.ok(a[0] * b[0] + a[1] * b[1] > 0.9);
    const angular = c.layout.coords[c.atomIds.at(-1)!],
      junction = c.layout.coords[c.atomIds.at(-2)!];
    assert.ok(
      Math.abs(angular.x - junction.x) < 0.001 && angular.y < junction.y - 0.99,
    );
    assert.equal(
      c.layout.wedgeBonds!.filter((b) => b.from === c.atomIds[2]).length,
      2,
    );
    validateCompound(toolkit, c);
    const drawn = drawingMolecule(
      toolkit,
      c,
      placedCoordinates(toolkit, c, c.layout),
      c.layout,
    );
    try {
      assert.equal(graphSignature(toolkit, drawn), c.graph);
    } finally {
      drawn.delete();
    }
  }
});

test("flat skeletal side chains grow away from their attachment along the outward ray", () => {
  const c = prepareCompound(toolkit, {
    id: "cmp_example",
    title: "Example",
    sources,
    smiles: "C1(CCCCCCCC)CCC2C(C1)CCC1C2CCC2C1CCC2",
  });
  c.layout = scaffoldLayout(toolkit, c, "flat");
  const root = c.layout.coords[c.atomIds[0]],
    end = c.layout.coords[c.atomIds[8]],
    dx = end.x - root.x,
    dy = end.y - root.y;
  assert.ok(dx < -3);
  assert.ok((dx * -0.866025 + dy * 0.5) / Math.hypot(dx, dy) > 0.95);
});
