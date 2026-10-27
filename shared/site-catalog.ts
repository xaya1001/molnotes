// Validates topic metadata and sorts the published catalog.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Topic groups in the order the case directory lists them; 练习 topics list under /practice/. */
export const siteGroups = [
  "靶点案例",
  "药化进阶",
  "专利拆解",
  "合成与机理",
  "谱图",
  "读书复习",
  "入门专题",
  "练习",
];

export interface SiteManifest {
  slug: string;
  title: string;
  description: string;
  order: number;
  group: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validates one manifest; `slug` comes from the folder name. */
export function parseSiteManifest(slug: string, value: unknown): SiteManifest {
  if (!slugPattern.test(slug)) throw new Error(`Invalid site slug: ${slug}`);
  if (
    !isRecord(value) ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    typeof value.description !== "string" ||
    !value.description.trim() ||
    typeof value.order !== "number" ||
    !Number.isInteger(value.order) ||
    value.order < 1
  ) {
    throw new Error(
      `sites/${slug}/site.json needs title, description and a positive integer order`,
    );
  }
  if (typeof value.group !== "string" || !siteGroups.includes(value.group))
    throw new Error(
      `sites/${slug}/site.json: group must be one of ${siteGroups.join("、")}`,
    );
  return {
    slug,
    title: value.title,
    description: value.description,
    order: value.order,
    group: value.group,
  };
}

/** Home page order: by `order`, then slug, so parallel additions never conflict. */
export function sortSites<T extends { order: number; slug: string }>(
  sites: readonly T[],
): T[] {
  return [...sites].sort(
    (a, b) => a.order - b.order || a.slug.localeCompare(b.slug),
  );
}

export function readSiteCatalog(root: string): SiteManifest[] {
  const siteRoot = resolve(root, "sites");
  if (!existsSync(siteRoot)) return [];
  const sites: SiteManifest[] = [];
  for (const entry of readdirSync(siteRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = resolve(siteRoot, entry.name, "site.json");
    if (!existsSync(manifest))
      throw new Error(`Missing manifest: sites/${entry.name}/site.json`);
    sites.push(
      parseSiteManifest(entry.name, JSON.parse(readFileSync(manifest, "utf8"))),
    );
  }
  return sortSites(sites);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  for (const { slug } of readSiteCatalog(root))
    process.stdout.write(`${slug}\n`);
}
