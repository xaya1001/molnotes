import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { readChemicalLibrary } from "./content/chemical-library.ts";
import { libraryInventory } from "./content/library-inventory.ts";
import {
  validateFigureReference,
  validateLibraryEntry,
} from "../shared/chemical-library/contract.ts";
import { figureBrowser } from "./figure-browser.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  prepareCompound,
  prepareInputVariant,
  validateCompound,
} from "../shared/chemical-library/chemistry.ts";
import type { Compound } from "../shared/chemical-library/types.ts";
const args = process.argv.slice(2);
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
const root = value("--library"),
  out = value("--out");
if (!root || !out)
  throw new Error(
    "Usage: npm run figure:render -- --library <content-root> --out <directory> [--entry <id>]",
  );
await mkdir(out, { recursive: true });
const input = value("--prepare");
if (input) {
  const draft = JSON.parse(await readFile(input, "utf8"));
  const molfile = value("--molfile");
  const toolkit = await moleculeToolkit();
  let entry: Compound;
  if (draft.compound !== undefined) {
    validateLibraryEntry(draft.compound);
    if (
      draft.compound.kind !== "compound" ||
      typeof draft.variant !== "string" ||
      !draft.variant.trim() ||
      typeof draft.inputSmiles !== "string"
    )
      throw new Error(
        "Input variant requires compound, variant and inputSmiles",
      );
    const layout = prepareInputVariant(
      toolkit,
      draft.compound,
      draft.inputSmiles,
      draft.abbreviations,
    );
    entry = {
      ...draft.compound,
      variants: { ...draft.compound.variants, [draft.variant]: layout },
    };
    validateCompound(toolkit, entry);
  } else
    entry = prepareCompound(
      toolkit,
      draft,
      molfile ? await readFile(molfile, "utf8") : undefined,
    );
  validateLibraryEntry(entry);
  await writeFile(
    join(out, `${entry.id}.json`),
    JSON.stringify(entry, null, 2) + "\n",
  );
} else if (args.includes("--inventory")) {
  const { entries } = await readChemicalLibrary(resolve(root));
  await writeFile(
    join(out, "migration-candidates.json"),
    JSON.stringify(await libraryInventory(resolve(root), entries), null, 2) +
      "\n",
  );
} else {
  const started = performance.now();
  const entries = (await readChemicalLibrary(resolve(root))).entries;
  const selected = value("--entry");
  const refsFile = value("--references");
  const references: import("../shared/chemical-library/types.ts").FigureReference[] =
    [];
  if (refsFile) {
    const values: unknown = JSON.parse(await readFile(refsFile, "utf8"));
    if (!Array.isArray(values)) throw new Error("References must be an array");
    for (const ref of values) {
      validateFigureReference(ref);
      references.push(ref);
    }
  }
  const runner = await figureBrowser(entries, resolve(root));
  let failed = false;
  try {
    for (const entry of Object.values(entries).filter(
      (e) =>
        (!selected || e.id === selected) &&
        (!refsFile || references.some((r) => r.ref === e.id)),
    )) {
      const refs = refsFile
        ? references.filter((r) => r.ref === entry.id)
        : entry.kind === "mechanism"
          ? entry.frames.map((f) => ({ ref: entry.id, frame: f.id }))
          : [{ ref: entry.id }];
      for (const ref of refs)
        for (const width of value("--width")
          ? [Number(value("--width"))]
          : [1366, 390]) {
          const result = await runner.render(ref, width);
          const name = `${ref.ref}${"frame" in ref ? "-" + ref.frame : ""}-${width}`;
          if (!args.includes("--check") && result.svg !== null)
            await writeFile(join(out, name + ".svg"), result.svg);
          await writeFile(
            join(out, name + ".json"),
            JSON.stringify(result, null, 2),
          );
          if (!args.includes("--check")) {
            await runner.page
              .locator("#canvas")
              .screenshot({ path: join(out, name + ".png") });
            await runner.page.screenshot({
              path: join(out, name + "-context.png"),
            });
          }
          failed ||= result.diagnostics.some((d) => d.severity === "error");
          console.log(`${name}: ${result.diagnostics.length} diagnostics`);
        }
    }
    for (const ref of references)
      if (!entries[ref.ref]) throw new Error(`Unknown entry ${ref.ref}`);
    if (selected && !entries[selected])
      throw new Error(`Unknown entry ${selected}`);
  } finally {
    await runner.close();
  }
  console.log(
    `Rendered in ${((performance.now() - started) / 1000).toFixed(1)} s`,
  );
  if (failed) process.exitCode = 1;
}
