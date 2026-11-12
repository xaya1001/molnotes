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
