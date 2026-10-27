import { isObject } from "../../shared/json.ts";
import type { BodyRef, Assignment } from "../../src/ui/topic/patent.ts";
import { moleculeToolkit } from "../../shared/molecule-toolkit.ts";
import { patentBlocks } from "../../shared/patent-contract.ts";
import type { TopicContent } from "../../src/ui/topic/content.ts";
import type { UnitAsset } from "./content-files.ts";
let toolkit: Awaited<ReturnType<typeof moleculeToolkit>> | undefined;
const checked = new Set<string>();
export async function validatePatentAssets(
  content: TopicContent,
  slug: string,
  assets: UnitAsset[],
) {
  if (!patentBlocks(content).length) return;
  // The patent data passed validatePatentData; its resources are checked here.
  const where = `sites/${slug}/content.json`,
    data = content.data!;
  const get = (path: string) => {
    const found = assets.find((a) => `/${a.scope}/${a.path}` === path);
    if (!found) throw new Error(`${where}: missing resource ${path}`);
    return found;
  };
  const jsonCache = new Map<string, unknown>();
  async function json(path: string): Promise<unknown> {
    if (!jsonCache.has(path)) {
      const { bytes } = get(path);
      try {
        jsonCache.set(path, JSON.parse(bytes.toString("utf8")));
      } catch {
        throw new Error(`${where}: invalid JSON ${path}`);
      }
    }
    return jsonCache.get(path);
  }
  for (const source of Object.values(data.sources ?? {})) {
    for (let n = 1; n <= source.pages; n++)
      get(source.image.replace("{page}", String(n)));
    const text = await json(source.text);
    if (
      !Array.isArray(text) ||
      text.length !== source.pages ||
      !text.every((t) => typeof t === "string")
    )
      throw new Error(`${where}: OCR text must contain one string per page`);
  }
  for (const collection of Object.values(data.collections ?? {}))
    for (const record of collection.records)
      for (const field of collection.fields) {
        const value = record[field.key];
        if (value === undefined) continue;
        if (field.kind === "body") {
          const bodyRef = value as BodyRef;
          const body = await json(bodyRef.url);
          if (
            !isObject(body) ||
            !Object.hasOwn(body, bodyRef.key) ||
            typeof body[bodyRef.key] !== "string"
          )
            throw new Error(
              `${where}: body key ${bodyRef.key} missing from ${bodyRef.url}`,
            );
        }
        if (field.kind === "assignments")
          for (const a of value as Assignment[]) {
            if (a.basis !== "chemical-pattern") continue;
            const cache = `smarts:${a.pattern}`;
            if (!checked.has(cache)) {
              toolkit ??= await moleculeToolkit();
              let mol;
              try {
                mol = toolkit.get_qmol(a.pattern!);
                if (!mol?.is_valid()) throw new Error();
              } catch {
                throw new Error(
                  `${where}: invalid SMARTS in ${field.key}/${record.id}`,
                );
              } finally {
                mol?.delete();
              }
              checked.add(cache);
            }
          }
        if (field.kind === "smiles" && value) {
          const cache = `smiles:${value}`;
          if (!checked.has(cache)) {
            toolkit ??= await moleculeToolkit();
            let mol;
            try {
              mol = toolkit.get_mol(value as string);
              if (!mol?.is_valid()) throw new Error();
            } catch {
              throw new Error(
                `${where}: invalid SMILES in ${field.key}/${record.id}`,
              );
            } finally {
              mol?.delete();
            }
            checked.add(cache);
          }
        }
      }
  for (const set of Object.values(data.claims ?? {}))
    for (const claim of set.claims) {
      for (const segment of claim.segments) get(segment.asset!);
      if (claim.scope) {
        const cache = `smarts:${claim.scope.smarts}`;
        if (!checked.has(cache)) {
          toolkit ??= await moleculeToolkit();
          let mol;
          try {
            mol = toolkit.get_qmol(claim.scope.smarts);
            if (!mol?.is_valid()) throw new Error();
          } catch {
            throw new Error(`${where}: invalid SMARTS in claim ${claim.id}`);
          } finally {
            mol?.delete();
          }
          checked.add(cache);
        }
      }
    }
  function walk(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "asset" && typeof item === "string") get(item);
      walk(item);
    }
  }
  walk(data);
}
