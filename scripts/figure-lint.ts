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
import { figureChargeDiagnostics } from "./figure-chemistry-diagnostics.ts";
import { figureLocantDiagnostics } from "./figure-text-diagnostics.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";

const args = process.argv.slice(2);
let count = 0;
let warnings = 0;
if (args.length && args[0] !== "--library") {
  for (const source of args) {
    try {
      const compiled = await compileFigureFile(source);
      for (const diagnostic of figureChargeDiagnostics(
        compiled.entries,
        await moleculeToolkit(),
      )) {
        console.log(diagnosticLine(source, compiled.reference, diagnostic));
        warnings++;
      }
      for (const diagnostic of figureLocantDiagnostics(compiled.entries)) {
        console.log(diagnosticLine(source, compiled.reference, diagnostic));
        count++;
      }
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
  for (const diagnostic of figureChargeDiagnostics(
    entries,
    await moleculeToolkit(),
  )) {
    console.log(
      diagnosticLine(diagnostic.object, { ref: diagnostic.object }, diagnostic),
    );
    warnings++;
  }
  for (const diagnostic of figureLocantDiagnostics(entries)) {
    console.log(
      diagnosticLine(diagnostic.object, { ref: diagnostic.object }, diagnostic),
    );
    count++;
  }
  const css = await readFile(
    new URL("../src/ui/styles/tokens.css", import.meta.url),
    "utf8",
  );
  const runner = figureBuildRunner(entries, root, css),
    style = await loadFigureStyle();
  try {
    for (const reference of figureProofReferences(entries, [])) {
      try {
        const result = await runner.prepare(reference, 0);
        if (result.kind !== "chemical") continue;
        const diagnostics =
          result.diagnostics ?? diagnoseFigure(result.geometry!, style);
        for (const diagnostic of diagnostics) {
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
console.log(`Figure lint: ${count} issues, ${warnings} charge warnings`);
if (count) process.exitCode = 1;
