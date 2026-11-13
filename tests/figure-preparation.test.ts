import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { compileFigure } from "../scripts/figure-scene.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { prepareCompound } from "../shared/chemical-library/chemistry.ts";
import { loadFigureFonts } from "../scripts/figure-fonts.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
import { figureStyle as style } from "./fixtures/figures/style.ts";
import { figureWorkerPool } from "../scripts/content/figure-worker-pool.ts";
import { isFigureGeometry } from "../src/ui/library/geometry-contract.ts";
import { geometrySvg } from "../src/ui/library/geometry-tree.ts";
import { figureGeometryDiagnostics } from "../src/ui/library/geometry-diagnostics.ts";
import { walkGeometry } from "../src/ui/library/geometry-walk.ts";
import { transformBox, unionBoxes } from "../src/ui/library/geometry-math.ts";
import type { FigureBox } from "../shared/chemical-library/geometry.ts";
const toolkit = await moleculeToolkit(),
  fonts = await loadFigureFonts();

test("electron events use the shared red accent and draw selected forming bonds", async () => {
  const compiled = await compileFigure({
    kind: "gallery",
    compounds: {
      event: {
        smiles: "[O-:1].[CH2:2]=[O:3]",
        arrows: [{ from: "lp(1)", to: "between(1,2)", forming: true }],
      },
    },
  });
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit,
    fonts,
    style,
  });
  let shafts = 0,
    heads = 0,
    forming = 0;
  walkGeometry(geometry.root, (node) => {
    if (node.attributes["data-electron-arrow"]) {
      shafts++;
      assert.equal(node.paint.stroke, style.values["--chemical-focus"]);
    }
    if (node.attributes["data-arrow-head"]) {
      heads++;
      assert.equal(node.paint.fill, style.values["--chemical-focus"]);
    }
    if (node.attributes["data-partial-bond"]) {
      forming++;
      assert.ok(node.paint.dashArray);
    }
  });
  assert.deepEqual([shafts, heads, forming], [1, 1, 1]);
});

test("rendering keeps the compiled contact placement of oppositely charged fragments", async () => {
  const compiled = await compileFigure({
    kind: "mechanism",
    frames: [
      {
        id: "event",
        smiles: "[O-:1].[H:2][O+:3]([H])[H]",
        arrows: [
          { from: "lp(1)", to: "atom(2)" },
          { from: "bond(2,3)", to: "atom(3)" },
        ],
      },
    ],
  });
  const entry = compiled.entries[compiled.reference.ref];
  assert.equal(entry.kind, "mechanism");
  const scene = entry.frames[0].scene,
    placement = scene.molecules[0],
    compound = compiled.entries[placement.compound];
  assert.equal(compound.kind, "compound");
  const coords = compound.variants![placement.variant!].coords;
  const arrow = scene.arrows![0];
  assert.equal(arrow.from.kind, "lonePair");
  assert.equal(arrow.to.kind, "atom");
  const from = arrow.from,
    label = scene.labels!.find((l) => l.id === from.label)!;
  const a = label.at.atom,
    b = arrow.to.at.atom;
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit,
    fonts,
    style,
  });
  const actualA = geometry.atomPoints["structure:" + a],
    actualB = geometry.atomPoints["structure:" + b];
  const bond = Number(style.values["--chemical-bond"].replace("px", ""));
  assert.ok(
    Math.abs(actualB.x - actualA.x - (coords[b].x - coords[a].x) * bond) < 0.2,
  );
  assert.ok(
    Math.abs(actualB.y - actualA.y - (coords[b].y - coords[a].y) * bond) < 0.2,
  );
});

test("structure scale enlarges rendered bonds while preserving label size", async () => {
  const render = async (scale: number) => {
    const compiled = await compileFigure({
      kind: "mechanism",
      frames: [{ id: "one", smiles: "CCO", scale }],
    });
    const geometry = await prepareFigure(compiled.entries, compiled.reference, {
      toolkit,
      fonts,
      style,
    });
    const bonds: number[] = [],
      labels: number[] = [];
    walkGeometry(geometry.root, (node) => {
      if (node.attributes["data-bond-lengths"])
        bonds.push(...JSON.parse(node.attributes["data-bond-lengths"]));
      if (node.attributes["data-label"] && node.bounds)
        labels.push(node.bounds.height);
    });
    return {
      bond: bonds.sort((a, b) => a - b)[Math.floor(bonds.length / 2)],
      labels,
    };
  };
  const plain = await render(1),
    enlarged = await render(1.5);
  assert.ok(Math.abs(enlarged.bond / plain.bond - 1.5) < 0.02);
  assert.equal(enlarged.labels.length, plain.labels.length);
  enlarged.labels.forEach((height, i) =>
    assert.ok(Math.abs(height - plain.labels[i]) < 0.01),
  );
});

test("fragment placement keeps vertical lone-pair clearances finite", async () => {
  const compiled = await compileFigure({
    kind: "mechanism",
    frames: [
      {
        id: "addition",
        smiles: "[O:1]=[C:2](OC)C.[CH3:3][NH2:4]",
        arrows: [
          { from: "lp(4)", to: "between(4,2)" },
          { from: "pi(1,2)", to: "atom(1)" },
        ],
      },
    ],
  });
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit,
    fonts,
    style,
  });
  assert.ok(isFigureGeometry(geometry));
  assert.ok(
    !figureGeometryDiagnostics(geometry, style).some(
      (d) => d.code === "BOND_LABEL_OVERLAP",
    ),
  );
});

test("electron head selection clears the complete halogen label", async () => {
  const compiled = await compileFigure({
    kind: "mechanism",
    frames: [
      {
        id: "leaving",
        smiles: "[CH3:1][Br:2]",
        arrows: [{ from: "bond(1,2)", to: "atom(2)" }],
      },
    ],
  });
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit,
    fonts,
    style,
  });
  assert.ok(
    !figureGeometryDiagnostics(geometry, style).some(
      (d) => d.code === "ARROW_HEAD_OVERLAP",
    ),
  );
});

test("reaction changes preserve normal ink on unmarked atoms and bonds", async () => {
  const compiled = await compileFigure({
    compounds: { a: "CCCO", b: "CCC=O" },
    steps: [{ from: "a", to: "b" }],
  });
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit,
    fonts,
    style,
  });
  const colors = new Set<string>();
  walkGeometry(geometry.root, (node) => {
    if (!node.attributes["data-bond"] && !node.attributes["data-label"]) return;
    for (const color of [node.paint.stroke, node.paint.fill]) {
      if (color === "none") continue;
      assert.ok(
        color === style.values["--chemical-ink"] ||
          color === style.values["--chemical-focus"],
        `Unexpected molecular ink ${color}`,
      );
      colors.add(color);
    }
  });
  assert.deepEqual(
    colors,
    new Set([style.values["--chemical-ink"], style.values["--chemical-focus"]]),
  );
});

