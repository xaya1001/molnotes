import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { figureBrowser } from "../scripts/figure-browser.ts";
import { loadFigureFonts } from "../scripts/figure-fonts.ts";
import { shapeFigureText } from "../src/ui/library/font-geometry.ts";
import { geometrySvg } from "../src/ui/library/geometry-tree.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { prepareCompound } from "../shared/chemical-library/chemistry.ts";
import type {
  FigureGeometry,
  FigureTextRun,
} from "../shared/chemical-library/geometry.ts";

test("Node and browser shape identical geometry and the outlined SVG matches its measured ink", async () => {
  test.setTimeout(90_000);
  const toolkit = await moleculeToolkit();
  const compound = prepareCompound(toolkit, {
    id: "cmp_example",
    title: "Example structure",
    smiles: "CC(=O)O",
    sources: [{ source: "handbook", locator: "Example" }],
  });
  const runner = await figureBrowser(
    { [compound.id]: compound },
    process.cwd(),
  );
  try {
    const native = await runner.render({ ref: compound.id });
    const baseline = await runner.observation(native);
    expect(baseline.elements.some((element) => element.ids.bond)).toBe(true);
    expect(baseline.elements.some((element) => element.ids.label)).toBe(true);
    const fonts = await loadFigureFonts();
    const runs: FigureTextRun[] = [
      { text: "AV Δ 室温 ", size: 20, weight: 400, italic: false, shift: 0 },
      { text: "tBuO", size: 20, weight: 700, italic: true, shift: 0 },
      { text: "2", size: 16, weight: 400, italic: false, shift: 4 },
    ];
    const lookup: Record<string, string> = {};
    for (const run of runs)
      for (const character of ["A", ...run.text]) {
        lookup[`${run.weight}:${run.italic}:${character}`] = fonts(
          run,
          character,
        ).id;
      }
    const fontBytes = await Promise.all(
      [...new Set(Object.values(lookup))].map(async (id) => ({
        id,
        bytes: [...(await readFile(new URL(import.meta.resolve(id))))],
      })),
    );
    const node = shapeFigureText(runs, fonts, { x: 160, y: 100 });
    const browserNode = await runner.page.evaluate(
      async ({ runs, lookup, fontBytes }) => {
        const geometryPath = "/src/ui/library/font-geometry.ts";
        const { decodeFigureFont, shapeFigureText } = await import(
          geometryPath
        );
        const loaded = new Map(
          fontBytes.map(({ id, bytes }) => [
            id,
            { id, font: decodeFigureFont(Uint8Array.from(bytes)) },
          ]),
        );
        return shapeFigureText(
          runs,
          (run: FigureTextRun, character: string) =>
            loaded.get(lookup[`${run.weight}:${run.italic}:${character}`])!,
          { x: 160, y: 100 },
        );
      },
      { runs, lookup, fontBytes },
    );
    expect(browserNode).toEqual(node);
    node.attributes["data-label"] = "condition";
    const geometry: FigureGeometry = {
      format: 1,
      width: 400,
      height: 200,
      minimumScale: 1,
      atomPoints: {},
      root: node,
    };
    await runner.page.locator("#canvas").evaluate((canvas, svg) => {
      canvas.innerHTML = svg;
    }, geometrySvg(geometry));
    const measured = await runner.page
      .locator('[data-label="condition"]')
      .evaluate((element: SVGGraphicsElement) => {
        const box = element.getBBox();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      });
    for (const key of ["x", "y", "width", "height"] as const)
      expect(Math.abs(measured[key] - node.inkBounds![key])).toBeLessThan(
        0.001,
      );
  } finally {
    await runner.close();
  }
});
