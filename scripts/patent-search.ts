import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "materials",
  "patents",
);
const [source, query] = process.argv.slice(2);
if (!source || !query?.trim()) {
  throw new Error('Usage: npm run patent:search -- "source.pdf" "query"');
}
const sources = readdirSync(root).filter(
  (name) =>
    name.toLowerCase().endsWith(".pdf") &&
    !name.toLowerCase().endsWith("_ocr.pdf"),
);
if (!sources.includes(source))
  throw new Error(`Source PDF not found: ${source}`);

const sidecar = join(root, `${source.slice(0, -4)}_OCR.txt`);
if (!existsSync(sidecar))
  throw new Error(`OCR text sidecar not found for: ${source}`);
const text = readFileSync(sidecar, "utf8");
const needle = query.trim().toLocaleLowerCase();
const pages = text.split("\f");
let matches = 0;

for (const [index, page] of pages.entries()) {
  const searchable = page.toLocaleLowerCase();
  let position = searchable.indexOf(needle);
  while (position !== -1 && matches < 20) {
    const excerpt = page
      .slice(
        Math.max(0, position - 90),
        Math.min(page.length, position + query.length + 90),
      )
      .replace(/\s+/g, " ")
      .trim();
    console.log(`OCR page ${index + 1}: ${excerpt}`);
    matches += 1;
    position = searchable.indexOf(needle, position + needle.length);
  }
  if (matches === 20) break;
}

if (matches === 0) console.log("No literal matches in OCR text.");
if (matches === 20) console.log("Showing the first 20 matches.");
console.log("Verify every cited finding against the original PDF page image.");
