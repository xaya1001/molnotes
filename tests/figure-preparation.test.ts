import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { compileFigure } from "../scripts/figure-scene.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { loadFigureFonts } from "../scripts/figure-fonts.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
import { figureStyle as style } from "./fixtures/figures/style.ts";
import { figureWorkerPool } from "../scripts/content/figure-worker-pool.ts";
import { isFigureGeometry } from "../src/ui/library/geometry-contract.ts";
import { geometrySvg } from "../src/ui/library/geometry-tree.ts";
import { figureGeometryDiagnostics } from "../src/ui/library/geometry-diagnostics.ts";
const toolkit = await moleculeToolkit(),
  fonts = await loadFigureFonts();

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
    (scene.label({ x: 0, y: 0 }, "AAAA BBBB CCCC", "17px").advance + 0.1) / 32;
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
    [17, -9.5, 24.5],
    [20, -11, 28],
  ]) {
    const node = scene.label({ x: 0, y: 0 }, "H₂O", `${size}px`);
    assert.equal(node.bounds!.y, y);
    assert.equal(node.bounds!.height, height);
  }
});
