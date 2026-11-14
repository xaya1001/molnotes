import { readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parse } from "yaml";
import { compileFigure, figureKey } from "./figure-scene.ts";
import { loadFigureStyle } from "./figure-route.ts";
import { loadFigureFonts } from "./figure-fonts.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import { prepareFigure } from "../src/ui/library/prepare.ts";
import { geometrySvg } from "../src/ui/library/geometry-tree.ts";
import { diagnoseFigure } from "./figure-diagnostics.ts";
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
  return entry.kind === "mechanism"
    ? entry.frames.map((frame) => ({ ...reference, frame: frame.id }))
    : [reference];
}

export function diagnosticLine(
  location: string,
  reference: FigureReference,
  diagnostic: Diagnostic,
) {
  return `${location}${reference.frame ? ` [${reference.frame}]` : ""}: ${diagnostic.code} ${diagnostic.message} (${diagnostic.elements.join(", ")})`;
}

export async function* drawFigure(
  library: Library,
  reference: FigureReference,
) {
  const style = await loadFigureStyle();
  const options = {
    style,
    toolkit: await moleculeToolkit(),
    fonts: await loadFigureFonts(),
  };
  for (const view of figureViews(library, reference)) {
    const geometry = await prepareFigure(library, view, options);
    yield {
      reference: view,
      svg: geometrySvg(geometry),
      diagnostics: diagnoseFigure(geometry, style),
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
      ? { kind: "gallery", compounds: { single: { label: "", ...single } } }
      : value,
    {},
    figureKey(resolve(source)),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const args = process.argv.slice(2),
    source = args[0],
    outIndex = args.indexOf("--out"),
    out = args[outIndex + 1];
  if (!source || outIndex < 0 || !out)
    throw new Error(
      "Usage: npm run figure:draw -- <figure.yaml> --out <directory|file.svg>",
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