test("a changed implicit carbon stereocentre visibly marks its solid or hashed wedge", async () => {
  for (const product of ["C[C@@H](F)CC", "C[C@H](F)CC"]) {
    const reactant = product.replace(
      product.includes("@@") ? "@@" : "@",
      product.includes("@@") ? "@" : "@@",
    );
    const compiled = await compileFigure({
      compounds: { a: reactant, b: product },
      steps: [{ from: "a", to: "b" }],
    });
    const geometry = await prepareFigure(compiled.entries, compiled.reference, {
      toolkit,
      fonts,
      style,
    });
    let redBonds = 0;
    walkGeometry(geometry.root, (node) => {
      if (
        node.attributes["data-bond"]?.startsWith("product-b:") &&
        (node.paint.fill === style.values["--chemical-focus"] ||
          node.paint.stroke === style.values["--chemical-focus"])
      )
        redBonds++;
    });
    assert.ok(redBonds > 0);
  }
});

test("enclosure diagnostics check boundaries while allowing interior labels and entering bonds", async () => {
  const { figureGroup, figurePath } =
    await import("../src/ui/library/geometry-tree.ts");
  const path = (d: string, attributes: Record<string, string>) => {
    const p = figurePath(d);
    p.attributes = attributes;
    p.paint.fill = "none";
    p.paint.stroke = "black";
    p.paint.strokeWidth = 1.6;
    return p;
  };
  const ring = path("M50 50H90V90H50Z", {
    "data-enclose": "selection",
    "data-enclose-atoms": "m:a1",
  });
  const inside = path("M65 65H75V75H65Z", { "data-label": "m:a1" });
  const entering = path("M70 70H115", {
    "data-bond": "m:b1",
    "data-atoms": "m:a1 m:a2",
  });
  const inspect = (extra: (typeof ring)[] = []) => {
    const root = figureGroup([ring, inside, entering, ...extra]);
    root.attributes["data-molecule"] = "m";
    return figureGeometryDiagnostics(
      {
        format: 1,
        width: 180,
        height: 180,
        minimumScale: 1,
        atomPoints: { "m:a1": { x: 70, y: 70 }, "m:a2": { x: 115, y: 70 } },
        root,
      },
      style,
    ).filter((d) => d.code.startsWith("ENCLOSURE_"));
  };
  assert.deepEqual(inspect(), []);
  for (const [attributes, code] of [
    [{ "data-label": "other" }, "ENCLOSURE_LABEL_OVERLAP"],
    [
      { "data-bond": "other", "data-atoms": "n:a1 n:a2" },
      "ENCLOSURE_BOND_OVERLAP",
    ],
    [{ "data-reaction-arrow": "other" }, "ENCLOSURE_ARROW_OVERLAP"],
    [
      { "data-enclose": "other", "data-enclose-atoms": "n:a1" },
      "ENCLOSURE_OVERLAP",
    ],
  ] as const) {
    const crossing = path("M85 60H100V80H85Z", attributes);
    assert.ok(inspect([crossing]).some((d) => d.code === code));
  }
});

test("enclosures require selected labels and atoms inside with a full ink gap", async () => {
  const { figureGroup, figurePath } =
    await import("../src/ui/library/geometry-tree.ts");
  const ring = figurePath("M20 20H80V80H20Z");
  ring.attributes = {
    "data-enclose": "explicit",
    "data-enclose-atoms": "m:a1",
  };
  ring.paint.fill = "none";
  ring.paint.strokeWidth = 1.6;
  const label = figurePath("M24 35H36V49H24Z");
  label.attributes["data-label"] = "m:a1";
  const root = figureGroup([ring, label]);
  root.attributes["data-molecule"] = "m";
  for (const [x, offset] of [
    [24, 0],
    [20, -10],
    [10, -25],
  ]) {
    label.transform = [1, 0, 0, 1, offset, 0];
    root.attributes["data-atom-points"] = JSON.stringify({
      "m:a1": { x, y: 42 },
    });
    const diagnostics = figureGeometryDiagnostics(
      {
        format: 1,
        width: 100,
        height: 100,
        minimumScale: 1,
        atomPoints: { "m:a1": { x, y: 42 } },
        root,
      },
      style,
    );
    assert.ok(diagnostics.some((d) => d.code === "ENCLOSURE_LABEL_OVERLAP"));
    assert.ok(diagnostics.some((d) => d.code === "ENCLOSURE_ATOM_OVERLAP"));
  }
});

test("automatic enclosures reject a shape that cannot clear a selected label and its neighbour", async () => {
  const { createFigureScene } =
    await import("../src/ui/library/scene-geometry.ts");
  const { drawEnclosure } =
    await import("../src/ui/library/geometry-enclosures.ts");
  const positions = { "m:a1": { x: 40, y: 40 }, "m:a2": { x: 60.5, y: 40 } };
  for (const shape of ["auto", "rect"] as const) {
    const ctx = createFigureScene(style, fonts);
    const root = ctx.element("g", {
      "data-molecule": "m",
      "data-atom-points": JSON.stringify(positions),
    });
    // The second path represents the label's lowered subscript.
    for (const d of ["M34 32H42V44H34Z", "M43 42H47V48H43Z"]) {
      const label = ctx.element("path", { d, "data-label": "m:a1" });
      ctx.append(root, label);
    }
    const bond = ctx.element("path", {
      d: "M47 40H60.5",
      "data-bond": "m:b1",
      "data-atoms": "m:a1 m:a2",
    });
    ctx.append(root, bond);
    const enclosures = drawEnclosure(
      { id: "selection", shape, atoms: [{ molecule: "m", atom: "a1" }] },
      positions,
      root,
      ctx,
      [["m:a1", "m:a2"]],
    );
    const diagnostics = figureGeometryDiagnostics(
      {
        format: 1,
        width: 100,
        height: 100,
        minimumScale: 1,
        atomPoints: positions,
        root,
      },
      style,
    ).filter((d) => d.code.startsWith("ENCLOSURE_"));
    if (shape === "auto") {
      assert.equal(enclosures.length, 0);
      assert.deepEqual(diagnostics, []);
      for (const label of ctx
        .nodes(root)
        .filter((n) => n.attributes["data-label"]))
        assert.equal(label.paint.fill, style.values["--chemical-focus"]);
    } else {
      assert.equal(enclosures[0].attributes["data-enclose-shape"], "rect");
      assert.ok(diagnostics.length > 0);
    }
  }
});

test("one failed component makes the entire selection use solid focus", async () => {
  const { createFigureScene } =
    await import("../src/ui/library/scene-geometry.ts");
  const { drawEnclosure } =
    await import("../src/ui/library/geometry-enclosures.ts");
  const ctx = createFigureScene(style, fonts);
  const positions = { "m:a1": { x: 40, y: 40 }, "m:a2": { x: 65, y: 40 } };
  const root = ctx.element("g", {
    "data-molecule": "m",
    "data-atom-points": JSON.stringify(positions),
  });
  for (const [id, p] of Object.entries(positions)) {
    ctx.append(
      root,
      ctx.element("path", { d: `M${p.x - 5} 35h10v10h-10Z`, "data-label": id }),
    );
  }
  const enclosures = drawEnclosure(
    {
      id: "selection",
      atoms: [
        { molecule: "m", atom: "a1" },
        { molecule: "m", atom: "a2" },
      ],
    },
    positions,
    root,
    ctx,
    [],
  );
  assert.equal(enclosures.length, 0);
  for (const label of ctx.nodes(root).filter((n) => n.attributes["data-label"]))
    assert.equal(label.paint.fill, style.values["--chemical-focus"]);
  assert.deepEqual(
    figureGeometryDiagnostics(
      {
        format: 1,
        width: 100,
        height: 100,
        minimumScale: 1,
        atomPoints: positions,
        root,
      },
      style,
    ),
    [],
  );
});

