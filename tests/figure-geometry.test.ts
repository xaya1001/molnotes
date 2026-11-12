import { walkGeometry } from "../src/ui/library/geometry-walk.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parse } from "svg-parser";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { loadFigureFonts } from "../scripts/figure-fonts.ts";
import { shapeFigureText } from "../src/ui/library/font-geometry.ts";
import {
  nativeDepictionGeometry,
  nativePaint,
} from "../src/ui/library/native-geometry.ts";
import {
  figureGroup,
  figurePath,
  geometrySvg,
  transformedNodeBox,
  plainPaint,
} from "../src/ui/library/geometry-tree.ts";
import { geometryObservation } from "../src/ui/library/geometry-observation.ts";
import { compareFigureGeometry } from "../src/ui/library/geometry-compare.ts";
import {
  identityMatrix,
  inverseMatrix,
  multiplyMatrix,
  transformBox,
  transformPoint,
} from "../src/ui/library/geometry-math.ts";
import {
  pathBox,
  pathMetrics,
  samplePath,
  svgTransform,
} from "../src/ui/library/path-geometry.ts";
import type {
  FigureGeometry,
  FigureMatrix,
  FigureTextRun,
} from "../shared/chemical-library/geometry.ts";
import { compareObservationSets } from "../scripts/figure-compare.ts";

const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
const figure = (root: FigureGeometry["root"]): FigureGeometry => ({
  format: 1,
  width: 320,
  height: 200,
  minimumScale: 0.6,
  atomPoints: {},
  root,
});
const run = (text: string, size = 20): FigureTextRun => ({
  text,
  size,
  weight: 400,
  italic: false,
  shift: 0,
});

test("figure transforms compose and invert with reflected and rotated boxes", () => {
  const matrix: FigureMatrix = [0, 2, -3, 0, 10, 20];
  assert.deepEqual(transformPoint({ x: 4, y: 5 }, matrix), { x: -5, y: 28 });
  assert.deepEqual(
    multiplyMatrix(matrix, inverseMatrix(matrix)),
    identityMatrix(),
  );
  assert.deepEqual(transformBox({ x: 1, y: 2, width: 3, height: 4 }, matrix), {
    x: -8,
    y: 22,
    width: 12,
    height: 6,
  });
  const fromSvg = svgTransform("translate(10 20) rotate(90) scale(2 3)");
  fromSvg.forEach((value, i) => close(value, matrix[i]));
});

test("curve bounds use analytic extrema and ignore disconnected moveto positions", () => {
  assert.deepEqual(pathBox("M1000 1000 M0 0 Q100 100 200 0"), {
    x: 0,
    y: 0,
    width: 200,
    height: 50,
  });
  assert.deepEqual(pathBox("M0 0C0 100 100 100 100 0"), {
    x: 0,
    y: 0,
    width: 100,
    height: 75,
  });
  assert.deepEqual(pathBox("M10 20h-5v-8z"), {
    x: 5,
    y: 12,
    width: 5,
    height: 8,
  });
  assert.equal(pathBox("M10 20"), null);
  const rotated = figurePath("M0 0Q10 10 20 0");
  rotated.transform = [1, 1, -1, 1, 0, 0];
  const bounds = transformedNodeBox(rotated)!;
  // Rotating the original AABB would incorrectly extend left of the curve.
  close(bounds.x, 0);
  close(bounds.width, 20);
  close(bounds.height, 20);
});

test("path distance sampling remains in local units before the explicit parent transform", () => {
  const metric = pathMetrics("M0 0L3 4");
  close(metric.length, 5);
  assert.deepEqual(metric.pointAt(2.5), { x: 1.5, y: 2 });
  assert.deepEqual(samplePath("M0 0L3 4", 3, [2, 0, 0, 2, 10, 20]), [
    { x: 10, y: 20 },
    { x: 13, y: 24 },
    { x: 16, y: 28 },
  ]);
});

