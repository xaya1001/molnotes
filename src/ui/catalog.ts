import { topicBasePath } from "../../shared/topic-content.ts";
export interface CatalogSite {
  slug: string;
  title: string;
  description: string;
  chapterIds: string[];
  chapterPaths: Record<string, string>;
  order: number;
  /** Absent on topics published before site.json declared a group. */
  group?: string;
}

/** A note directory with the practice topics its notes link to. */
export interface CatalogDirectory {
  slug: string;
  title: string;
  order: number;
  path: string;
  practice: string[];
}

export const sites: CatalogSite[] = [];
/** Topic groups in the order the case directory lists them. */
export const groups: string[] = [];
export const directories: CatalogDirectory[] = [];

export function catalogSite(slug: string): CatalogSite {
  const site = sites.find((item) => item.slug === slug);
  if (!site) throw new Error(`Topic has no site.json: ${slug}`);
  return site;
}

/** Public topic base; storage remains keyed by slug under sites/. */
export const topicBase = (site: Pick<CatalogSite, "slug" | "group">) =>
  `${topicBasePath(site)}/`;