test("automatic circles avoid unrelated bonds while explicit circles report their collision", async () => {
  const { createFigureScene } =
    await import("../src/ui/library/scene-geometry.ts");
  const { drawEnclosure } =
    await import("../src/ui/library/geometry-enclosures.ts");
  const positions = {
    "m:a1": { x: 20, y: 20 },
    "m:a2": { x: 60, y: 20 },
    "m:a3": { x: 60, y: 60 },
    "m:a4": { x: 20, y: 60 },
  };
  for (const shape of ["circle", "auto"] as const) {
    const ctx = createFigureScene(style, fonts),
      root = ctx.element("g", { "data-molecule": "m" });
    const bond = ctx.element("path", {
      d: "M6 20V60",
      "data-bond": "m:outside",
      "data-atoms": "m:a5 m:a6",
    });
    ctx.setStyle(bond, "stroke", "var(--chemical-ink)");
    ctx.setStyle(bond, "strokeWidth", "var(--chemical-line)");
    ctx.append(root, bond);
    const [enclosure] = drawEnclosure(
      {
        id: "selection",
        atoms: [1, 2, 3, 4].map((i) => ({ molecule: "m", atom: `a${i}` })),
        shape,
      },
      positions,
      root,
      ctx,
      [
        ["m:a1", "m:a2"],
        ["m:a2", "m:a3"],
        ["m:a3", "m:a4"],
      ],
    );
    const diagnostics = figureGeometryDiagnostics(
      {
        format: 1,
        width: 120,
        height: 120,
        minimumScale: 1,
        atomPoints: positions,
        root,
      },
      style,
    ).filter((d) => d.code.startsWith("ENCLOSURE_"));
    if (shape === "circle")
      assert.ok(diagnostics.some((d) => d.code === "ENCLOSURE_BOND_OVERLAP"));
    else {
      assert.equal(enclosure.attributes["data-enclose-shape"], "rect");
      assert.deepEqual(diagnostics, []);
    }
  }
});

test("automatic enclosures exclude neighbouring atoms even across an exempt connecting bond", async () => {
  const { createFigureScene } =
    await import("../src/ui/library/scene-geometry.ts");
  const { drawEnclosure } =
    await import("../src/ui/library/geometry-enclosures.ts");
  const positions = {
    "m:a1": { x: 20, y: 20 },
    "m:a2": { x: 60, y: 20 },
    "m:a3": { x: 60, y: 60 },
    "m:a4": { x: 20, y: 60 },
    "m:a5": { x: 5, y: 40 },
  };
  for (const shape of ["auto", "circle"] as const) {
    const ctx = createFigureScene(style, fonts),
      root = ctx.element("g", {
        "data-molecule": "m",
        "data-atom-points": JSON.stringify(positions),
      });
    const bond = ctx.element("path", {
      d: "M20 20L5 40",
      "data-bond": "m:connecting",
      "data-atoms": "m:a1 m:a5",
    });
    ctx.setStyle(bond, "stroke", "var(--chemical-ink)");
    ctx.setStyle(bond, "strokeWidth", "var(--chemical-line)");
    ctx.append(root, bond);
    const [enclosure] = drawEnclosure(
      {
        id: "selection",
        atoms: [1, 2, 3, 4].map((i) => ({ molecule: "m", atom: `a${i}` })),
        shape,
      },
      positions,
      root,
      ctx,
      [
        ["m:a1", "m:a2"],
        ["m:a2", "m:a3"],
        ["m:a3", "m:a4"],
        ["m:a1", "m:a5"],
      ],
    );
    if (shape === "auto") assert.equal(enclosure, undefined);
    else assert.equal(enclosure.attributes["data-enclose-shape"], "circle");
    const diagnostics = figureGeometryDiagnostics(
      {
        format: 1,
        width: 120,
        height: 120,
        minimumScale: 1,
        atomPoints: positions,
        root,
      },
      style,
    ).filter((d) => d.code.startsWith("ENCLOSURE_"));
    if (shape === "auto") assert.deepEqual(diagnostics, []);
    else
      assert.ok(diagnostics.some((d) => d.code === "ENCLOSURE_ATOM_OVERLAP"));
  }
});

test("automatic enclosures keep a full gap from unselected label boxes", async () => {
  const { createFigureScene } =
    await import("../src/ui/library/scene-geometry.ts");
  const { drawEnclosure } =
    await import("../src/ui/library/geometry-enclosures.ts");
  const positions = {
    "m:a1": { x: 20, y: 20 },
    "m:a2": { x: 60, y: 20 },
    "m:a3": { x: 60, y: 60 },
    "m:a4": { x: 20, y: 60 },
    "m:a5": { x: -2, y: 40 },
  };
  for (const shape of ["auto", "circle"] as const) {
    const ctx = createFigureScene(style, fonts);
    const root = ctx.element("g", {
      "data-molecule": "m",
      "data-atom-points": JSON.stringify(positions),
    });
    const label = ctx.element("path", {
      d: "M-4 38H0V42H-4Z",
      "data-label": "m:a5",
    });
    ctx.append(root, label);
    const [enclosure] = drawEnclosure(
      {
        id: "selection",
        shape,
        atoms: [1, 2, 3, 4].map((i) => ({ molecule: "m", atom: `a${i}` })),
      },
      positions,
      root,
      ctx,
      [
        ["m:a1", "m:a2"],
        ["m:a2", "m:a3"],
        ["m:a3", "m:a4"],
      ],
    );
    assert.equal(
      enclosure.attributes["data-enclose-shape"],
      shape === "auto" ? "rect" : "circle",
    );
    const diagnostics = figureGeometryDiagnostics(
      {
        format: 1,
        width: 120,
        height: 120,
        minimumScale: 1,
        atomPoints: positions,
        root,
      },
      style,
    ).filter((d) => d.code.startsWith("ENCLOSURE_"));
    if (shape === "auto") assert.deepEqual(diagnostics, []);
    else
      assert.ok(diagnostics.some((d) => d.code === "ENCLOSURE_LABEL_OVERLAP"));
  }
});

