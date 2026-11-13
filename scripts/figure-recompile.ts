import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { readChemicalLibrary } from "./content/chemical-library.ts";
import { setting } from "../shared/settings.ts";
import { saveFigureSource, type EntryChange } from "./figure-save.ts";

const { values, positionals } = parseArgs({
  options: { library: { type: "string" } },
  allowPositionals: true,
});
const root = resolve(values.library ?? setting("MOLNOTES_CONTENT_DIR"));
const library = await readChemicalLibrary(root);
const sources = [
  ...new Set(
    positionals.length
      ? positionals.map((source) => resolve(source))
      : Object.values(library.entries)
          .filter((entry) => entry.sourceFile && !entry.owner)
          .map((entry) => resolve(root, entry.sourceFile!)),
  ),
];
const changes = new Map<string, EntryChange>();
let failed = 0;
for (const source of sources) {
  try {
    const result = await saveFigureSource(source, root, library);
    for (const warning of result.warnings)
      console.warn(`${source}: ${warning}`);
    for (const line of result.review) console.log(line);
    for (const change of result.changes) {
      const previous = changes.get(change.id);
      changes.set(
        change.id,
        previous ? { ...change, before: previous.before } : change,
      );
    }
    console.log(`${source}: ${result.reference.ref}`);
  } catch (error) {
    failed++;
    console.error(
      `${source}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
const counts = { added: 0, modified: 0, deleted: 0 };
for (const change of [...changes.values()].sort((a, b) =>
  a.id.localeCompare(b.id),
)) {
  if (change.before === change.after) continue;
  const kind =
    change.before === null
      ? "added"
      : change.after === null
        ? "deleted"
        : "modified";
  counts[kind]++;
  console.log(`${kind}: ${change.id}`);
}
console.log(
  `Figure recompile: ${sources.length} sources, ${counts.added} added, ${counts.modified} modified, ${counts.deleted} deleted, ${failed} failed`,
);
if (failed) process.exitCode = 1;
