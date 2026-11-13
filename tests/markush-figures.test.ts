import { test } from "node:test";
import assert from "node:assert/strict";
import { compileFigure } from "../scripts/figure-scene.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
import { loadFigureFonts } from "../scripts/figure-fonts.ts";
import { loadFigureStyle } from "../scripts/figure-route.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { geometrySvg } from "../src/ui/library/geometry-tree.ts";
import { diagnoseFigure } from "../scripts/figure-diagnostics.ts";
import { validateFigureInput } from "../scripts/figure-input.ts";
import { figureGeometryDiagnostics } from "../src/ui/library/geometry-diagnostics.ts";

const model = {
  kind: "markush",
  core: "c1c([*:1])cc([*:2])cc1",
  groups: {
    "1": {
      label: "R¹",
      alternatives: [{ type: "fragment", smiles: "*C", label: "methyl" }],
    },
    "2": {
      label: "R²",
      alternatives: [{ type: "fragment", smiles: "*C", label: "methyl" }],
    },
  },
};
const options = async () => ({
  toolkit: await moleculeToolkit(),
  fonts: await loadFigureFonts(),
  style: await loadFigureStyle(),
});

test("Markush formula compiles a stable entry, merges equal definitions and outlines fragment structures", async () => {
  const compiled = await compileFigure(model, {}, "neutral");
  assert.equal(compiled.reference.ref, "mku_neutral");
  const geometry = await prepareFigure(
    compiled.entries,
    compiled.reference,
    await options(),
  );
  const svg = geometrySvg(geometry);
  assert.ok(svg.includes('data-text="R1 / R2"'));
  assert.equal((svg.match(/data-text="methyl"/g) ?? []).length, 1);
  assert.ok(!svg.includes("<text"));
  assert.deepEqual(diagnoseFigure(geometry, (await options()).style), []);
  assert.equal(
    (
      await compileFigure(
        { ...model, name: "(A)" },
        compiled.entries,
        "neutral",
      )
    ).reference.ref,
    compiled.reference.ref,
  );
});

test("variable substituents on the same ring use distinct hanging bonds", async () => {
  const compiled = await compileFigure({
    ...model,
    groups: {
      "1": { ...model.groups["1"], positions: [0, 3, 4, 6] },
      "2": {
        label: "R²",
        positions: [0, 3, 4, 6],
        alternatives: [{ label: "halo" }],
      },
    },
  });
  const opts = await options(),
    geometry = await prepareFigure(compiled.entries, compiled.reference, opts);
  const bonds: string[] = [];
  function visit(n: typeof geometry.root) {
    if (n.kind === "path" && n.attributes["data-floating-bond"])
      bonds.push(n.d);
    if (n.kind === "group") n.children.forEach(visit);
  }
  visit(geometry.root);
  assert.equal(bonds.length, 2);
  assert.equal(new Set(bonds).size, 2);
  assert.deepEqual(diagnoseFigure(geometry, opts.style), []);
});

test("coverage maps preserve zero, positive and absent per-source coverage", async () => {
  const compiled = await compileFigure({
    ...model,
    view: "overlay",
    patents: { a: "Source A", b: "Source B" },
    groups: {
      "1": {
        label: "R¹",
        alternatives: [
          { label: "methyl", by: { a: [1, 2], b: 0 } },
          { label: "ethyl", by: { a: 0 } },
        ],
        outside: ["halo"],
      },
      "2": { label: "R²", alternatives: [{ label: "H", by: { a: 1, b: 1 } }] },
    },
    gaps: [
      { parts: ["R¹ = halo", "R² = ethyl"], note: "Structure comparison" },
    ],
  });
  const opts = await options(),
    geometry = await prepareFigure(compiled.entries, compiled.reference, opts);
  assert.deepEqual(diagnoseFigure(geometry, opts.style), []);
  assert.deepEqual(
    figureGeometryDiagnostics(geometry, opts.style, geometry.minimumScale),
    [],
  );
  const states = new Map<string, unknown>();
  function collect(node: typeof geometry.root) {
    if (node.attributes["data-coverage"])
      states.set(
        node.attributes["data-alternative"],
        JSON.parse(node.attributes["data-coverage"]),
      );
    if (node.kind === "group") node.children.forEach(collect);
  }
  collect(geometry.root);
  assert.deepEqual(states.get("methyl"), [2, 0]);
  assert.deepEqual(states.get("ethyl"), [0, null]);
  assert.deepEqual(states.get("halo"), [null, null]);
  const svg = geometrySvg(geometry);
  assert.ok(svg.includes("stroke-dasharray"));
  assert.ok(svg.includes('data-text="Source A"'));
});

test("Markush input accepts density and validates overlay sources", () => {
  assert.equal(
    validateFigureInput({ ...model, bond: 24, width: 700, scale: 1.3 }).input
      .width,
    700,
  );
  assert.throws(
    () => validateFigureInput({ ...model, view: "overlay" }),
    /requires patents/,
  );
  assert.throws(
    () =>
      validateFigureInput({
        ...model,
        view: "overlay",
        patents: { a: "A" },
        groups: {
          1: { label: "R", alternatives: [{ label: "H", by: { b: 1 } }] },
        },
      }),
    /unknown coverage patent/,
  );
});

test("repeat groups retain core identity and joined unit geometry", async () => {
  const compiled = await compileFigure({
    kind: "markush",
    core: "[*:1]CCc1ccccc1 |Sg:n:1:n:ht|",
    groups: {
      "1": {
        label: "R¹",
        alternatives: [
          {
            id: "link",
            type: "repeat",
            label: "Linked cap",
            unit: "[*:1]C[*:2]",
            end: "*S(C)(=O)=O",
            min: 0,
            max: 3,
          },
        ],
      },
    },
  });
  const opts = await options(),
    geometry = await prepareFigure(compiled.entries, compiled.reference, opts);
  const svg = geometrySvg(geometry);
  assert.ok(svg.includes("data-repeat-bracket"));
  assert.deepEqual(diagnoseFigure(geometry, opts.style), []);
});

test("Markush core scale enlarges bonds while retaining label size", async () => {
  const { walkGeometry } = await import("../src/ui/library/geometry-walk.ts");
  const measure = async (scale: number) => {
    const compiled = await compileFigure({ ...model, scale });
    const geometry = await prepareFigure(
      compiled.entries,
      compiled.reference,
      await options(),
    );
    let bonds: number[] = [],
      labels: number[] = [];
    walkGeometry(geometry.root, (node) => {
      if (
        node.attributes["data-bond-lengths"] &&
        node.attributes["data-molecule"] === "m0"
      )
        bonds = JSON.parse(node.attributes["data-bond-lengths"]);
      if (node.attributes["data-label"] && node.bounds)
        labels.push(node.bounds.height);
    });
    return { bonds, labels };
  };
  const normal = await measure(1),
    enlarged = await measure(2);
  assert.ok(normal.bonds.length);
  assert.ok(
    enlarged.bonds.every((n, i) => Math.abs(n / normal.bonds[i] - 2) < 0.02),
  );
  assert.equal(enlarged.labels.length, normal.labels.length);
  enlarged.labels.forEach((height, i) =>
    assert.ok(Math.abs(height - normal.labels[i]) < 0.01),
  );
});