test("a failing first component colors the entire selection with its focus style", async () => {
  const { createFigureScene } =
    await import("../src/ui/library/scene-geometry.ts");
  const { drawEnclosure } =
    await import("../src/ui/library/geometry-enclosures.ts");
  const positions = {
    "m:a1": { x: 20, y: 20 },
    "m:a2": { x: 20, y: 60 },
    "m:a3": { x: 60, y: 60 },
    "m:a4": { x: 60, y: 20 },
    "m:a5": { x: 40, y: 30 },
    "m:a6": { x: 140, y: 40 },
  };
  for (const emphasis of ["primary", "supporting"] as const) {
    const ctx = createFigureScene(style, fonts);
    const root = ctx.element("g", {
      "data-molecule": "m",
      "data-atom-points": JSON.stringify(positions),
    });
    const pairs = [
      [1, 2],
      [2, 3],
      [3, 4],
      [1, 5],
    ];
    const bonds = pairs.map(([a, b], i) => {
      const p = positions[`m:a${a}` as keyof typeof positions],
        q = positions[`m:a${b}` as keyof typeof positions];
      const node = ctx.element("path", {
        d: `M${p.x} ${p.y}L${q.x} ${q.y}`,
        "data-bond": `m:b${i}`,
        "data-atoms": `m:a${a} m:a${b}`,
      });
      ctx.setStyle(node, "stroke", "var(--chemical-ink)");
      ctx.setStyle(node, "fill", "none");
      ctx.setStyle(node, "strokeWidth", "var(--chemical-line)");
      ctx.append(root, node);
      return node;
    });
    const label = ctx.element("path", {
      d: "M18 18H22V22H18Z",
      "data-label": "m:a1",
    });
    ctx.setStyle(label, "fill", "var(--chemical-ink)");
    ctx.append(root, label);
    const otherLabel = ctx.element("path", {
      d: "M138 38H142V42H138Z",
      "data-label": "m:a6",
    });
    ctx.append(root, otherLabel);
    drawEnclosure(
      {
        id: "selection",
        atoms: [1, 2, 3, 4, 6].map((i) => ({ molecule: "m", atom: `a${i}` })),
        bonds: pairs.slice(0, 3).map(([a, b]) => [
          { molecule: "m", atom: `a${a}` },
          { molecule: "m", atom: `a${b}` },
        ]),
      },
      positions,
      root,
      ctx,
      pairs.map(([a, b]): [string, string] => [`m:a${a}`, `m:a${b}`]),
      emphasis,
    );
    const enclosures = ctx
      .nodes(root)
      .filter((n) => n.attributes["data-enclose"]);
    assert.equal(enclosures.length, 0);
    const color =
      style.values[
        emphasis === "primary" ? "--chemical-focus" : "--chemical-support"
      ];
    const width = parseFloat(
      style.values[
        emphasis === "primary"
          ? "--chemical-focus-line"
          : "--chemical-support-line"
      ],
    );
    for (const bond of bonds.slice(0, 3)) {
      assert.equal(bond.paint.stroke, color);
      assert.equal(bond.paint.strokeWidth, width);
    }
    assert.equal(label.paint.fill, color);
    assert.equal(otherLabel.paint.fill, color);
    assert.equal(bonds[3].paint.stroke, style.values["--chemical-ink"]);
    assert.deepEqual(
      figureGeometryDiagnostics(
        {
          format: 1,
          width: 180,
          height: 120,
          minimumScale: 1,
          atomPoints: positions,
          root,
        },
        style,
      ),
      [],
    );
  }
});

test("ring stereocentres use drawing-only hydrogen wedges without duplicating explicit isotopes", async () => {
  for (const [smiles, added] of [
    ["C1[C@H]2CC[C@@H]1C2", 2],
    ["C1C[C@H]2CCC[C@@H]2C1", 2],
    ["C[C@H]1CC[C@H](F)CC1", 0],
    ["C1C[C@]2([H])CCC[C@@H]2C1", 1],
    ["C1C[C@]2([2H])CCC[C@@H]2C1", 1],
  ] as const) {
    const c = prepareCompound(toolkit, {
      id: "cmp_ring",
      title: "Ring",
      smiles,
      sources: [{ source: "example", locator: "Figure 1" }],
    });
    const before = structuredClone(c);
    const geometry = await prepareFigure(
      { [c.id]: c },
      { ref: c.id },
      { toolkit, fonts, style },
    );
    const hydrogens = Object.keys(geometry.atomPoints).filter((id) =>
      id.includes(":hydrogen-"),
    );
    assert.equal(hydrogens.length, added);
    for (const hydrogen of hydrogens) {
      const wedges: string[] = [];
      walkGeometry(geometry.root, (node) => {
        if (
          node.attributes["data-atoms"]?.split(" ").includes(hydrogen) &&
          (node.paint.fill !== "none" || node.paint.dashArray)
        )
          wedges.push(node.attributes["data-bond"]);
      });
      // Solid wedges are filled; hashed wedges consist of several transverse paths.
      if (!wedges.length) {
        let strokes = 0;
        walkGeometry(geometry.root, (node) => {
          if (node.attributes["data-atoms"]?.split(" ").includes(hydrogen))
            strokes++;
        });
        assert.ok(strokes > 2);
      }
    }
    assert.deepEqual(c, before);
  }
});

test("scene enclosures surround visible labels without changing molecular ink or coordinates", async () => {
  const compiled = await compileFigure({
    kind: "mechanism",
    frames: [{ id: "one", smiles: "[CH3:1][CH2:2][OH:3]" }],
  });
  const entry = compiled.entries[compiled.reference.ref];
  assert.equal(entry.kind, "mechanism");
  const scene = entry.frames[0].scene;
  const molecule = scene.molecules[0];
  const compound = compiled.entries[molecule.compound];
  assert.equal(compound.kind, "compound");
  const oxygen = { molecule: molecule.id, atom: compound.atomIds[2] };
  const before = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit,
    fonts,
    style,
    canvas: "scene",
  });
  for (const shape of ["auto", "circle", "rect", "outline"] as const) {
    scene.enclose = [{ id: "site", atoms: [oxygen], shape }];
    const after = await prepareFigure(compiled.entries, compiled.reference, {
      toolkit,
      fonts,
      style,
      canvas: "scene",
    });
    assert.deepEqual(after.atomPoints, before.atomPoints);
    const circles: import("../shared/chemical-library/geometry.ts").FigureNode[] =
      [];
    walkGeometry(after.root, (node) => {
      if (node.attributes["data-enclose"]) circles.push(node);
    });
    assert.equal(circles.length, 1);
    const circle = circles[0];
    assert.equal(circle.paint.fill, "none");
    assert.equal(circle.paint.stroke, style.values["--chemical-focus"]);
    assert.equal(circle.paint.dashArray, "4 3");
    const labels: FigureBox[] = [];
    walkGeometry(after.root, (node, matrix) => {
      if (node.attributes["data-label"] === `${oxygen.molecule}:${oxygen.atom}`)
        labels.push(transformBox(node.bounds, matrix)!);
    });
    const label = unionBoxes(labels)!;
    assert.ok(circle.bounds!.x < label.x && circle.bounds!.y < label.y);
    assert.ok(circle.bounds!.x + circle.bounds!.width > label.x + label.width);
    assert.ok(
      circle.bounds!.y + circle.bounds!.height > label.y + label.height,
    );
    const withoutCircles = structuredClone(after);
    const remove = (
      node: import("../shared/chemical-library/geometry.ts").FigureNode,
    ) => {
      if (node.kind !== "group") return;
      node.children = node.children.filter(
        (child) => !child.attributes["data-enclose"],
      );
      node.children.forEach(remove);
    };
    remove(withoutCircles.root);
    assert.equal(geometrySvg(withoutCircles), geometrySvg(before));
  }
});

