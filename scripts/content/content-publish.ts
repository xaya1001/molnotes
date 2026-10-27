import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { measureStage } from "../../shared/stage-timing.ts";
import { moleculeToolkit } from "../../shared/molecule-toolkit.ts";
import { patentRoutePaths } from "../../shared/patent-contract.ts";
import { validatePatentAssets } from "./patent-assets.ts";
import { compileNotes, parseNote } from "../../shared/notes-index.ts";
import { sortSites } from "../../shared/site-catalog.ts";
import {
  chapterRoutePath,
  topicBasePath,
  validateTopicContent,
} from "../../shared/topic-content.ts";
import { resolveCitations, type Shelf } from "./citations.ts";
import {
  readUnit,
  readRegistry,
  readGlossary,
  type ContentUnit,
  type NotesUnit,
  type SiteUnit,
  type UnitAsset,
} from "./content-files.ts";
import type { GlossaryTerm } from "../../shared/glossary.ts";
import type {
  Citations,
  DirectoryMetadata,
  Snapshot,
  SnapshotSite,
} from "../../shared/snapshot.ts";
import type { TopicContent } from "../../src/ui/topic/content.ts";

/** Everything a build reads, before the notes are compiled. */
interface PublishData {
  topics: (SnapshotSite & { content: TopicContent })[];
  directories: {
    dir: string;
    metadata: DirectoryMetadata;
    citations: Citations;
  }[];
  notes: (NotesUnit["notes"][number] & { dir: string })[];
  assets: UnitAsset[];
  glossary: GlossaryTerm[];
}
type BuildContext = ReturnType<typeof context>;
type Resolved<U> = U & { citations: Citations };

const notePath = (dir: string, slug: string, author: boolean) =>
  `/notes/${dir}/${author ? "author/" : ""}${slug}`;

