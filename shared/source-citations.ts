// The site-wide source registry (sources.json in the content directory) and
// the citations notes and topics write against it. Publication resolves each
// citation on the shelf; the browser shares the syntax check.
import type { Unchecked } from "./unchecked.ts";

/** A parsed `src:` citation: pages for a PDF, a chapter for an EPUB, neither for a web page. */
export interface ParsedCitation {
  id: string;
  first?: number;
  last?: number;
  print?: string;
  rect?: number[];
  chapter?: string;
  section?: string;
}

export interface RegisteredSource {
  file: string;
  title: string;
  kind: string;
  author?: string;
  edition?: string;
}

export type SourceRegistry = Record<string, RegisteredSource>;

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const citationPattern =
  /^src:([a-z0-9]+(?:-[a-z0-9]+)*)(?:#(?:([1-9]\d*)(?:-([1-9]\d*))?(?:&print=([0-9A-Za-z]+))?(?:&rect=((?:\d+(?:\.\d+)?,){3}\d+(?:\.\d+)?))?|ch=([1-9]\d*(?:\.[1-9]\d*)*)(?:&sec=([1-9]\d*(?:\.[1-9]\d*)*))?))?$/;
/** A PDF citation shows at most this many cited pages; longer readings are cited in parts. */
export const maxCitedPages = 60;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/**
 * `src:<id>` for an archived web page, `src:<id>#<first>[-<last>]` for PDF
 * pages, optionally followed by `&print=<printed page of first>` and
 * `&rect=<x0>,<y0>,<x1>,<y1>` (PDF points on the first page), and
 * `src:<id>#ch=<path>[&sec=<path>]` for an epub navigation entry, with the
 * section's path below that entry.
 */
export function parseCitation(value: unknown): ParsedCitation {
  const match = typeof value === "string" ? citationPattern.exec(value) : null;
  if (!match)
    throw new Error(
      `invalid citation ${value}: expected src:<id>, src:<id>#<first>-<last> or src:<id>#ch=<path>`,
    );
  const [, id, first, last, print, rect, chapter, section] = match;
  if (chapter !== undefined)
    return section === undefined ? { id, chapter } : { id, chapter, section };
  if (first === undefined) return { id };
  const citation: ParsedCitation & { first: number; last: number } = {
    id,
    first: Number(first),
    last: Number(last ?? first),
  };
  if (citation.last < citation.first)
    throw new Error(`invalid citation ${value}: last page before first`);
  if (citation.last - citation.first + 1 > maxCitedPages)
    throw new Error(
      `invalid citation ${value}: cite at most ${maxCitedPages} pages at once`,
    );
  if (print !== undefined) citation.print = print;
  if (rect !== undefined) {
    citation.rect = rect.split(",").map(Number);
    const [x0, y0, x1, y1] = citation.rect;
    if (x1 <= x0 || y1 <= y0)
      throw new Error(`invalid citation ${value}: empty rectangle`);
  }
  return citation;
}

/**
 * The citations of a topic's content.json with their locations: `cite` on a
 * source (a list), on an excerpt and on a reading item (one each).
 */
export function contentCitations(
  content: Unchecked,
  name = "content.json",
): { href: unknown; where: string }[] {
  const found: { href: unknown; where: string }[] = [];
  const add = (item: unknown, at: string, list: boolean) => {
    if (!isObject(item) || item.cite === undefined) return;
    if (!list) {
      found.push({ href: item.cite, where: `${name}: ${at}.cite` });
      return;
    }
    if (!Array.isArray(item.cite) || !item.cite.length)
      throw new Error(`${name}: ${at}.cite must list citations`);
    item.cite.forEach((href: unknown, i: number) =>
      found.push({ href, where: `${name}: ${at}.cite[${i}]` }),
    );
  };
  const each = (items: unknown, at: string, list = false) => {
    if (Array.isArray(items))
      items.forEach((item, i) => add(item, `${at}[${i}]`, list));
  };
  each(content.sources, "sources", true);
  each(content.excerpts, "excerpts");
  each(content.reading, "reading");
  (content.chapters ?? []).forEach((chapter: Unchecked, i: number) => {
    each(chapter?.excerpts, `chapters[${i}].excerpts`);
    each(chapter?.reading, `chapters[${i}].reading`);
  });
  return found;
}

/**
 * The registered source a citation names; PDF citations need pages, epub
 * citations a chapter, web pages take neither.
 */
export function citedSource(registry: SourceRegistry, value: unknown) {
  const citation = parseCitation(value);
  const source = registry[citation.id];
  if (!Object.hasOwn(registry, citation.id))
    throw new Error(`${value}: source ${citation.id} is not in sources.json`);
  const kind = source.file.slice(source.file.lastIndexOf("."));
  if (kind === ".pdf" && citation.first === undefined)
    throw new Error(`${value}: a PDF citation needs pages (#<first>-<last>)`);
  if (kind === ".epub" && citation.chapter === undefined)
    throw new Error(`${value}: an EPUB citation needs a chapter (#ch=<path>)`);
  if (
    kind === ".html" &&
    (citation.first !== undefined || citation.chapter !== undefined)
  )
    throw new Error(`${value}: an archived web page is cited without pages`);
  return { source, citation };
}

/** Throws on the first problem; returns the registry unchanged. */
export function validateSourceRegistry(
  registry: unknown,
  name = "sources.json",
): SourceRegistry {
  if (!isObject(registry)) throw new Error(`${name} must be an object`);
  const files = new Map<string, string>();
  for (const [id, source] of Object.entries(registry)) {
    const where = `${name}: ${id}`;
    if (!idPattern.test(id)) throw new Error(`${where}: invalid id`);
    if (!isObject(source)) throw new Error(`${where} must be an object`);
    for (const key of Object.keys(source))
      if (!["file", "title", "kind", "author", "edition"].includes(key))
        throw new Error(`${where}: unknown field ${key}`);
    const { file, title, kind } = source;
    if (!text(file)) throw new Error(`${where}: file must be text`);
    if (!text(title)) throw new Error(`${where}: title must be text`);
    if (!text(kind)) throw new Error(`${where}: kind must be text`);
    for (const key of ["author", "edition"])
      if (source[key] !== undefined && !text(source[key]))
        throw new Error(`${where}: ${key} must be text`);
    if (
      !/^[^/].*\.(pdf|epub|html)$/.test(file) ||
      file.split("/").some((part) => ["", ".", ".."].includes(part))
    )
      throw new Error(
        `${where}: file must be a .pdf, .epub or .html path inside materials/`,
      );
    if (files.has(file))
      throw new Error(
        `${where}: ${file} is already registered as ${files.get(file)}`,
      );
    files.set(file, id);
  }
  // Every entry has passed the checks above.
  return registry as SourceRegistry;
}