test("native bond ends clear complete labels at their final stroke width", async () => {
  for (const smiles of ["C[Mg]Br", "C[S+]C", "CC=O"]) {
    const c = prepareCompound(toolkit, {
      id: "cmp_example",
      title: "Example",
      smiles,
      sources: [{ source: "example", locator: "Structures" }],
    });
    const geometry = await prepareFigure(
      { [c.id]: c },
      {
        ref: c.id,
        ...(smiles === "CC=O"
          ? {
              focus: {
                primary: {
                  atoms: [{ molecule: "compound", atom: "a3" }],
                  bonds: [
                    [
                      { molecule: "compound", atom: "a2" },
                      { molecule: "compound", atom: "a3" },
                    ],
                  ],
                },
              },
            }
          : {}),
      },
      { toolkit, fonts, style },
    );
    assert.deepEqual(figureGeometryDiagnostics(geometry, style), [], smiles);
  }
});

test("automatic charge placement clears bond stroke edges", async () => {
  const c = prepareCompound(toolkit, {
    id: "cmp_example",
    title: "Example",
    smiles: "C[OH+]C",
    sources: [{ source: "example", locator: "Structures" }],
  });
  const angle = (4 * Math.PI) / 3;
  for (const p of Object.values(c.layout.coords)) {
    const { x, y } = p;
    p.x = x * Math.cos(angle) - y * Math.sin(angle);
    p.y = x * Math.sin(angle) + y * Math.cos(angle);
  }
  const geometry = await prepareFigure(
    { [c.id]: c },
    { ref: c.id },
    { toolkit, fonts, style },
  );
  assert.deepEqual(figureGeometryDiagnostics(geometry, style), []);
});

test("drawing hydrogens rotate clear of neighbouring stroke edges without stretching", async () => {
  const { createFigureScene } =
    await import("../src/ui/library/scene-geometry.ts");
  const { spaceChiralHydrogens } =
    await import("../src/ui/library/geometry-spacing.ts");
  const { inkIntersectsBox, pathContours } =
    await import("../src/ui/library/path-geometry.ts");
  const ctx = createFigureScene(style, fonts),
    g = ctx.element("g");
  const h = ctx.element("path", {
    d: "M28 -5h8v10h-8Z",
    class: "atom-3",
    "data-label": "m:hydrogen-0",
  });
  const wedge = ctx.element("path", {
    d: "M0 0L25 -2L25 2Z",
    class: "bond-2",
    "data-bond": "m:b2",
  });
  const neighbour = ctx.element("path", {
    d: "M25 5.6L40 5.6",
    "data-bond": "m:b0",
  });
  ctx.setStyle(neighbour, "fill", "none");
  ctx.setStyle(neighbour, "stroke", "var(--chemical-ink)");
  ctx.setStyle(neighbour, "strokeWidth", "1.6");
  ctx.append(g, h);
  ctx.append(g, wedge);
  ctx.append(g, neighbour);
  const positions = [
    { x: 0, y: 0 },
    { x: -16, y: 28 },
    { x: -16, y: -28 },
    { x: 32, y: 0 },
  ];
  spaceChiralHydrogens(
    g,
    positions,
    3,
    new Map([[2, [0, 3]]]),
    [{ atoms: [0, 1] }, { atoms: [0, 2] }],
    ctx,
  );
  assert.notEqual(positions[3].y, 0);
  assert.equal(
    inkIntersectsBox(pathContours(neighbour.d), ctx.inkBox(h, g), 1.6, false),
    false,
  );
  assert.ok(Math.abs(Math.hypot(positions[3].x, positions[3].y) - 32) < 1e-9);
  assert.deepEqual(positions.slice(0, 3), [
    { x: 0, y: 0 },
    { x: -16, y: 28 },
    { x: -16, y: -28 },
  ]);
});

test("bond strokes touching the edge of a complete ester label are rejected", async () => {
  const { createFigureScene } =
    await import("../src/ui/library/scene-geometry.ts");
  const { refreshGeometry } =
    await import("../src/ui/library/geometry-tree.ts");
  const ctx = createFigureScene(style, fonts),
    root = ctx.element("g", { "data-figure": "cmp_example" }),
    molecule = ctx.element("g", { "data-molecule": "example" });
  for (const [x, width] of [
    [50, 11],
    [63, 12],
    [77, 6],
    [85, 9],
    [96, 6],
  ]) {
    const glyph = ctx.element("path", {
      d: x === 77 ? "M77 62h6v9.5h-6Z" : `M${x} 50h${width}v15h-${width}Z`,
      "data-label": "example:a3",
      "data-label-text": "CO2Et",
    });
    ctx.append(molecule, glyph);
  }
  const bond = ctx.element("path", {
    d: "M30 80L50.4 60",
    "data-bond": "example:b0",
    "data-atoms": "example:a1 example:a2",
  });
  ctx.setStyle(bond, "fill", "none");
  ctx.setStyle(bond, "strokeWidth", "1.6");
  ctx.setStyle(bond, "stroke", "var(--chemical-ink)");
  ctx.append(molecule, bond);
  ctx.append(root, molecule);
  refreshGeometry(root);
  assert.ok(
    figureGeometryDiagnostics(
      {
        format: 1,
        root,
        width: 150,
        height: 100,
        minimumScale: 1,
        atomPoints: {},
      },
      style,
    ).some(
      (d) =>
        d.code === "BOND_LABEL_OVERLAP" && d.elements.includes("example:a3"),
    ),
  );
  // A self-connecting bond can cross the space between two outlined glyphs.
  assert.equal(bond.kind, "path");
  bond.d = "M62 40L62 70";
  ctx.set(bond, "data-atoms", "example:a1 example:a3");
  refreshGeometry(root);
  assert.ok(
    figureGeometryDiagnostics(
      {
        format: 1,
        root,
        width: 150,
        height: 100,
        minimumScale: 1,
        atomPoints: {},
      },
      style,
    ).some(
      (d) =>
        d.code === "BOND_LABEL_OVERLAP" && d.elements.includes("example:a3"),
    ),
  );
  // Entering only the blank area below the main row is valid for its own bond.
  bond.d = "M45 85L55 67.5";
  refreshGeometry(root);
  const diagnostics = () =>
    figureGeometryDiagnostics(
      {
        format: 1,
        root,
        width: 150,
        height: 100,
        minimumScale: 1,
        atomPoints: {},
      },
      style,
    );
  assert.ok(!diagnostics().some((d) => d.code === "BOND_LABEL_OVERLAP"));
  ctx.set(bond, "data-atoms", "example:a1 example:a2");
  assert.ok(diagnostics().some((d) => d.code === "BOND_LABEL_OVERLAP"));
});

test("a folded terminal group inside a separate ring is rejected", async () => {
  const c = prepareCompound(toolkit, {
    id: "cmp_example",
    title: "Example",
    smiles: "C1CCCCC1OS(=O)(=O)c1ccc(C)cc1",
    sources: [{ source: "example", locator: "Structures" }],
  });
  c.layout.abbreviations = ["OTs"];
  // A terminal O points into its attached ring while all ring atoms stay fixed.
  const ring = c.atomIds.slice(0, 6).map((id) => c.layout.coords[id]);
  c.layout.coords[c.atomIds[6]] = {
    x: ring.reduce((n, p) => n + p.x, 0) / 6,
    y: ring.reduce((n, p) => n + p.y, 0) / 6,
  };
  const geometry = await prepareFigure(
    { [c.id]: c },
    { ref: c.id },
    { toolkit, fonts, style },
  );
  assert.ok(
    figureGeometryDiagnostics(geometry, style).some(
      (d) => d.code === "LABEL_IN_RING",
    ),
  );
});

