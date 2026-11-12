import { isObject } from "../../shared/json.ts";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";

/** Hash the rendering sources and their literal local imports, styles and fonts. */
export async function figureRendererFingerprint(root: string, roots: string[]) {
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
  for (const file of roots) await visit(join(root, file));
  const hash = createHash("sha256");
  for (const file of [...files].sort())
    hash
      .update(relative(root, file))
      .update("\0")
      .update(await readFile(file))
      .update("\0");
  return hash.digest("hex");
}

/** Include only the installed rendering packages and their locked dependency closure. */
export async function figureDependencyFingerprint(
  root: string,
  names: string[],
) {
  const lock: unknown = JSON.parse(
    await readFile(join(root, "package-lock.json"), "utf8"),
  );
  if (!isObject(lock) || !isObject(lock.packages))
    throw new Error("Missing locked figure dependencies");
  const packages = lock.packages,
    selected = new Map<string, unknown>();
  const visit = (name: string, parent = "") => {
    let directory = parent,
      path: string;
    for (;;) {
      path = (directory ? directory + "/" : "") + "node_modules/" + name;
      if (path in packages) break;
      if (!directory) throw new Error(`Missing locked dependency ${name}`);
      const index = directory.lastIndexOf("node_modules/");
      directory = index > 0 ? directory.slice(0, index - 1) : "";
    }
    if (selected.has(path)) return;
    const entry = packages[path];
    if (!isObject(entry)) throw new Error(`Invalid locked dependency ${name}`);
    selected.set(path, {
      version: entry.version,
      integrity: entry.integrity,
      resolved: entry.resolved,
    });
    for (const field of [entry.dependencies, entry.optionalDependencies])
      if (isObject(field))
        for (const child of Object.keys(field)) visit(child, path);
  };
  names.forEach((name) => visit(name));
  return createHash("sha256")
    .update(
      JSON.stringify(
        [...selected].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      ),
    )
    .digest("hex");
}
