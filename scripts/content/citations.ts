import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { citedSource } from "../../shared/source-citations.ts";
import { contentType, sha256 } from "../../shared/assets.ts";
import type { Citations } from "../../shared/snapshot.ts";
import type { SourceRegistry } from "../../shared/source-citations.ts";
import type { CitationOccurrence, UnitAsset } from "./content-files.ts";

/** The materials shelf and its render cache (MOLNOTES_MATERIALS_DIR, MOLNOTES_MATERIALS_CACHE). */
export interface Shelf {
  materials?: string;
  cache?: string;
}
/** A rendered PDF page `material.py cite` returns; `size` is in PDF points. */
interface ShownPage {
  page: number;
  size: [number, number];
  image: string;
}
export interface MaterialResult {
  error?: string;
  pages: number;
  shown: ShownPage[];
  html: string;
  images: string[];
  sections: Record<string, string>;
  chapter: string;
  url: string;
  downloaded: string;
}
type ShelfRequest =
  | { file: string; first: number; last: number | undefined }
  | { file: string; chapter: string }
  | { file: string };

const script = fileURLToPath(new URL("../material.py", import.meta.url));

/** Runs `material.py cite`; the shelf answers each request with a result or an error. */
// Each result is an error or the files `material.py cite` rendered for its request.
function material(
  requests: ShelfRequest[],
  shelf: Shelf,
): Promise<MaterialResult[]> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (shelf.materials) env.MOLNOTES_MATERIALS_DIR = shelf.materials;
    if (shelf.cache) env.MOLNOTES_MATERIALS_CACHE = shelf.cache;
    const child = spawn("python3", ["-I", script, "cite"], { env });
    let stdout = "",
      stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", () => reject(new Error("material.py could not start")));
    child.once("close", (code) => {
      if (code !== 0)
        reject(
          new Error(
            `material.py cite failed: ${stderr.trim().split("\n").at(-1)}`,
          ),
        );
      else resolve(JSON.parse(stdout));
    });
    child.stdin.end(JSON.stringify({ requests }));
  });
}

/**
 * Resolves the citations of each unit (`{ scope, occurrences: [{ href, where }] }`)
 * against the registry and the shelf. Each unit receives the viewer data per
 * href and the page images, article and chapter images and bodies it
 * publishes as `cited/<sha256>.<ext>` assets.
 */
export async function resolveCitations(
  registry: SourceRegistry,
  units: { scope: string; occurrences: CitationOccurrence[] }[],
  shelf: Shelf = {},
): Promise<{ citations: Citations; assets: UnitAsset[] }[]> {
  const requests: ShelfRequest[] = [],
    requestIndex = new Map<string, number>();
  const planned = units.map(({ occurrences }) =>
    occurrences.map(({ href, where }) => {
      let target;
      try {
        target = citedSource(registry, href);
      } catch (error) {
        throw new Error(`${where}: ${(error as Error).message}`);
      }
      const { file } = target.source;
      const { first, last, chapter } = target.citation;
      const key = JSON.stringify([file, first, last, chapter]);
      if (!requestIndex.has(key)) {
        requestIndex.set(key, requests.length);
        requests.push(
          first !== undefined
            ? { file, first, last }
            : chapter !== undefined
              ? { file, chapter }
              : { file },
        );
      }
      // citedSource accepted `href`, so it is a citation string.
      return {
        href: href as string,
        where,
        ...target,
        result: requestIndex.get(key)!,
      };
    }),
  );
  const results = requests.length ? await material(requests, shelf) : [];
  const files = new Map<string, Promise<Buffer>>();
  const read = (path: string) => {
    if (!files.has(path)) files.set(path, readFile(path));
    return files.get(path)!;
  };
  return Promise.all(
    units.map(async ({ scope }, unitIndex) => {
      const citations: Citations = {},
        assets = new Map<string, UnitAsset>();
      const asset = (bytes: Buffer, extension: string) => {
        const hash = sha256(bytes);
        const path = `cited/${hash}${extension}`;
        assets.set(path, {
          scope,
          path,
          sha256: hash,
          size: bytes.length,
          content_type: contentType(path),
          prompt: null,
          bytes,
        });
        return `/${scope}/${path}`;
      };
      // Cleaned HTML with its image placeholders pointing at the uploaded images.
      const body = async ({
        html,
        images,
      }: {
        html: string;
        images: string[];
      }) => {
        for (const [index, image] of images.entries())
          html = html.replaceAll(
            `src="IMAGE:${index}"`,
            `src="${asset(await read(image), extname(image).toLowerCase())}"`,
          );
        return asset(Buffer.from(JSON.stringify({ html })), ".json");
      };
      for (const item of planned[unitIndex]) {
        if (Object.hasOwn(citations, item.href)) continue;
        const result = results[item.result];
        if (result.error) throw new Error(`${item.where}: ${result.error}`);
        const { title, kind, author, edition } = item.source;
        const data = { title, kind, author, edition };
        const { first, last, print, rect, chapter, section } = item.citation;
        if (first !== undefined) {
          const firstPage = result.shown.find(
            (page: ShownPage) => page.page === first,
          )!;
          if (
            rect &&
            (rect[2] > firstPage.size[0] || rect[3] > firstPage.size[1])
          )
            throw new Error(
              `${item.where}: ${item.href} rectangle lies outside page ${first}`,
            );
          // A numeric printed page numbers its neighbours; any other label names only the first page.
          const label = (page: number) =>
            /^\d+$/.test(print ?? "")
              ? Number(print) + page - first >= 1
                ? String(Number(print) + page - first)
                : undefined
              : page === first
                ? print
                : undefined;
          Object.assign(data, {
            type: "pdf",
            first,
            last,
            print,
            rect,
            pages: await Promise.all(
              result.shown.map(async ({ page, size, image }: ShownPage) => ({
                page,
                label: label(page),
                size,
                image: asset(await read(image), ".webp"),
              })),
            ),
          });
        } else if (chapter !== undefined) {
          if (section !== undefined && !Object.hasOwn(result.sections, section))
            throw new Error(
              `${item.where}: ${item.href} section ${section} is not in chapter ${chapter}`,
            );
          Object.assign(data, {
            type: "epub",
            chapter: result.chapter,
            section: section && {
              key: section,
              title: result.sections[section],
            },
            body: await body(result),
          });
        } else {
          Object.assign(data, {
            type: "web",
            url: result.url,
            downloaded: result.downloaded,
            body: await body(result),
          });
        }
        citations[item.href] = JSON.parse(JSON.stringify(data));
      }
      return { citations, assets: [...assets.values()] };
    }),
  );
}
