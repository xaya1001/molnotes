import { readFile, writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { parse } from "yaml";
import { compileFigure } from "../scripts/figure-scene.ts";
import { figureBrowser } from "../scripts/figure-browser.ts";
import { figureFontFiles, loadFigureFonts } from "../scripts/figure-fonts.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
import { parseFigureStyle } from "../src/ui/library/scene-geometry.ts";
import { figureGeometryDiagnostics } from "../src/ui/library/geometry-diagnostics.ts";
import { geometryObservation } from "../src/ui/library/geometry-observation.ts";
import { compareFigureGeometry } from "../src/ui/library/geometry-compare.ts";
import type {
  FigureTextRun,
  FigureGeometry,
} from "../shared/chemical-library/geometry.ts";
import type {
  Library,
  FigureReference,
} from "../shared/chemical-library/types.ts";

test("Node and browser prepare identical complete scenes and compare the existing diagnostic baseline", async ({}, testInfo) => {
  test.setTimeout(180_000);
  const compiled = await Promise.all(
    [
      "linear",
      "convergent",
      "branched",
      "products",
      "comparison",
      "mechanism",
    ].map(async (name) => ({
      name,
      ...(await compileFigure(
        parse(
          await readFile(
            new URL(`./fixtures/figures/${name}.yaml`, import.meta.url),
            "utf8",
          ),
        ),
      )),
    })),
  );
  const library = Object.assign({}, ...compiled.map((item) => item.entries));
  const css = await readFile(
      new URL("../src/ui/styles/tokens.css", import.meta.url),
      "utf8",
    ),
    style = parseFigureStyle(css);
  const fonts = await loadFigureFonts(),
    toolkit = await moleculeToolkit();
  const files = figureFontFiles();
  const fontBytes = await Promise.all(
    files.map(async (id) => ({
      id,
      bytes: [...(await readFile(new URL(import.meta.resolve(id))))],
    })),
  );
  const runner = await figureBrowser(library, process.cwd());
  const comparisons = [];
  try {
    await runner.page.evaluate(
      async ({ fontBytes, css }) => {
        const fontPath = "/src/ui/library/font-geometry.ts",
          preparePath = "/src/ui/library/prepare.ts",
          stylePath = "/src/ui/library/scene-geometry.ts",
          rdkitPath = "/src/ui/chemistry/rdkit.ts";
        const [
          { decodeFigureFont },
          { prepareFigure },
          { parseFigureStyle },
          { loadChemistry },
        ] = await Promise.all([
          import(fontPath),
          import(preparePath),
          import(stylePath),
          import(rdkitPath),
        ]);
        const loaded = fontBytes.map(({ id, bytes }) => ({
          id,
          font: decodeFigureFont(Uint8Array.from(bytes)),
        }));
        const fonts = (run: FigureTextRun, character: string) => {
          const matching = loaded.filter(
            (face) =>
              face.id.includes(`-${run.weight}-`) &&
              (face.id.startsWith("@fontsource/noto-sans-sc/") ||
                face.id.includes(run.italic ? "-italic." : "-normal.")),
          );
          const priority = (id: string) =>
            id.startsWith("@fontsource/arimo/")
              ? 0
              : id.startsWith("@fontsource/noto-sans-sc/")
                ? 1
                : 2;
          matching.sort((a, b) => priority(a.id) - priority(b.id));
          const face = matching.find((face) =>
            face.font.hasGlyphForCodePoint(character.codePointAt(0)!),
          );
          if (!face) throw new Error("Missing fixture font");
          return face;
        };
        const toolkit = await loadChemistry();
        (
          window as unknown as {
            prepare: (
              library: Library,
              reference: FigureReference,
            ) => Promise<FigureGeometry>;
          }
        ).prepare = (library, reference) =>
          prepareFigure(library, reference, {
            toolkit,
            fonts,
            style: parseFigureStyle(css),
          });
      },
      { fontBytes, css },
    );
    for (const item of compiled) {
      await runner.page.evaluate((library) => {
        (window as unknown as { figureLibrary: Library }).figureLibrary =
          library;
      }, item.entries);
      const entry = item.entries[item.reference.ref];
      const references =
        entry.kind === "mechanism"
          ? entry.frames.map((frame) => ({
              ...item.reference,
              frame: frame.id,
            }))
          : [item.reference];
      for (const reference of references) {
        const node = await prepareFigure(item.entries, reference, {
          toolkit,
          fonts,
          style,
        });
        const browser = await runner.page.evaluate(
          ({ library, reference }) =>
            (
              window as unknown as {
                prepare: (
                  library: Library,
                  reference: FigureReference,
                ) => Promise<FigureGeometry>;
              }
            ).prepare(library, reference),
          { library: item.entries, reference },
        );
        expect(browser).toEqual(node);
        const prior = await runner.render(reference),
          before = await runner.observation(prior);
        const diagnostics = figureGeometryDiagnostics(
          node,
          style,
          Math.max(node.minimumScale, Math.min(1, 1318 / node.width)),
        );
        expect(
          diagnostics.map((d) => ({ code: d.code, elements: d.elements })),
        ).toEqual(
          prior.diagnostics.map((d) => ({
            code: d.code,
            elements: d.elements,
          })),
        );
        comparisons.push({
          name: item.name,
          reference,
          before: prior.diagnostics,
          after: diagnostics,
          comparison: compareFigureGeometry(
            before,
            geometryObservation(node, diagnostics),
          ),
        });
      }
    }
    await writeFile(
      testInfo.outputPath("comparison.json"),
      JSON.stringify(comparisons, null, 2),
    );
  } finally {
    await runner.close();
  }
});