test("native outlined molecules retain atom identities, ink and numeric paint in Node", async () => {
  const toolkit = await moleculeToolkit();
  const mol = toolkit.get_mol("CC(=O)O")!;
  try {
    const source = mol.get_svg_with_highlights(
      JSON.stringify({
        width: 200,
        height: 100,
        noFreetype: false,
        fontFile: "BuiltinRobotoRegular",
        atomColourPalette: "bw",
      }),
    );
    const root = nativeDepictionGeometry(source);
    let bonds = 0,
      labels = 0;
    walkGeometry(root, (node) => {
      assert.ok(Number.isFinite(node.paint.strokeWidth));
      if (node.attributes.class?.includes("bond-")) {
        bonds++;
        assert.equal(node.paint.strokeWidth, 2);
        assert.equal(node.paint.fillRule, "evenodd");
      }
      if (node.kind === "path" && node.attributes.class?.startsWith("atom-")) {
        labels++;
        assert.ok(node.bounds && node.bounds.width > 0);
      }
    });
    assert.ok(bonds >= 3);
    assert.ok(labels >= 2);
    const restored: FigureGeometry = JSON.parse(JSON.stringify(figure(root)));
    assert.deepEqual(restored.root, root);
    const svg = parse(geometrySvg(restored)).children[0];
    assert.equal(svg.type, "element");
    if (svg.type === "element") assert.equal(svg.tagName, "svg");
  } finally {
    mol.delete();
  }
});

test("pinned font shaping keeps kerning and distinct logical and visible text bounds", async () => {
  const fonts = await loadFigureFonts();
  const a = shapeFigureText(
    [run("A")],
    fonts,
    { x: 0, y: 0 },
    "start",
    "alphabetic",
  );
  const v = shapeFigureText(
    [run("V")],
    fonts,
    { x: 0, y: 0 },
    "start",
    "alphabetic",
  );
  const av = shapeFigureText([run("AV")], fonts, { x: 50, y: 30 });
  assert.ok(av.advance < a.advance + v.advance);
  close(av.bounds!.x + av.bounds!.width / 2, 50);
  assert.notDeepEqual(av.bounds, av.inkBounds);
  const whitespace = shapeFigureText([run(" ")], fonts, { x: 0, y: 0 });
  assert.ok(whitespace.advance > 0);
  assert.equal(whitespace.inkBounds, null);
});

test("Chinese, Greek, script shifts, weight and italic prefixes produce font-free SVG paths", async () => {
  const fonts = await loadFigureFonts();
  const runs = [
    { ...run("t"), italic: true },
    run("BuO"),
    run("→ ⁺ ⁻ \u9393"),
    { ...run("2", 16), shift: 4 },
    { ...run("，室温 Δ"), weight: 700 as const },
  ];
  const node = shapeFigureText(runs, fonts, { x: 100, y: 60 });
  assert.ok(node.glyphs.some((glyph) => glyph.font.includes("italic")));
  assert.ok(
    node.glyphs.some(
      (glyph) =>
        glyph.font.includes("noto-sans-sc") && glyph.font.includes("700"),
    ),
  );
  assert.ok(node.glyphs.some((glyph) => glyph.font.includes("arimo-greek")));
  node.attributes["data-label"] = "reaction:condition";
  const svg = parse(geometrySvg(figure(node))).children[0];
  assert.equal(svg.type, "element");
  if (svg.type !== "element") return;
  const group = svg.children[0];
  assert.ok(typeof group !== "string" && group.type === "element");
  if (typeof group === "string" || group.type !== "element") return;
  assert.equal(group.tagName, "g");
  assert.equal(group.properties?.["data-label"], "reaction:condition");
  assert.ok(group.properties?.["aria-label"]);
  assert.ok(group.children.length > 5);
  for (const child of group.children) {
    assert.ok(typeof child !== "string" && child.type === "element");
    if (typeof child !== "string" && child.type === "element")
      assert.equal(child.tagName, "path");
  }
  const digit = shapeFigureText(
    [{ ...run("2", 16), shift: 4 }],
    fonts,
    { x: 0, y: 0 },
    "start",
    "alphabetic",
  );
  const baseline = shapeFigureText(
    [run("2", 16)],
    fonts,
    { x: 0, y: 0 },
    "start",
    "alphabetic",
  );
  close(digit.inkBounds!.y - baseline.inkBounds!.y, 4);
});

