import { readFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import {
  validateLibrary,
  validateLibraryEntry,
  libraryDependencies,
  validateFigureReference,
  validateFigureInstance,
} from "../../shared/chemical-library/contract.ts";
import {
  validateCompound,
  validateSceneChemistry,
} from "../../shared/chemical-library/chemistry.ts";
import { routeMetrics } from "../../shared/chemical-library/routes.ts";
import { moleculeToolkit } from "../../shared/molecule-toolkit.ts";
import { sha256, contentType } from "../../shared/assets.ts";
import type {
  Library,
  FigureReference,
  LibrarySnapshot,
} from "../../shared/chemical-library/types.ts";
import type { UnitAsset } from "./content-files.ts";

export async function readChemicalLibrary(root: string) {
  const entries: Library = {},
    assets: UnitAsset[] = [];
  const base = join(root, "library");
  for (const dir of [
    "compounds",
    "reactions",
    "routes",
    "mechanisms",
    "images",
  ]) {
    const files = await readdir(join(base, dir), { withFileTypes: true }).catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return [];
        throw e;
      },
    );
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!f.isFile() || !f.name.endsWith(".json"))
        throw new Error(`library/${dir}/${f.name}: expected JSON file`);
      const value: unknown = JSON.parse(
        await readFile(join(base, dir, f.name), "utf8"),
      );
      validateLibraryEntry(value, `library/${dir}/${f.name}`);
      if (f.name !== value.id + ".json" || entries[value.id])
        throw new Error(`library: duplicate or mismatched ID ${value.id}`);
      if (
        {
          compound: "compounds",
          reaction: "reactions",
          route: "routes",
          mechanism: "mechanisms",
          image: "images",
        }[value.kind] !== dir
      )
        throw new Error(`${value.id}: wrong library directory`);
      entries[value.id] = value;
    }
  }
  validateLibrary(entries);
  const toolkit = Object.keys(entries).length ? await moleculeToolkit() : null;
  const seen = new Set<string>();
  for (const e of Object.values(entries)) {
    if (e.kind === "compound") validateCompound(toolkit!, e);
    if (e.kind === "route") routeMetrics(e, entries);
    if (e.kind === "reaction")
      validateSceneChemistry(toolkit!, entries, e.scene, e.id);
    if (e.kind === "mechanism")
      for (const frame of e.frames)
        validateSceneChemistry(
          toolkit!,
          entries,
          frame.scene,
          `${e.id}/${frame.id}`,
        );
    if (e.kind === "image" && !seen.has(e.asset)) {
      const file = join(base, "assets", e.asset);
      if (!(await lstat(file)).isFile())
        throw new Error(`${e.id}: expected regular image asset`);
      if (contentType(e.asset) !== e.mime)
        throw new Error(`${e.id}: image MIME differs from extension`);
      const bytes = await readFile(file);
      const hash = sha256(bytes);
      if (!e.asset.startsWith(hash + "."))
        throw new Error(`${e.id}: image hash mismatch`);
      seen.add(e.asset);
      assets.push({
        scope: "library",
        path: `assets/${e.asset}`,
        bytes,
        sha256: hash,
        size: bytes.length,
        content_type: e.mime,
        prompt: null,
      });
    }
  }
  return { entries, assets };
}
export function libraryUsage(
  entries: Library,
  values: { value: unknown; path: string; title: string }[],
): { snapshot: LibrarySnapshot; references: FigureReference[] } {
  const uses: LibrarySnapshot["uses"] = Object.fromEntries(
    Object.keys(entries).map((id) => [id, []]),
  );
  const references: FigureReference[] = [];
  function visit(value: unknown, path: string, title: string) {
    if (Array.isArray(value)) {
      value.forEach((v) => visit(v, path, title));
      return;
    }
    if (!value || typeof value !== "object") return;
    if ("type" in value && value.type === "figure-ref") {
      validateFigureReference(value);
      if (!entries[value.ref])
        throw new Error(`${path}: unknown figure ${value.ref}`);
      validateFigureInstance(entries, value);
      uses[value.ref].push({ path, title });
      references.push(value);
      return;
    }
    if ("figure" in value && value.figure) {
      validateFigureReference(value.figure, path);
      visit({ type: "figure-ref", ...value.figure }, path, title);
    }
    Object.entries(value)
      .filter(([k]) => k !== "figure")
      .forEach(([, v]) => visit(v, path, title));
  }
  values.forEach((v) => visit(v.value, v.path, v.title));
  for (const e of Object.values(entries))
    for (const id of libraryDependencies(e))
      uses[id].push({ path: `/library/#${e.id}`, title: e.title });
  const identities = new Map<string, string[]>();
  for (const e of Object.values(entries)) {
    const key =
      e.kind === "compound"
        ? `compound:${e.graph}:${e.form ?? ""}`
        : e.kind === "image"
          ? `image:${e.asset}`
          : undefined;
    if (key) identities.set(key, [...(identities.get(key) ?? []), e.id]);
  }
  const audit = {
    orphans: Object.keys(uses).filter((id) => !uses[id].length),
    duplicates: [...identities.values()].filter((ids) => ids.length > 1),
  };
  return { snapshot: { entries, uses, audit }, references };
}
