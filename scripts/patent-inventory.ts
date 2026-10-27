import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "materials",
  "patents",
);
if (!existsSync(root)) throw new Error(`Patent materials unavailable: ${root}`);

const sources = readdirSync(root)
  .filter(
    (name) =>
      name.toLowerCase().endsWith(".pdf") &&
      !name.toLowerCase().endsWith("_ocr.pdf"),
  )
  .sort();

console.table(
  sources.map((name) => {
    const stem = name.slice(0, -4);
    return {
      source: name,
      mebibytes:
        Math.round((statSync(join(root, name)).size / 1024 / 1024) * 10) / 10,
      searchablePdf: existsSync(join(root, `${stem}_OCR.pdf`)),
      textSidecar: existsSync(join(root, `${stem}_OCR.txt`)),
    };
  }),
);
