import { definePanels, panelReferences } from "../../shared/panels.ts";
import { readFile, readdir, lstat } from "node:fs/promises";
import { join, extname } from "node:path";
import { parse as parseYaml } from "yaml";
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
import { figureRouteMetrics } from "../../shared/chemical-library/routes.ts";
import { graphScenes } from "../../shared/chemical-library/figure-layout.ts";
import { moleculeToolkit } from "../../shared/molecule-toolkit.ts";
import { sha256, contentType } from "../../shared/assets.ts";
import type {
  Library,
  FigureReference,
  LibrarySnapshot,
} from "../../shared/chemical-library/types.ts";
import type { UnitAsset } from "./content-files.ts";
import { assetResource, type AssetStage } from "./asset-stage.ts";

export const libraryEntryFolders = {
  compound: "compounds",
  figure: "figures",
  image: "images",
  markush: "markush",
  conformation: "conformations",
};

export async function readChemicalLibraryEntries(root: string) {
  const entries: Library = {},
    entryFiles: Record<string, string> = {};
  const base = join(root, "library");
  for (const dir of Object.values(libraryEntryFolders)) {
    const files = await readdir(join(base, dir), { withFileTypes: true }).catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return [];
        throw e;
      },
    );
    const sorted = files.sort((a, b) => a.name.localeCompare(b.name));
    for (const f of sorted) {
      const extension = extname(f.name);
      if (!f.isFile() || ![".json", ".yaml", ".yml"].includes(extension))
        throw new Error(`library/${dir}/${f.name}: expected JSON or YAML file`);
    }
    const readChunk = 64;
    for (let i = 0; i < sorted.length; i += readChunk) {
      const slice = sorted.slice(i, i + readChunk);
      const loaded = await Promise.all(
        slice.map(async (f) => {
          const extension = extname(f.name);
          const path = join(base, dir, f.name);
          const text = await readFile(path, "utf8");
          const value: unknown =
            extension === ".json" ? JSON.parse(text) : parseYaml(text);
          return { f, extension, path, value };
        }),
      );
      for (const { f, extension, path, value } of loaded) {
        validateLibraryEntry(value, `library/${dir}/${f.name}`);
        if (f.name !== value.id + extension || entries[value.id])
          throw new Error(`library: duplicate or mismatched ID ${value.id}`);
        if (libraryEntryFolders[value.kind] !== dir)
          throw new Error(`${value.id}: wrong library directory`);
        entries[value.id] = value;
        entryFiles[value.id] = path;
      }
    }
  }
  validateLibrary(entries);
  return { entries, files: entryFiles };
}

export async function readChemicalLibrary(root: string, stage?: AssetStage) {
  const { entries, files } = await readChemicalLibraryEntries(root);
  const assets: UnitAsset[] = [];
  const base = join(root, "library");
  const toolkit = Object.keys(entries).length ? await moleculeToolkit() : null;
  const seen = new Set<string>();
  const imagesToRegister: { id: string; asset: string; mime: string }[] = [];
  for (const e of Object.values(entries)) {
    if (e.kind === "compound") validateCompound(toolkit!, e);
    if (e.kind === "figure") {
      figureRouteMetrics(e);
      for (const scene of graphScenes(e.graph))
        validateSceneChemistry(toolkit!, entries, scene, e.id);
    }
    if (e.kind === "image" && !seen.has(e.asset)) {
      seen.add(e.asset);
      imagesToRegister.push({ id: e.id, asset: e.asset, mime: e.mime });
    }
  }
  const assetChunk = 32;
  for (let i = 0; i < imagesToRegister.length; i += assetChunk) {
    const batch = await Promise.all(
      imagesToRegister
        .slice(i, i + assetChunk)
        .map(async ({ id, asset, mime }) => {
          const file = join(base, "assets", asset);
          if (!(await lstat(file)).isFile())
            throw new Error(`${id}: expected regular image asset`);
          if (contentType(asset) !== mime)
            throw new Error(`${id}: image MIME differs from extension`);
          const bytes = await readFile(file);
          const hash = sha256(bytes);
          if (!asset.startsWith(hash + "."))
            throw new Error(`${id}: image hash mismatch`);
          return {
            scope: "library" as const,
            path: `assets/${asset}`,
            ...(await assetResource(bytes, stage)),
            content_type: mime,
            prompt: null,
          };
        }),
    );
    assets.push(...batch);
  }
  return { entries, assets, files };
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
    if ("type" in value && value.type === "panels") {
      const input = Object.fromEntries(
        Object.entries(value).filter(([key]) => key !== "type" && key !== "id"),
      );
      panelReferences(definePanels(input)).forEach((reference) =>
        visit(reference, path, title),
      );
      return;
    }
    if (
      ("type" in value && value.type === "figure-ref") ||
      ("ref" in value &&
        typeof value.ref === "string" &&
        /^(cmp|rxn|rte|mec|img|cnf|mku)_/.test(value.ref))
    ) {
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
