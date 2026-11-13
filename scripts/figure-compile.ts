import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { parse, stringify } from "yaml";
import { compileFigure, figureKey } from "./figure-scene.ts";
import { readChemicalLibrary } from "./content/chemical-library.ts";

const args = process.argv.slice(2);
const value = (flag: string) => {
  const i = args.indexOf(flag);
  return i < 0 ? undefined : args[i + 1];
};
const source = value("--source"),
  root = value("--library");
if (!source || !root)
  throw new Error(
    "Usage: npm run figure:compile -- --source <figure.yaml> --library <content-root>",
  );
const text = await readFile(source, "utf8"),
  { entries: existing, files } = await readChemicalLibrary(resolve(root));
const saved = Object.values(existing).find(
  (e) =>
    e.sourceFile && resolve(root, e.sourceFile) === resolve(source) && !e.owner,
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
};
async function save(path: string, text: string) {
  if (
    (await readFile(path, "utf8").catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
      return null;
    })) === text
  )
    return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
for (const id of result.generated) {
  const e = result.entries[id];
  await save(
    files[id] ?? join(root, "library", folders[e.kind], id + ".yaml"),
    files[id]?.endsWith(".json")
      ? JSON.stringify(e, null, 2) + "\n"
      : stringify(e, { lineWidth: 0 }),
  );
}
for (const e of Object.values(existing))
  if (e.owner === result.reference.ref && !result.entries[e.id])
    await unlink(files[e.id]);
await save(join(root, result.sourceFile), text);
for (const warning of result.warnings) console.warn(warning);
for (const line of result.review) console.log(line);
console.log(result.reference.ref);
