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
const toolkit = await moleculeToolkit(),
  fonts = await loadFigureFonts();

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
    q = c.layout.coords[c.atomIds[1]];
  p.x = q.x + 2 * (p.x - q.x);
  p.y = q.y + 2 * (p.y - q.y);
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