test("every saved compiler variant has its final label placement", async () => {
  const smiles = "CC(C)(C)OC(=O)N1CCCCC1";
  const c = prepareCompound(toolkit, {
    id: "cmp_example",
    title: "Example",
    smiles,
    sources: [{ source: "example", locator: "Structures" }],
  });
  const root = c.layout.coords[c.atomIds[5]],
    parent = c.layout.coords[c.atomIds[7]];
  const angle =
    (2 * Math.PI) / 3 - Math.atan2(root.y - parent.y, root.x - parent.x);
  for (const point of Object.values(c.layout.coords)) {
    const { x, y } = point;
    point.x = x * Math.cos(angle) - y * Math.sin(angle);
    point.y = x * Math.sin(angle) + y * Math.cos(angle);
  }
  const compiled = await compileFigure(
    {
      title: "Group transformation",
      compounds: { a: smiles, b: "N1CCCCC1" },
      steps: [{ from: "a", to: "b" }],
    },
    { [c.id]: c },
  );
  const saved = compiled.entries[c.id];
  assert.equal(saved.kind, "compound");
  assert.ok(Object.keys(saved.variants ?? {}).length > 0);
  for (const variant of Object.keys(saved.variants ?? {})) {
    const geometry = await prepareFigure(
      compiled.entries,
      { ref: c.id, variant },
      { toolkit, fonts, style },
    );
    assert.deepEqual(figureGeometryDiagnostics(geometry, style), [], variant);
  }
});

test("folded neutral nitro groups do not display their internal charges", async () => {
  const c = prepareCompound(toolkit, {
    id: "cmp_example",
    title: "Example",
    smiles: "c1ccccc1[N+](=O)[O-]",
    sources: [{ source: "example", locator: "Structures" }],
  });
  c.layout.abbreviations = ["NO2"];
  const geometry = await prepareFigure(
    { [c.id]: c },
    { ref: c.id },
    { toolkit, fonts, style },
  );
  const charges: string[] = [];
  walkGeometry(geometry.root, (node) => {
    if (node.attributes["data-charge-owner"])
      charges.push(node.attributes["data-charge-owner"]);
  });
  assert.deepEqual(charges, []);
});

test("an automatic lone pair aimed at its own bond clears the drawn bond", async () => {
  const compiled = await compileFigure({
    kind: "mechanism",
    frames: [
      {
        id: "first",
        smiles: "[O-:1][C:2]([CH3:4])=[CH2:3]",
        arrows: [{ from: "lp(1)", to: "bond(1,2)" }],
      },
    ],
  });
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit,
    fonts,
    style,
  });
  const pairs: string[] = [];
  walkGeometry(geometry.root, (node) => {
    if (node.attributes["data-label"]?.endsWith("-lp"))
      pairs.push(node.attributes["data-label"]);
  });
  assert.equal(pairs.length, 1);
  assert.ok(
    !figureGeometryDiagnostics(geometry, style).some(
      (d) => d.code === "BOND_LABEL_OVERLAP" && d.elements.includes(pairs[0]),
    ),
  );
});

test("bond diagnostics catch a stretched bond within an enlarged structure", async () => {
  const c = prepareCompound(toolkit, {
    id: "cmp_example",
    title: "Example",
    smiles: "CCCCCC",
    sources: [{ source: "example", locator: "Structures" }],
  });
  for (const p of Object.values(c.layout.coords)) {
    p.x *= 1.45;
    p.y *= 1.45;
  }
  const diagnostics = async () =>
    figureGeometryDiagnostics(
      await prepareFigure(
        { [c.id]: c },
        { ref: c.id },
        { toolkit, fonts, style },
      ),
      style,
    );
  assert.ok(!(await diagnostics()).some((d) => d.code === "BOND_TOO_LONG"));
  const p = c.layout.coords[c.atomIds[0]],
    q = c.layout.coords[c.atomIds[1]],
    dx = p.x - q.x,
    dy = p.y - q.y;
  p.x = q.x + Math.SQRT2 * dx;
  p.y = q.y + Math.SQRT2 * dy;
  assert.ok(!(await diagnostics()).some((d) => d.code === "BOND_TOO_LONG"));
  p.x = q.x + 2 * dx;
  p.y = q.y + 2 * dy;
  assert.ok((await diagnostics()).some((d) => d.code === "BOND_TOO_LONG"));
});

test("scene preparation handles reaction, route and mechanism fixtures without a browser", async () => {
  for (const name of [
    "linear",
    "convergent",
    "branched",
    "products",
    "comparison",
    "mechanism",
  ]) {
    const compiled = await compileFigure(
      parse(
        await readFile(
          new URL(`./fixtures/figures/${name}.yaml`, import.meta.url),
          "utf8",
        ),
      ),
    );
    const entry = compiled.entries[compiled.reference.ref];
    const references =
      entry.kind === "mechanism"
        ? entry.frames.map((frame) => ({
            ...compiled.reference,
            frame: frame.id,
          }))
        : [compiled.reference];
    for (const reference of references) {
      const geometry = await prepareFigure(compiled.entries, reference, {
        toolkit,
        fonts,
        style,
      });
      assert.ok(isFigureGeometry(geometry), name);
      assert.ok(geometry.width > 0 && geometry.height > 0, name);
      assert.ok(Object.keys(geometry.atomPoints).length > 0, name);
      const diagnostics = figureGeometryDiagnostics(
        geometry,
        style,
        Math.max(geometry.minimumScale, Math.min(1, 1318 / geometry.width)),
      );
      assert.ok(
        diagnostics.every((item) => item.code && item.object === entry.id),
        name,
      );
      assert.ok(geometrySvg(geometry).length > 100, name);
      assert.deepEqual(JSON.parse(JSON.stringify(geometry)), geometry, name);
    }
  }
});

test("worker preparation and diagnostics agree with direct Node execution", async () => {
  const compiled = await compileFigure(
    parse(
      await readFile(
        new URL("./fixtures/figures/mechanism.yaml", import.meta.url),
        "utf8",
      ),
    ),
  );
  const css = Object.entries(style.values)
    .map(([key, value]) => `${key}:${value};`)
    .join("\n");
  const pool = figureWorkerPool(css);
  try {
    const geometry = await pool.prepare(
      {
        kind: "prepare",
        library: compiled.entries,
        reference: compiled.reference,
      },
      0,
    );
    assert.deepEqual(
      geometry,
      await prepareFigure(compiled.entries, compiled.reference, {
        toolkit,
        fonts,
        style,
      }),
    );
    assert.deepEqual(
      await pool.diagnose(geometry, 0),
      figureGeometryDiagnostics(
        geometry,
        style,
        Math.max(geometry.minimumScale, Math.min(1, 1318 / geometry.width)),
      ),
    );
  } finally {
    await pool.close();
  }
});

