import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import { contentType, sha256 } from "../shared/assets.ts";
import { validateLibraryEntry } from "../shared/chemical-library/contract.ts";
import { isObject } from "../shared/json.ts";
import { readChemicalLibrary } from "./content/chemical-library.ts";
import { pythonInterpreter } from "./python.ts";

/** Register original image bytes using the library's existing identity and schema. */
export async function registerImage(
  file: string,
  root: string,
  metadata: unknown,
  prompt?: string,
) {
  const bytes = await readFile(file);
  const hash = sha256(bytes);
  const library = await readChemicalLibrary(root);
  const existing = Object.values(library.entries).find(
    (entry) => entry.kind === "image" && entry.asset.startsWith(hash + "."),
  );
  if (existing) return existing.id;
  if (!isObject(metadata)) throw new Error("Expected image metadata mapping");
  const extension = extname(file).toLowerCase();
  if (!/^\.(png|jpe?g|webp|gif)$/.test(extension))
    throw new Error("Expected a PNG, JPEG, WebP or GIF image");
  const [width, height, mime] = JSON.parse(
    execFileSync(
      pythonInterpreter(),
      [
        "-c",
        "import io,json,sys\nfrom PIL import Image\nimage=Image.open(io.BytesIO(sys.stdin.buffer.read()))\nimage.load()\nprint(json.dumps([*image.size,Image.MIME[image.format]]))",
      ],
      { input: bytes, encoding: "utf8" },
    ),
  );
  if (mime !== contentType(file))
    throw new Error("Image MIME differs from extension");
  const asset = `${hash}${extension}`;
  const entry: unknown = {
    ...metadata,
    ...(prompt === undefined ? {} : { prompt }),
    kind: "image",
    id: `img_${hash}`,
    asset,
    mime,
    width,
    height,
  };
  validateLibraryEntry(entry, file);
  await mkdir(join(root, "library/assets"), { recursive: true });
  await mkdir(join(root, "library/images"), { recursive: true });
  await writeFile(join(root, "library/assets", asset), bytes);
  await writeFile(
    join(root, "library/images", `${entry.id}.json`),
    JSON.stringify(entry, null, 2) + "\n",
  );
  return entry.id;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      library: { type: "string" },
      metadata: { type: "string" },
      "prompt-file": { type: "string" },
    },
  });
  if (positionals.length !== 1 || !values.library || !values.metadata)
    throw new Error(
      "Usage: npm run figure:image -- <image> --library <content-root> --metadata <yaml> [--prompt-file <prompt.md>]",
    );
  const metadata: unknown = parse(await readFile(values.metadata, "utf8"));
  const prompt = values["prompt-file"]
    ? await readFile(values["prompt-file"], "utf8")
    : undefined;
  console.log(
    await registerImage(positionals[0], values.library, metadata, prompt),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
