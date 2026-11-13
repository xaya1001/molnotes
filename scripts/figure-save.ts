import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { parse, stringify } from "yaml";
import { compileFigure, figureKey } from "./figure-scene.ts";
import type { Library } from "../shared/chemical-library/types.ts";

export interface EntryChange {
  id: string;
  before: string | null;
  after: string | null;
}

/** Save one source with the same identity and persistence rules for both commands. */
export async function saveFigureSource(
  source: string,
  root: string,
  library: { entries: Library; files: Record<string, string> },
) {
  const { entries: existing, files } = library;
  const text = await readFile(source, "utf8");
  const saved = Object.values(existing).find(
    (e) =>
      e.sourceFile &&
      resolve(root, e.sourceFile) === resolve(source) &&
      !e.owner,
  );
  const key = saved?.sourceKey ?? figureKey(resolve(source));
  const result = await compileFigure(parse(text), existing, key);
  const folders = {
    compound: "compounds",
    reaction: "reactions",
    route: "routes",
    mechanism: "mechanisms",
    image: "images",
    process: "processes",
    markush: "markush",
    conformation: "conformations",
  };
  async function save(path: string, after: string) {
    const before = await readFile(path, "utf8").catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT") throw e;
        return null;
      },
    );
    if (before !== after) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, after);
    }
    return before;
  }
  const changes: EntryChange[] = [];
  for (const id of result.generated) {
    const entry = result.entries[id];
    const path =
      files[id] ?? join(root, "library", folders[entry.kind], id + ".yaml");
    const after = path.endsWith(".json")
      ? JSON.stringify(entry, null, 2) + "\n"
      : stringify(entry, { lineWidth: 0 });
    const before = await save(path, after);
    if (before !== after) changes.push({ id, before, after });
    files[id] = path;
    existing[id] = entry;
  }
  for (const entry of Object.values(existing))
    if (entry.owner === result.reference.ref && !result.entries[entry.id]) {
      const before = await readFile(files[entry.id], "utf8");
      await unlink(files[entry.id]);
      changes.push({ id: entry.id, before, after: null });
      delete files[entry.id];
      delete existing[entry.id];
    }
  await save(join(root, result.sourceFile), text);
  return { ...result, changes };
}