function context(data: PublishData) {
  const routes = new Set([
    "/",
    "/notes/",
    "/review/",
    "/system/",
    "/glossary/",
  ]);
  const terms = Object.fromEntries(data.glossary.map((t) => [t.term, t]));
  for (const topic of sortSites(data.topics)) {
    const base = topicBasePath(topic);
    routes.add(base + "/");
    for (const path of patentRoutePaths(topic.content)) routes.add(base + path);
    for (const chapter of topic.content.chapters)
      routes.add(base + chapterRoutePath(topic.content, chapter));
  }
  for (const dir of data.directories) routes.add(`/notes/${dir.dir}/`);
  for (const note of data.notes)
    routes.add(notePath(note.dir, note.slug, note.author));
  const assets = new Set(
    data.assets.map((asset) => `/${asset.scope}/${asset.path}`),
  );
  return { routes, terms, assets };
}
let toolkit: Awaited<ReturnType<typeof moleculeToolkit>> | undefined;
const checkedSmiles = new Set<string>();
async function validateTopics(data: PublishData, ctx: BuildContext) {
  for (const topic of data.topics) {
    const where = `sites/${topic.slug}/content.json`;
    validateTopicContent(topic.content, where);
    for (const chapter of topic.content.chapters)
      for (const term of chapter.terms ?? [])
        if (!Object.hasOwn(ctx.terms, term))
          throw new Error(
            `${where}: chapter ${chapter.id} uses unknown term ${term}`,
          );
    await validatePatentAssets(topic.content, topic.slug, data.assets);
    async function visit(value: unknown, path: string): Promise<void> {
      if (Array.isArray(value)) {
        for (const [i, item] of value.entries())
          await visit(item, `${path}[${i}]`);
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [key, item] of Object.entries(value)) {
        const location = `${path}.${key}`;
        if (
          key === "smiles" &&
          typeof item === "string" &&
          item !== "" &&
          !checkedSmiles.has(item)
        ) {
          toolkit ??= await moleculeToolkit();
          let mol;
          try {
            mol = toolkit.get_mol(item);
            if (!mol?.is_valid()) throw new Error();
          } catch {
            throw new Error(`${where}:${location}: invalid SMILES`);
          } finally {
            mol?.delete();
          }
          checkedSmiles.add(item);
        }
        if (
          typeof item === "string" &&
          ["src", "url", "href", "to", "image"].includes(key)
        ) {
          if (
            item &&
            !(
              key === "image" &&
              Object.values(topic.content.data?.sources ?? {}).some(
                (source) => source.image === item,
              )
            ) &&
            !/^(https?:|mailto:|\/\/)/i.test(item) &&
            (key !== "image" || item.includes("/"))
          ) {
            const url = new URL(
              item,
              `http://content.local/sites/${topic.slug}/`,
            );
            if (url.origin !== "http://content.local")
              throw new Error(`${where}:${location}: unsupported link ${item}`);
            const pathname = url.pathname;
            const asset =
              /^\/(?:sites\/[^/]+\/static|notes\/[^/]+\/assets)\//.test(
                pathname,
              );
            if (!(asset ? ctx.assets : ctx.routes).has(decodeURI(pathname)))
              throw new Error(
                `${where}:${location}: unknown ${asset ? "resource" : "internal link"} ${item}`,
              );
          }
        }
        await visit(item, location);
      }
    }
    await visit(topic.content, "content");
    for (const collection of Object.values(
      topic.content.data?.collections ?? {},
    ))
      for (const field of collection.fields ?? [])
        if (field.kind === "link")
          for (const record of collection.records)
            if (record[field.key])
              await visit(
                { href: record[field.key] },
                `content.data.${collection.route}/${record.id}.${field.key}`,
              );
  }
}
function notebookSources(data: PublishData) {
  const directories = data.directories
    .map((row) => ({
      ...row.metadata,
      slug: row.dir,
      path: `/notes/${row.dir}/`,
    }))
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  const notes = data.notes
    .map((row) => {
      // Every note belongs to a directory read in the same build.
      const dir = directories.find((dir) => dir.slug === row.dir)!;
      const path = notePath(row.dir, row.slug, row.author);
      const file = `${path.slice(1)}.md`;
      return {
        ...parseNote(row.source, file),
        slug: row.slug,
        directory: row.dir,
        directoryTitle: dir.title,
        path,
        file,
        author: row.author,
      };
    })
    .sort(
      (a, b) =>
        directories.findIndex((d) => d.slug === a.directory) -
          directories.findIndex((d) => d.slug === b.directory) ||
        a.order - b.order ||
        a.slug.localeCompare(b.slug),
    );
  return { directories, notes };
}
async function compile(data: PublishData) {
  const ctx = context(data);
  await validateTopics(data, ctx);
  const { directories, notes } = notebookSources(data);
  return compileNotes({
    directories,
    notes,
    terms: ctx.terms,
    routes: ctx.routes,
    assetExists: (dir, path) => ctx.assets.has(`/notes/${dir}/${path}`),
    citations: Object.fromEntries(
      data.directories.map((row) => [row.dir, row.citations]),
    ),
  });
}
/** Every content unit in the content directory: `sites/<slug>` and `notes/<dir>`. */
async function contentUnits(root: string) {
  const units: string[] = [];
  for (const kind of ["sites", "notes"]) {
    let names;
    try {
      names = await readdir(join(root, kind));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    units.push(...names.sort().map((name) => `${kind}/${name}`));
  }
  return units;
}

/**
 * Reads, validates and compiles every unit of the content directory into the
 * rows a snapshot holds, and the asset bytes by `<scope>/<path>`. `shelf` may
 * name the materials and render cache directories (MOLNOTES_MATERIALS_DIR,
 * MOLNOTES_MATERIALS_CACHE); `commit` is recorded in the snapshot.
 */
export async function buildSnapshot(
  root: string,
  { shelf = {}, commit = null }: { shelf?: Shelf; commit?: string | null } = {},
): Promise<{ snapshot: Snapshot; files: Map<string, Buffer> }> {
  const inputs: Resolved<ContentUnit>[] = [];
  await measureStage("publish.read", async () => {
    for (const unit of await contentUnits(root))
      inputs.push({ ...(await readUnit(root, unit)), citations: {} });
  });
  const glossary = await readGlossary(root);
  const registry = await readRegistry(root);
  if (!registry && inputs.some((input) => input.occurrences.length))
    throw new Error(
      "sources.json: missing; citations need the source registry",
    );
  const resolved = await measureStage("publish.citations", () =>
    resolveCitations(
      registry ?? {},
      inputs.map(({ unit, occurrences }) => ({ scope: unit, occurrences })),
      shelf,
    ),
  );
  for (const [i, input] of inputs.entries()) {
    input.assets.push(...resolved[i].assets);
    input.citations = resolved[i].citations;
  }
  const sites = inputs.filter(
    (input): input is Resolved<SiteUnit> => input.kind === "sites",
  );
  const books = inputs.filter(
    (input): input is Resolved<NotesUnit> => input.kind === "notes",
  );
  const data: PublishData = {
    topics: sites.map((input) => ({ ...input.site, content: input.content })),
    directories: books.map((input) => ({
      dir: input.slug,
      metadata: input.metadata,
      citations: input.citations,
    })),
    notes: books.flatMap((input) =>
      input.notes.map((note) => ({ ...note, dir: input.slug })),
    ),
    assets: inputs.flatMap((input) => input.assets),
    glossary,
  };
  const compiled = await measureStage("publish.compile", () => compile(data));
  const directories = new Map(compiled.directories.map((d) => [d.slug, d]));
  // Author identity belongs to the row key, not the reader-facing compiled body.
  const notes = new Map(
    compiled.notes.map(({ author, ...note }) => [
      `${note.directory}/${author}/${note.slug}`,
      note,
    ]),
  );
  return {
    snapshot: {
      format: 1,
      commit,
      builtAt: new Date().toISOString(),
      topics: sites.map(({ slug, site, content, citations }) => ({
        slug,
        site,
        content,
        citations,
      })),
      directories: data.directories.map((directory) => ({
        ...directory,
        compiled: directories.get(directory.dir)!,
      })),
      notes: data.notes.map(({ dir, slug, author, source }) => ({
        dir,
        slug,
        author,
        source,
        compiled: notes.get(`${dir}/${author}/${slug}`)!,
      })),
      glossary,
      registry,
      assets: data.assets.map(
        ({ scope, path, sha256, size, content_type, prompt }) => ({
          scope,
          path,
          sha256,
          size,
          content_type,
          prompt,
        }),
      ),
    },
    files: new Map(
      data.assets.map((asset) => [`${asset.scope}/${asset.path}`, asset.bytes]),
    ),
  };
}