test("geometry diagnostics retain overlap, clipping and minimum text thresholds", async () => {
  const { createFigureScene } =
    await import("../src/ui/library/scene-geometry.ts");
  const { refreshGeometry } =
    await import("../src/ui/library/geometry-tree.ts");
  const scene = createFigureScene(style, fonts),
    root = scene.element("g", { "data-figure": "cmp_example" }),
    molecule = scene.element("g", { "data-molecule": "compound" });
  scene.append(root, molecule);
  for (const [id, x, size] of [
    ["first", 20, 8],
    ["second", 20, 8],
    ["outside", -20, 20],
  ] as const) {
    const label = scene.label({ x, y: 30 }, "N", `${size}px`);
    scene.set(label, "data-label", id);
    scene.append(molecule, label);
  }
  refreshGeometry(root);
  const diagnostics = figureGeometryDiagnostics(
    { format: 1, width: 80, height: 80, minimumScale: 1, atomPoints: {}, root },
    style,
  );
  assert.deepEqual(
    diagnostics.map((d) => ({
      code: d.code,
      elements: d.elements,
      actual: d.actual,
      required: d.required,
    })),
    [
      {
        code: "LABEL_OVERLAP",
        elements: ["first", "second"],
        actual: undefined,
        required: undefined,
      },
      { code: "TEXT_TOO_SMALL", elements: ["first"], actual: 8, required: 11 },
      { code: "TEXT_TOO_SMALL", elements: ["second"], actual: 8, required: 11 },
      {
        code: "CLIPPED_LABEL",
        elements: ["outside"],
        actual: undefined,
        required: undefined,
      },
    ],
  );
});

test("wrapping measures SVG text without a trailing space", async () => {
  const compiled = await compileFigure(
    parse(
      await readFile(
        new URL("./fixtures/figures/products.yaml", import.meta.url),
        "utf8",
      ),
    ),
  );
  const entry = compiled.entries[compiled.reference.ref];
  if (entry.kind !== "reaction") throw new Error("Expected reaction fixture");
  const { createFigureScene } =
    await import("../src/ui/library/scene-geometry.ts");
  const scene = createFigureScene(style, fonts);
  entry.conditions = ["AAAA BBBB CCCC DDDD"];
  entry.arrow.textWidth =
    (scene.label(
      { x: 0, y: 0 },
      "AAAA BBBB CCCC",
      "var(--chemical-caption-font)",
    ).advance +
      0.1) /
    32;
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit,
    fonts,
    style,
  });
  const { walkGeometry } = await import("../src/ui/library/geometry-walk.ts"),
    lines: string[] = [];
  walkGeometry(geometry.root, (node) => {
    if (
      node.kind === "text" &&
      node.attributes["data-label"]?.startsWith(entry.id + ":condition:1:")
    )
      lines.push(node.text);
  });
  assert.deepEqual(lines, ["AAAA BBBB CCCC", "DDDD"]);
});

test("SVG subscript line boxes follow the central baseline", async () => {
  const { createFigureScene } =
    await import("../src/ui/library/scene-geometry.ts");
  const scene = createFigureScene(style, fonts);
  for (const [size, y, height] of [
    [17, -9.5, 23.5],
    [20, -11, 27],
  ]) {
    const node = scene.label({ x: 0, y: 0 }, "H₂O", `${size}px`);
    assert.equal(node.bounds!.y, y);
    assert.equal(node.bounds!.height, height);
  }
});

test("Node diagnostics detect duplicated charges, detached bonds and route connections crossing labels", async () => {
  const { prepareCompound } =
    await import("../shared/chemical-library/chemistry.ts");
  const { walkGeometry } = await import("../src/ui/library/geometry-walk.ts");
  const { transformBox, inverseMatrix, transformPoint } =
    await import("../src/ui/library/geometry-math.ts");
  for (const [smiles, code] of [
    ["[Na+]", "DUPLICATE_CHARGE"],
    ["CCC", "BOND_ENDPOINT_DETACHED"],
    ["CN[C@@H](F)Cl", "BOND_ENDPOINT_DETACHED"],
  ]) {
    const compound = prepareCompound(toolkit, {
      id: "cmp_example",
      title: "Example",
      smiles,
      sources: [{ source: "example", locator: "Structures" }],
    });
    if (smiles.includes("@"))
      compound.layout = {
        coords: {
          a1: { x: -2, y: 1 },
          a2: { x: -1, y: 1 },
          a3: { x: 0, y: 0 },
          a4: { x: 0, y: -1 },
          a5: { x: 1, y: 0 },
        },
        wedgeBonds: [{ from: "a3", to: "a2", style: "hashed" }],
      };
    const geometry = await prepareFigure(
      { [compound.id]: compound },
      { ref: compound.id },
      { toolkit, fonts, style },
    );
    assert.ok(
      !figureGeometryDiagnostics(geometry, style).some((d) => d.code === code),
    );
    walkGeometry(geometry.root, (node) => {
      if (code === "DUPLICATE_CHARGE" && node.kind === "group") {
        const marker = node.children.find(
          (child) => child.attributes["data-charge-owner"],
        );
        if (marker) node.children.push(structuredClone(marker));
      }
      if (
        code === "BOND_ENDPOINT_DETACHED" &&
        node.attributes["data-bond"] ===
          (smiles.includes("@") ? "compound:b1" : "compound:b0")
      )
        node.transform[5] -= 20;
    });
    assert.ok(
      figureGeometryDiagnostics(geometry, style).some((d) => d.code === code),
      code,
    );
  }
  const routeInput = parse(
    await readFile(
      new URL("./fixtures/figures/branched.yaml", import.meta.url),
      "utf8",
    ),
  );
  routeInput.steps[0].to = { id: 2, yield: "93%" };
  const compiled = await compileFigure(routeInput);
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit,
    fonts,
    style,
  });
  assert.ok(
    !figureGeometryDiagnostics(geometry, style).some(
      (d) => d.code === "ROUTE_EDGE_LABEL_OVERLAP",
    ),
  );
  let label:
    import("../shared/chemical-library/geometry.ts").FigureBox | undefined;
  walkGeometry(geometry.root, (node, matrix) => {
    if (node.attributes["data-label"]?.includes(":quantity:"))
      label = transformBox(node.bounds!, matrix) ?? undefined;
  });
  assert.ok(label);
  walkGeometry(geometry.root, (node, matrix) => {
    if (node.kind !== "path" || !node.attributes["data-route-edge"]) return;
    const inverse = inverseMatrix(matrix),
      from = transformPoint(
        { x: label!.x, y: label!.y + label!.height / 2 },
        inverse,
      ),
      to = transformPoint(
        { x: label!.x + label!.width, y: label!.y + label!.height / 2 },
        inverse,
      );
    node.d = `M${from.x} ${from.y}L${to.x} ${to.y}`;
  });
  assert.ok(
    figureGeometryDiagnostics(geometry, style).some(
      (d) => d.code === "ROUTE_EDGE_LABEL_OVERLAP",
    ),
  );
});

