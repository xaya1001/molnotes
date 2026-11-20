import { resolve } from "node:path";
import { readChemicalLibrary } from "./content/chemical-library.ts";
import { saveFigureSource } from "./figure-save.ts";

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
const library = await readChemicalLibrary(resolve(root));
const result = await saveFigureSource(
  resolve(source),
  resolve(root),
  library,
).catch((error: unknown) => {
  throw new Error(
    `${source}: ${error instanceof Error ? error.message : String(error)}`,
  );
});
for (const warning of result.warnings) console.warn(warning);
for (const line of result.review) console.log(line);
console.log(result.reference.ref);
