import assert from "node:assert/strict";
import test from "node:test";
import { compileFigure } from "../scripts/figure-scene.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
import { loadFigureFonts } from "../scripts/figure-fonts.ts";
import { loadFigureStyle } from "../scripts/figure-route.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { walkGeometry } from "../src/ui/library/geometry-walk.ts";
import { transformBox } from "../src/ui/library/geometry-math.ts";
import type { FigureNode } from "../shared/chemical-library/geometry.ts";

async function drawing(input: unknown) {
  const compiled = await compileFigure(input);
  const style = await loadFigureStyle();
  const geometry = await prepareFigure(compiled.entries, compiled.reference, {
    toolkit: await moleculeToolkit(),
    fonts: await loadFigureFonts(),
    style,
  });
  const nodes: FigureNode[] = [];
  walkGeometry(geometry.root, (n) => nodes.push(n));
  return { geometry, nodes, style };
}
const scope = {
  kind: "scope",
  mark: "[#6]-F",
  compounds: { a: { smiles: "CCF", yield: "80%" } },
  groups: [{ title: "Products", items: ["a"] }],
};

test("scope marks color the matching atoms and bond", async () => {
  const { nodes, style } = await drawing({
    ...scope,
    compounds: {
      ...scope.compounds,
      b: { template: "chair", subs: { "1a": "Me" } },
    },
    groups: [{ title: "Products", items: ["a", "b"] }],
  });
  const colored = nodes.filter(
    (n) =>
      n.paint.fill === style.values["--chemical-focus"] ||
      n.paint.stroke === style.values["--chemical-focus"],
  );
  assert.ok(colored.some((n) => n.attributes["data-bond"]));
  assert.ok(colored.some((n) => n.attributes["data-label"]));
});

test("scope yields use the shared blue and bold text", async () => {
  const { nodes, style } = await drawing(scope);
  const yieldText = nodes.find((n) => n.kind === "text" && n.text === "80%");
  assert.ok(yieldText?.kind === "text");
  assert.equal(yieldText.paint.fill, style.values["--chemical-yield"]);
  assert.ok(yieldText.runs.every((r) => r.weight === 700));
});

test("scope titles sit on a full width gray bar", async () => {
  const { nodes, geometry, style } = await drawing(scope);
  const bar = nodes.find((n) => n.attributes["data-caption-box"] !== undefined);
  assert.ok(bar?.bounds);
  assert.equal(bar.paint.fill, style.values["--chemical-panel-fill"]);
  assert.ok(bar.bounds.width > geometry.width * 0.8);
});

test("cycle step names have a gray box enclosing every line", async () => {
  const { geometry, nodes, style } = await drawing({
    kind: "cycle",
    nodes: ["A", "B", "C"],
    steps: [{ label: "First\nstep" }, {}, {}],
  });
  const bar = nodes.find((n) => n.attributes["data-caption-box"] !== undefined);
  assert.ok(bar?.bounds);
  assert.equal(bar.paint.fill, style.values["--chemical-panel-fill"]);
  assert.equal(bar.paint.stroke, style.values["--chemical-panel-stroke"]);
  assert.equal(
    bar.paint.strokeWidth,
    parseFloat(style.values["--chemical-panel-line"]),
  );
  const boxes: { x: number; y: number; width: number; height: number }[] = [];
  let panel: (typeof boxes)[number] | undefined;
  walkGeometry(geometry.root, (n, m) => {
    if (n === bar) panel = transformBox(n.bounds, m)!;
    if (n.kind === "text" && ["First", "step"].includes(n.text))
      boxes.push(transformBox(n.bounds, m)!);
  });
  assert.equal(boxes.length, 2);
  for (const b of boxes) {
    assert.ok(
      panel &&
        panel.x <= b.x &&
        panel.y <= b.y &&
        panel.x + panel.width >= b.x + b.width &&
        panel.y + panel.height >= b.y + b.height,
    );
  }
});
