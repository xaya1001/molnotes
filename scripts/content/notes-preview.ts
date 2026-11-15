import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  compileNotes,
  parseNote,
  noteCitations,
} from "../../shared/notes-index.ts";
import { chapterRoutePath, topicBasePath } from "../../shared/topic-content.ts";
import { parseSiteManifest } from "../../shared/site-catalog.ts";
import { patentRoutePaths } from "../../shared/patent-contract.ts";
import type { TopicContent } from "../../src/ui/topic/content.ts";
import type { Library } from "../../shared/chemical-library/types.ts";
import type { PreviewNote } from "../../shared/content-preview.ts";
import { readUnit, readGlossary, readRegistry } from "./content-files.ts";
import { resolveCitations } from "./citations.ts";
import { inspectRequest } from "./requests.ts";

async function names(root: string) {
  try {
    return await readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
/** Link targets without building or rendering unrelated content. */
async function previewRoutes(root: string) {
  const routes = new Set([
    "/",
    "/notes/",
    "/review/",
    "/system/",
    "/glossary/",
    "/library/",
  ]);
  for (const dir of await names(join(root, "notes"))) {
    routes.add(`/notes/${dir}/`);
    for (const prefix of ["", "author/"])
      for (const file of await names(join(root, "notes", dir, prefix)))
        if (file.endsWith(".md"))
          routes.add(`/notes/${dir}/${prefix}${file.slice(0, -3)}`);
  }
  for (const slug of await names(join(root, "sites"))) {
    const site = parseSiteManifest(
      slug,
      JSON.parse(
        await readFile(join(root, "sites", slug, "site.json"), "utf8"),
      ),
    );
    const content: TopicContent = JSON.parse(
      await readFile(join(root, "sites", slug, "content.json"), "utf8"),
    );
    const base = topicBasePath(site);
    routes.add(`${base}/`);
    for (const path of patentRoutePaths(content)) routes.add(base + path);
    for (const chapter of content.chapters)
      routes.add(base + chapterRoutePath(content, chapter));
  }
  return routes;
}

/** Compile selected notes with preview-only request mounts in their original positions. */
export async function previewNotes(
  root: string,
  unit: string,
  library: Library,
) {
  const [, dir, ...rest] = unit.split("/");
  const selected = rest.join("/");
  const input = await readUnit(root, `notes/${dir}`, library);
  if (input.kind !== "notes") throw new Error(`${unit}: expected notes`);
  const terms = Object.fromEntries(
    (await readGlossary(root)).map((term) => [term.term, term]),
  );
  const routes = await previewRoutes(root);
  const assets = [...input.assets];
  const previews: PreviewNote[] = [];
  for (const row of input.notes) {
    const slug = `${row.author ? "author/" : ""}${row.slug}`;
    if (selected ? selected !== slug : row.author) continue;
    const file = `notes/${dir}/${slug}.md`;
    const prefix = `preview-${dir}--${slug.replaceAll("/", "--")}`;
    const parsed = parseNote(row.source, file);
    const [resolved] = await resolveCitations(
      (await readRegistry(root)) ?? {},
      [
        {
          scope: `notes/${dir}`,
          occurrences: noteCitations(parsed.body, file, parsed.offset),
        },
      ],
    );
    assets.push(...resolved.assets);
    const requests: PreviewNote["requests"] = [];
    const { notes } = await compileNotes({
      directories: [],
      notes: [
        {
          ...parsed,
          slug: row.slug,
          directory: dir,
          directoryTitle: input.metadata.title,
          path: `/notes/${dir}/${slug}`,
          file,
        },
      ],
      terms,
      routes,
      assetExists: (_dir, path) => assets.some((asset) => asset.path === path),
      citations: { [dir]: resolved.citations },
      renderRequest: async (source, file, line) => {
        const request = await inspectRequest(source, file, line);
        const id = `${prefix}-request-${requests.length}`;
        requests.push({ ...request, id });
        return `<div id="${id}" class="resource-request-mount"></div>`;
      },
    });
    const note = notes[0];
    // Several notes share a preview document; each prose mount needs its own ID.
    for (const row of [...note.molecules, ...(note.diagrams ?? [])]) {
      const id = `${prefix}-${row.id}`;
      note.html = note.html.replace(`id="${row.id}"`, `id="${id}"`);
      row.id = id;
    }
    previews.push({ note, requests, terms });
  }
  if (selected && !previews.length) throw new Error(`${unit}: note not found`);
  return { previews, assets };
}