test("condition text inside a filled structure is rejected even without crossing its outline", async () => {
  const { createFigureScene } =
    await import("../src/ui/library/scene-geometry.ts");
  const { refreshGeometry } =
    await import("../src/ui/library/geometry-tree.ts");
  const ctx = createFigureScene(style, fonts),
    root = ctx.element("g", { "data-figure": "rxn_example" }),
    molecule = ctx.element("g", { "data-molecule": "compound" });
  const wedge = ctx.element("path", {
    d: "M0 0L300 0L150 300Z",
    "data-bond": "compound:b0",
  });
  ctx.setStyle(wedge, "fill", "var(--chemical-ink)");
  const condition = ctx.label(
    { x: 150, y: 100 },
    "Heat",
    "var(--chemical-caption-font)",
  );
  ctx.setData(condition, "label", "rxn_example:condition:-1:0");
  ctx.append(molecule, wedge);
  ctx.append(root, molecule, condition);
  refreshGeometry(root);
  const diagnostics = figureGeometryDiagnostics(
    {
      format: 1,
      width: 400,
      height: 400,
      minimumScale: 1,
      root,
      atomPoints: {},
    },
    style,
  );
  assert.ok(
    diagnostics.some(
      (d) =>
        d.code === "BOND_LABEL_OVERLAP" &&
        d.elements.includes("rxn_example:condition:-1:0"),
    ),
  );
});

test("atom numbers clear folded group labels after an authored turn", async () => {
  const result = await compileFigure({
    compounds: {
      a: { smiles: "C[C@H]([C:21](=O)OC)O", numbers: true, rot: 90 },
      b: "C[C@H]([C:21](=O)OC)O",
    },
    steps: [{ from: "a", to: "b" }],
  });
  const geometry = await prepareFigure(result.entries, result.reference, {
    toolkit,
    fonts,
    style,
  });
  assert.deepEqual(figureGeometryDiagnostics(geometry, style), []);
});

test("scene arrow condition lines reserve their measured ink height", async () => {
  const compiled = await compileFigure({
    title: "Comparison",
    kind: "mechanism",
    frames: [{ id: "first", smiles: "CCO", arrow: "none" }],
  });
  const entry = compiled.entries[compiled.reference.ref];
  assert.equal(entry.kind, "mechanism");
  const scene = entry.frames[0].scene;
  scene.width = 24;
  scene.height = 12;
  scene.reactionArrows = [
    {
      id: "equilibrium",
      from: { x: 8, y: 4 },
      to: { x: 16, y: 4 },
      kind: "equilibrium",
      below: ["条件甲", "条件乙"],
    },
  ];
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit,
    fonts,
    style,
  });
  assert.ok(
    !figureGeometryDiagnostics(geometry, style).some(
      (d) =>
        d.code === "LABEL_OVERLAP" &&
        d.elements.every((e) => e.startsWith("equilibrium:")),
    ),
  );
});

test("compiled ester labels clear bonds and adjacent labels after saving aligned coordinates", async () => {
  const compiled = await compileFigure({
    title: "Aligned ester",
    anchor: "b",
    compounds: {
      a: "CCC(c1ccccc1)(C(=O)OCC)CCC(=O)N",
      b: "CCC1(c2ccccc2)CCC(=O)NC1=O",
    },
    steps: [{ from: "a", to: "b" }],
  });
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit,
    fonts,
    style,
  });
  assert.deepEqual(figureGeometryDiagnostics(geometry, style), []);
  const labels = new Map<string, FigureBox>();
  const abbreviations = new Set<string>();
  walkGeometry(geometry.root, (node, matrix) => {
    const id = node.attributes["data-label"];
    if (!id?.startsWith("a:") || !node.bounds) return;
    labels.set(
      id,
      unionBoxes([labels.get(id) ?? null, transformBox(node.bounds, matrix)])!,
    );
    if (node.attributes["data-label-text"]) abbreviations.add(id);
  });
  assert.ok(abbreviations.size > 0);
  for (const id of abbreviations) {
    const a = labels.get(id)!;
    for (const [other, b] of labels) {
      if (other === id) continue;
      const gap = Math.hypot(
        Math.max(a.x - b.x - b.width, b.x - a.x - a.width, 0),
        Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0),
      );
      assert.ok(gap >= 8.3, `${id} to ${other}: ${gap}`);
    }
  }
});

test("compiled layouts reserve a three-digit number line for page references", async () => {
  const input = {
    title: "Numbered reaction",
    compounds: {
      a: { smiles: "CC", label: "" },
      b: { smiles: "CCC", label: "" },
      c: { smiles: "CCCC", label: "" },
    },
    steps: [{ from: ["a", "b"], to: "c" }],
  };
  const first = await compileFigure(input);
  const reaction = first.entries[first.reference.ref];
  assert.equal(reaction.kind, "reaction");
  const numbers = Object.fromEntries(
    [...reaction.reactants, ...reaction.products].map((p, i) => [
      p.id,
      String(i + 1).repeat(3),
    ]),
  );
  for (const reference of [first.reference, { ...first.reference, numbers }]) {
    const geometry = await prepareFigure(first.entries, reference, {
      toolkit,
      fonts,
      style,
    });
    assert.deepEqual(figureGeometryDiagnostics(geometry, style), []);
  }
});

test("automatic circles use an outline when a neighbouring label crosses their boundary", async () => {
  const compiled = await compileFigure({
    kind: "mechanism",
    frames: [{ id: "one", smiles: "CC(C)(C)O" }],
  });
  const entry = compiled.entries[compiled.reference.ref];
  assert.equal(entry.kind, "mechanism");
  const scene = entry.frames[0].scene;
  const p = scene.molecules[0];
  const compound = compiled.entries[p.compound];
  assert.equal(compound.kind, "compound");
  scene.enclose = [
    {
      id: "group",
      atoms: compound.atomIds
        .slice(0, 4)
        .map((atom) => ({ molecule: p.id, atom })),
    },
  ];
  for (const shape of ["auto", "circle"] as const) {
    scene.enclose[0].shape = shape;
    const geometry = await prepareFigure(compiled.entries, compiled.reference, {
      toolkit,
      fonts,
      style,
    });
    let actual: string | undefined;
    walkGeometry(geometry.root, (node) => {
      if (node.attributes["data-enclose"])
        actual = node.attributes["data-enclose-shape"];
    });
    assert.equal(actual, shape === "auto" ? "outline" : "circle");
  }
});

test("figure canvas follows visible ink instead of saved scene whitespace", async () => {
  const compiled = await compileFigure({
    kind: "mechanism",
    frames: [{ id: "one", smiles: "CCC" }],
  });
  const entry = compiled.entries[compiled.reference.ref];
  assert.equal(entry.kind, "mechanism");
  entry.frames[0].scene.width = 200;
  entry.frames[0].scene.height = 100;
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit,
    fonts,
    style,
  });
  const identities: string[] = [];
  walkGeometry(geometry.root, (node) => {
    if (node.attributes["data-figure"])
      identities.push(node.attributes["data-figure"]);
  });
  assert.deepEqual(identities, [compiled.reference.ref]);
  assert.ok(geometry.width < 200);
  assert.ok(geometry.height < 150);
  const b = geometry.root.bounds!;
  assert.ok(b.x >= 0 && b.y >= 0);
  assert.ok(
    b.x + b.width <= geometry.width && b.y + b.height <= geometry.height,
  );
});

test("authored bond density reaches the website renderer", async () => {
  const compiled = await compileFigure({
    kind: "gallery",
    bond: 24,
    width: 400,
    compounds: { a: "CCC" },
  });
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit,
    fonts,
    style,
  });
  const points = Object.values(geometry.atomPoints);
  assert.ok(
    Math.abs(
      Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) - 24,
    ) < 0.1,
  );
  assert.ok(geometry.width < 400);
});