test("geometry comparisons preserve repeated glyph IDs and rank actual changes", () => {
  const a = figurePath("M0 0L10 0"),
    b = figurePath("M0 0L0 10");
  a.attributes["data-bond"] = "m:b1";
  b.attributes["data-bond"] = "m:b1";
  const before = figure(figureGroup([a, b]));
  const observation = geometryObservation(before);
  assert.equal(observation.elements.length, 2);
  assert.notEqual(observation.elements[0].key, observation.elements[1].key);
  const same = compareFigureGeometry(
    observation,
    geometryObservation(structuredClone(before)),
  );
  assert.equal(same.equal, true);
  a.transform[4] = 4;
  b.transform[5] = 2;
  const difference = compareFigureGeometry(
    observation,
    geometryObservation(before),
  );
  assert.equal(difference.equal, false);
  assert.equal(difference.maximumBoundsDelta, 4);
  assert.equal(difference.changed[0].bounds, 4);
  assert.equal(difference.changed[1].bounds, 2);
  assert.equal(difference.maximumTraceDelta, 4);
});

test("comparison reports diagnostic-set and metric changes independently of geometry", () => {
  const observation = geometryObservation(figure(figureGroup([])), [
    {
      code: "ARROW_TOO_SHORT",
      severity: "error",
      object: "figure",
      elements: ["arrow"],
      message: "Adjust curve",
      actual: 30,
      required: 38.4,
    },
  ]);
  const changed = structuredClone(observation);
  changed.diagnostics[0].actual = 31;
  changed.diagnostics.push({
    code: "CLIPPED_INK",
    severity: "error",
    object: "figure",
    elements: ["bond"],
    message: "Adjust margin",
  });
  const result = compareFigureGeometry(observation, changed);
  assert.equal(result.diagnostics.added[0].code, "CLIPPED_INK");
  assert.equal(result.diagnostics.measures.length, 1);
  assert.equal(result.equal, false);
});

test("identical fractional boxes pass comparison without arithmetic cancellation", () => {
  const node = figurePath("M0 0L10 0");
  node.attributes["data-bond"] = "m:b1";
  const observation = geometryObservation(figure(node));
  observation.elements[0].bounds = {
    x: 48.00075960236959,
    y: 87.19816536703058,
    width: 27.699422354167268,
    height: 15.999653010729181,
  };
  const result = compareFigureGeometry(
    observation,
    structuredClone(observation),
  );
  assert.equal(result.equal, true);
  assert.equal(result.maximumBoundsDelta, 0);
});

test("batch comparison keeps failed and missing views while ranking movement", () => {
  const node = figurePath("M0 0L10 0");
  node.attributes["data-bond"] = "m:b1";
  const before = geometryObservation(figure(node));
  node.transform[4] = 7;
  const after = geometryObservation(figure(node));
  const report = compareObservationSets(
    { views: { same: before, large: before, removed: before }, failures: {} },
    {
      views: { same: before, large: after },
      failures: { failed: "Render failed" },
    },
  );
  assert.equal(report.total, 4);
  assert.equal(report.unchanged, 1);
  assert.equal(report.changed[0].unmatched, "before");
  assert.equal(report.changed[1].unmatched, "after");
  assert.equal(report.changed[2].comparison!.maximumBoundsDelta, 7);
});

test("browser computed paint and native SVG paint use the same color and dash semantics", () => {
  const node = figurePath("M0 0L10 0");
  node.attributes["data-bond"] = "m:b1";
  const before = geometryObservation(figure(node));
  const after = structuredClone(before);
  after.elements[0].paint = nativePaint(
    { fill: "rgb(0, 0, 0)", stroke: "none", "stroke-dasharray": "none" },
    plainPaint(),
  );
  assert.equal(compareFigureGeometry(before, after).equal, true);
  after.elements[0].paint.strokeWidth = 2;
  assert.equal(compareFigureGeometry(before, after).changed[0].paint, true);
});

test("fallback glyphs retain the primary text line metrics", async () => {
  const fonts = await loadFigureFonts();
  const latin = shapeFigureText([run("AB", 17)], fonts, { x: 0, y: 0 });
  const mixed = shapeFigureText([run("AB \u6c34", 17)], fonts, { x: 0, y: 0 });
  close(mixed.bounds!.height, latin.bounds!.height);
  close(mixed.bounds!.y, latin.bounds!.y);
});
