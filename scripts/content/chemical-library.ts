import { readFile, readdir, lstat } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { parse as parseYaml } from "yaml";
import { isObject } from "../../shared/json.ts";
import { compileFigureScene } from "../figure-scene.ts";
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
import { assetResource, type AssetStage } from "./asset-stage.ts";

async function compileEntryScenes(
  value: unknown,
  entries: Library,
  directory: string,
) {
  if (
    !isObject(value) ||
    !["reaction", "mechanism"].includes(String(value.kind))
  )
    return;
  const { id, title, sources } = value;
  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    !Array.isArray(sources)
  )
    throw new Error("Authored library entry requires id, title and sources");
  const evidence = sources.map((s) => {
    if (
      !isObject(s) ||
      typeof s.source !== "string" ||
      typeof s.locator !== "string" ||
      (s.note !== undefined && typeof s.note !== "string")
    )
      throw new Error(`${id}: invalid source evidence`);
    return { source: s.source, locator: s.locator, note: s.note };
  });
  const compile = async (
    raw: unknown,
    namespace: string,
    frameTitle = title,
  ) => {
    if (!isObject(raw) || Array.isArray(raw.molecules)) return null;
    const result = await compileFigureScene(
      { ...raw, title: frameTitle },
      entries,
      directory,
      { id: namespace, sources: evidence },
    );
    const generated = result.entries[namespace];
    if (generated.kind !== "mechanism")
      throw new Error(`${id}: expected compiled scene`);
    const scene = generated.frames[0].scene;
    delete result.entries[namespace];
    Object.assign(entries, result.entries);
    return scene;
  };
  if (value.kind === "reaction") {
    const scene = await compile(value.scene, id);
    if (scene) {
      const main = scene.reactionArrows?.shift();
      if (!main)
        throw new Error(`${id}: reaction scene requires a reaction arrow`);
      value.scene = scene;
      value.arrow = {
        from: main.from,
        to: main.to,
        textWidth: Math.hypot(main.to.x - main.from.x, main.to.y - main.from.y),
      };
      value.reagents ??= main.above ?? [];
      value.conditions ??= main.below ?? [];
    }
  } else {
    if (!Array.isArray(value.frames))
      throw new Error(`${id}: frames must be an array`);
    for (const frame of value.frames) {
      if (
        !isObject(frame) ||
        typeof frame.id !== "string" ||
        typeof frame.title !== "string"
      )
        throw new Error(`${id}: frame requires id and title`);
      const scene = await compile(
        frame.scene,
        `${id}_${frame.id}`,
        frame.title,
      );
      if (scene) frame.scene = scene;
    }
  }
}

export async function readChemicalLibrary(root: string, stage?: AssetStage) {
  const entries: Library = {},
    assets: UnitAsset[] = [];
  const base = join(root, "library");
  for (const dir of [
    "compounds",
    "reactions",
    "routes",
    "mechanisms",
    "images",
    "processes",
  ]) {
    const files = await readdir(join(base, dir), { withFileTypes: true }).catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return [];
        throw e;
      },
    );
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const extension = extname(f.name);
      if (!f.isFile() || ![".json", ".yaml", ".yml"].includes(extension))
        throw new Error(`library/${dir}/${f.name}: expected JSON or YAML file`);
      const path = join(base, dir, f.name),
        text = await readFile(path, "utf8");
      const value: unknown =
        extension === ".json" ? JSON.parse(text) : parseYaml(text);
      if (extension !== ".json")
        await compileEntryScenes(value, entries, dirname(path));
      validateLibraryEntry(value, `library/${dir}/${f.name}`);
      if (f.name !== value.id + extension || entries[value.id])
        throw new Error(`library: duplicate or mismatched ID ${value.id}`);
      if (
        {
          compound: "compounds",
          reaction: "reactions",
          route: "routes",
          mechanism: "mechanisms",
          image: "images",
          process: "processes",
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
        ...(await assetResource(bytes, stage)),
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
    if (
      ("type" in value && value.type === "figure-ref") ||
      ("ref" in value &&
        typeof value.ref === "string" &&
        /^(cmp|rxn|rte|mec|img|prc)_/.test(value.ref))
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
