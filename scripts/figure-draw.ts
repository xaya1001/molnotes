import { drawnArrows } from "../shared/chemical-library/figure-layout.ts";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parse } from "yaml";
import { compileFigure, figureKey } from "./figure-scene.ts";
import { loadFigureStyle } from "./figure-route.ts";
import { loadFigureFonts } from "./figure-fonts.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
import { geometrySvg } from "../src/ui/library/geometry-tree.ts";
import {
  diagnosticMarksLayer,
  withDiagnosticMarks,
} from "../src/ui/library/diagnostic-marks.ts";
import { diagnoseFigure, figureDiagnosticScale } from "./figure-diagnostics.ts";
import { isObject } from "../shared/json.ts";
import type {
  Diagnostic,
  FigureReference,
  Library,
} from "../shared/chemical-library/types.ts";

export function figureViews(
  library: Library,
  reference: FigureReference,
): FigureReference[] {
  const entry = library[reference.ref];
  return entry.kind === "figure" &&
    !reference.frame &&
    !drawnArrows(entry.graph).length
    ? Object.keys(entry.views).map((frame) => ({ ...reference, frame }))
    : [reference];
}

export function diagnosticLine(
  location: string,
  reference: FigureReference,
  diagnostic: Diagnostic,
) {
  return `${location}${reference.frame ? ` [${reference.frame}]` : ""}${reference.variant ? ` [variant ${reference.variant}]` : ""}: ${diagnostic.code} ${diagnostic.message} (${diagnostic.elements.join(", ")})`;
}

export async function* drawFigure(
  library: Library,
  reference: FigureReference,
  drawOptions: { marks?: boolean } = {},
) {
  const style = await loadFigureStyle();
  const options = {
    style,
    toolkit: await moleculeToolkit(),
    fonts: await loadFigureFonts(),
  };
  for (const view of figureViews(library, reference)) {
    const geometry = await prepareFigure(library, view, options);
    const diagnostics = diagnoseFigure(geometry, style);
    const rawSvg = geometrySvg(geometry);
    const svg =
      drawOptions.marks && diagnostics.length
        ? withDiagnosticMarks(
            rawSvg,
            diagnosticMarksLayer(geometry, diagnostics, {
              scale: figureDiagnosticScale(geometry),
            }),
          )
        : rawSvg;
    yield {
      reference: view,
      svg,
      diagnostics,
    };
  }
}

export async function compileFigureFile(source: string) {
  const value: unknown = parse(await readFile(source, "utf8"));
  const single =
    typeof value === "string"
      ? { smiles: value }
      : isObject(value) &&
          value.kind === undefined &&
          ("smiles" in value || "template" in value)
        ? value
        : undefined;
  return compileFigure(
    single
      ? {
          kind: "scheme",
          states: {
            single: { compounds: { structure: { label: "", ...single } } },
          },
          arrows: {},
        }
      : value,
    {},
    figureKey(resolve(source)),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2),
    outIndex = args.indexOf("--out"),
    out = outIndex < 0 ? undefined : args[outIndex + 1],
    marks = args.includes("--marks"),
    source = args.find(
      (arg, index) => !arg.startsWith("--") && index !== outIndex + 1,
    );
  if (!source || outIndex < 0 || !out)
    throw new Error(
      "Usage: npm run figure:draw -- <figure.yaml> --out <directory|file.svg> [--marks]",
    );
  const compiled = await compileFigureFile(source);
  const name = basename(source, extname(source)),
    file = out.endsWith(".svg");
  const multiple = figureViews(compiled.entries, compiled.reference).length > 1;
  await mkdir(file ? dirname(out) : out, { recursive: true });
  for (const warning of compiled.warnings)
    console.error(`${source}: ${warning}`);
  let index = 0;
  for await (const rendered of drawFigure(
    compiled.entries,
    compiled.reference,
    { marks },
  )) {
    const suffix = multiple ? `-${++index}` : "";
    const target = file
      ? out.slice(0, -4) + suffix + ".svg"
      : join(out, name + suffix + ".svg");
    await writeFile(target, rendered.svg);
    for (const diagnostic of rendered.diagnostics)
      console.error(diagnosticLine(source, rendered.reference, diagnostic));
    console.log(target);
  }
}
