import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

/** Hash the rendering sources and their literal local imports, styles and fonts. */
export async function figureRendererFingerprint(root: string) {
  const files = new Set<string>();
  const visit = async (file: string) => {
    if (files.has(file)) return;
    files.add(file);
    if (![".ts", ".vue", ".css"].includes(extname(file))) return;
    const source = (await readFile(file, "utf8")).replace(
      /\bimport\s+type\b[^;]*;/g,
      "",
    );
    const imports = [
      ...[
        ...source.matchAll(/\b(?:from|import)\s*(?:\(\s*)?["']([^"']+)["']/g),
      ].map((m) => m[1]),
      ...[...source.matchAll(/@import\s+["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...source.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/g)].map(
        (m) => m[1],
      ),
    ];
    for (const input of imports) {
      const specifier = input.split("?")[0];
      if (!specifier.startsWith(".") && !specifier.startsWith("@fontsource/"))
        continue;
      const base = specifier.startsWith(".")
        ? resolve(dirname(file), specifier)
        : join(root, "node_modules", specifier);
      let found: string | undefined;
      for (const path of [base, base + ".ts", base + ".vue", base + ".css"]) {
        if (
          await stat(path).then(
            (s) => s.isFile(),
            () => false,
          )
        ) {
          found = path;
          break;
        }
      }
      if (!found)
        throw new Error(
          `Missing figure renderer input: ${relative(root, base)}`,
        );
      await visit(found);
    }
  };
  for (const file of [
    "scripts/figure-browser.ts",
    "src/ui/library/render.ts",
    "src/ui/library/diagnostics.ts",
    "src/ui/topic/ProcessViewer.vue",
    "src/ui/styles/index.css",
    "package-lock.json",
  ])
    await visit(join(root, file));
  const hash = createHash("sha256");
  for (const file of [...files].sort())
    hash
      .update(relative(root, file))
      .update("\0")
      .update(await readFile(file))
      .update("\0");
  return hash.digest("hex");
}
