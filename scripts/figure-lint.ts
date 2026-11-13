import {
  compileFigureFile,
  drawFigure,
  diagnosticLine,
} from "./figure-draw.ts";
import { readChemicalLibrary } from "./content/chemical-library.ts";
import { setting } from "../shared/settings.ts";
import { figureProofReferences } from "./content/figure-proofs.ts";
import { figureBuildRunner } from "./content/figure-build.ts";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadFigureStyle } from "./figure-route.ts";
import { diagnoseFigure } from "./figure-diagnostics.ts";

const args = process.argv.slice(2);
let count = 0;
if (args.length && args[0] !== "--library") {
  for (const source of args) {
    try {
      const compiled = await compileFigureFile(source);
      for await (const rendered of drawFigure(
        compiled.entries,
        compiled.reference,
      ))
        for (const diagnostic of rendered.diagnostics) {
          console.log(diagnosticLine(source, rendered.reference, diagnostic));
          count++;
        }
    } catch (error) {
      console.log(
        `${source}: ${error instanceof Error ? error.message : String(error)}`,
      );
      count++;
    }
  }
} else {
  const root = resolve(
    args[0] === "--library" ? args[1] : setting("MOLNOTES_CONTENT_DIR"),
  );
  const { entries } = await readChemicalLibrary(root);
  const css = await readFile(
    new URL("../src/ui/styles/tokens.css", import.meta.url),
    "utf8",
  );
  const runner = figureBuildRunner(entries, root, css, "lint"),
    style = await loadFigureStyle();
  try {
    for (const reference of figureProofReferences(entries, [])) {
      try {
        const result = await runner.prepare(reference, 0);
        if (result.kind !== "chemical") continue;
        for (const diagnostic of diagnoseFigure(result.geometry, style)) {
          console.log(diagnosticLine(reference.ref, reference, diagnostic));
          count++;
        }
      } catch (error) {
        console.log(
          `${reference.ref}${reference.frame ? ` [${reference.frame}]` : ""}: ${error instanceof Error ? error.message : String(error)}`,
        );
        count++;
      }
    }
  } finally {
    await runner.close();
  }
}
console.log(`Figure lint: ${count} issues`);
if (count) process.exitCode = 1;
