import { validateScopeProducts } from "../../shared/reaction-chemistry.ts";
import { resolveData } from "../../shared/topic-blocks.ts";
import type { TopicBlock } from "../../src/ui/topic/blocks.ts";
import {
  abbreviatedGroups,
  validateAbbreviations,
  validateAbbreviatedReferences,
} from "../../shared/molecule-abbreviations.ts";
import { moleculeToolkit } from "../../shared/molecule-toolkit.ts";
import { isObject } from "../../shared/json.ts";

let toolkit: Awaited<ReturnType<typeof moleculeToolkit>> | undefined;
const checkedSmiles = new Set<string>();

export function validateChapterTerms(
  chapter: { id: string; terms?: readonly string[] },
  terms: ReadonlySet<string>,
  where: string,
) {
  for (const term of chapter.terms ?? [])
    if (!terms.has(term))
      throw new Error(
        `${where}: chapter ${chapter.id} uses unknown term ${term}`,
      );
}

export async function validateTopicSchemes(
  blocks: TopicBlock[],
  data: Record<string, unknown> | undefined,
  where: string,
) {
  for (const block of blocks) {
    if (block.type === "tabs")
      for (const item of block.items)
        await validateTopicSchemes(item.blocks, data, where);
    if (block.type === "substrate-scope") {
      toolkit ??= await moleculeToolkit();
      validateScopeProducts(
        toolkit,
        resolveData(block.scope, data, where),
        where,
      );
    }
  }
}

export async function validateTopicValues(
  value: unknown,
  path: string,
  slug: string,
  data: Record<string, unknown> | undefined,
  {
    routes,
    assets,
  }: { routes: ReadonlySet<string>; assets: ReadonlySet<string> },
) {
  const where = `sites/${slug}/content.json`;
  async function visit(
    value: unknown,
    path: string,
    parent?: Record<string, unknown>,
  ): Promise<void> {
    if (Array.isArray(value)) {
      for (const [i, item] of value.entries())
        await visit(item, `${path}[${i}]`, parent);
      return;
    }
    if (!value || typeof value !== "object") return;
    const flowEdge =
      parent &&
      Array.isArray(parent.nodes) &&
      Array.isArray(parent.edges) &&
      parent.edges.includes(value);
    for (const [key, item] of Object.entries(value)) {
      const location = `${path}.${key}`;
      if (
        key === "smiles" &&
        typeof item === "string" &&
        item !== "" &&
        (!checkedSmiles.has(item) || "abbreviations" in value)
      ) {
        toolkit ??= await moleculeToolkit();
        let mol;
        try {
          mol = toolkit.get_mol(item);
          if (!mol?.is_valid())
            throw new Error(`${where}:${location}: invalid SMILES`);
          const data = value as Record<string, unknown>;
          validateAbbreviations(data.abbreviations, `${where}:${path}`);
          const groups = abbreviatedGroups(
            toolkit,
            mol,
            data.abbreviations,
            `${where}:${path}`,
          );
          const exercise =
            parent &&
            (parent.molecule === value ||
              (Array.isArray(parent.molecules) &&
                parent.molecules.includes(value)))
              ? parent
              : {};
          validateAbbreviatedReferences(
            mol,
            groups,
            { ...exercise, ...data },
            `${where}:${path}`,
          );
        } finally {
          mol?.delete();
        }
        checkedSmiles.add(item);
      }
      if (
        typeof item === "string" &&
        ["src", "url", "href", "to", "image"].includes(key) &&
        !(key === "to" && flowEdge)
      ) {
        if (
          item &&
          !(
            key === "image" &&
            Object.values(data?.sources ?? {}).some(
              (source) => isObject(source) && source.image === item,
            )
          ) &&
          !/^(https?:|mailto:|\/\/)/i.test(item) &&
          (key !== "image" || item.includes("/"))
        ) {
          const url = new URL(item, `http://content.local/sites/${slug}/`);
          if (url.origin !== "http://content.local")
            throw new Error(`${where}:${location}: unsupported link ${item}`);
          const pathname = url.pathname;
          const asset =
            /^\/(?:sites\/[^/]+\/static|notes\/[^/]+\/assets)\//.test(pathname);
          if (!(asset ? assets : routes).has(decodeURI(pathname)))
            throw new Error(
              `${where}:${location}: unknown ${asset ? "resource" : "internal link"} ${item}`,
            );
        }
      }
      await visit(item, location, value as Record<string, unknown>);
    }
  }
  await visit(value, path);
}
