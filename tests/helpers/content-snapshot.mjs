// Test-only content snapshots in the format the website reads
// (`server/content-cache.mjs`): snapshot.json plus files/<scope>/<path>.
import { mkdir, readdir, rename, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { patentRoutePaths } from "../../scripts/patent-contract.mjs";
import { compileNotes, parseNote } from "../../scripts/notes-index.mjs";
import { sortSites } from "../../scripts/site-catalog.mjs";
import {
  chapterRoutePath,
  topicBasePath,
} from "../../scripts/topic-content.mjs";
import { resolveCitations } from "../../server/citations.mjs";
import {
  readGlossary,
  readRegistry,
  readUnit,
} from "../../server/content-files.mjs";

const notePath = (dir, slug, author) =>
  `/notes/${dir}/${author ? "author/" : ""}${slug}`;

/** Writes the snapshot directory and returns it. */
async function writeSnapshot(directory, data, assets) {
  for (const { scope, path, bytes } of assets) {
    const file = join(directory, "files", scope, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "snapshot.json"),
    JSON.stringify({
      format: 1,
      commit: "0".repeat(40),
      builtAt: new Date().toISOString(),
      ...data,
      assets: assets.map(({ scope, path, sha256, size, content_type }) => ({
        scope,
        path,
        sha256,
        size,
        content_type,
      })),
    }),
  );
  return directory;
}

/**
 * Compiles `units` of the content directory `root` into a snapshot at
 * `directory`. Topic checks belong to the publisher; notes are compiled as
 * the website serves them.
 */
export async function buildSnapshot(root, units, directory, { shelf } = {}) {
  const inputs = [];
  for (const unit of units) inputs.push(await readUnit(root, unit));
  const glossary = await readGlossary(root);
  const registry = await readRegistry(root);
  const resolved = await resolveCitations(
    registry ?? {},
    inputs.map(({ unit, occurrences }) => ({ scope: unit, occurrences })),
    shelf,
  );
  const sites = inputs.filter((input) => input.kind === "sites");
  const books = inputs.filter((input) => input.kind === "notes");
  const citations = (input) => resolved[inputs.indexOf(input)].citations;
  const directories = books
    .map((input) => ({
      ...input.metadata,
      slug: input.slug,
      path: `/notes/${input.slug}/`,
    }))
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  const notes = books.flatMap((input) =>
    input.notes.map((note) => {
      const path = notePath(input.slug, note.slug, note.author);
      const file = `${path.slice(1)}.md`;
      return {
        ...parseNote(note.source, file),
        slug: note.slug,
        directory: input.slug,
        directoryTitle: input.metadata.title,
        path,
        file,
        author: note.author,
      };
    }),
  );
  const routes = new Set([
    "/",
    "/notes/",
    "/review/",
    "/system/",
    "/glossary/",
  ]);
  for (const site of sortSites(
    sites.map((input) => ({ ...input.site, content: input.content })),
  )) {
    const base = topicBasePath(site);
    routes.add(base + "/");
    for (const path of patentRoutePaths(site.content)) routes.add(base + path);
    for (const chapter of site.content.chapters)
      routes.add(base + chapterRoutePath(site.content, chapter));
  }
  for (const directory of directories) routes.add(directory.path);
  for (const note of notes) routes.add(note.path);
  const assets = inputs.flatMap((input, i) => [
    ...input.assets,
    ...resolved[i].assets,
  ]);
  const assetPaths = new Set(assets.map((a) => `/${a.scope}/${a.path}`));
  const compiled = await compileNotes({
    directories,
    notes,
    terms: Object.fromEntries(glossary.map((t) => [t.term, t])),
    routes,
    assetExists: (dir, path) => assetPaths.has(`/notes/${dir}/${path}`),
    citations: Object.fromEntries(
      books.map((input) => [input.slug, citations(input)]),
    ),
  });
  return writeSnapshot(
    directory,
    {
      topics: sites.map((input) => ({
        slug: input.slug,
        site: input.site,
        content: input.content,
        citations: citations(input),
      })),
      directories: books.map((input) => ({
        dir: input.slug,
        metadata: input.metadata,
        citations: citations(input),
        compiled: compiled.directories.find((d) => d.slug === input.slug),
      })),
      notes: books.flatMap((input) =>
        input.notes.map((note) => {
          const { author, ...body } = compiled.notes.find(
            (n) =>
              n.directory === input.slug &&
              n.slug === note.slug &&
              n.author === note.author,
          );
          return { dir: input.slug, ...note, author, compiled: body };
        }),
      ),
      glossary,
      registry,
    },
    assets,
  );
}

/**
 * Builds a new snapshot in `releases` and points `releases/current` at it,
 * replacing the link atomically as a publication does.
 */
export async function publishSnapshot(releases, build) {
  await mkdir(releases, { recursive: true });
  const name = String((await readdir(releases)).length);
  await build(join(releases, name));
  const link = join(releases, `current-${name}`);
  await symlink(name, link);
  await rename(link, join(releases, "current"));
  return join(releases, name);
}
