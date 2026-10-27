import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { measureStage } from "./stage-timing.mjs";
import { moleculeToolkit } from "../scripts/molecule-toolkit.mjs";
import { patentRoutePaths } from "../scripts/patent-contract.mjs";
import { validatePatentAssets } from "./patent-assets.mjs";
import {
  compileNotes,
  noteCitations,
  parseNote,
} from "../scripts/notes-index.mjs";
import { contentCitations, citedSource } from "../scripts/source-citations.mjs";
import { sortSites } from "../scripts/site-catalog.mjs";
import {
  chapterRoutePath,
  topicBasePath,
  validateTopicContent,
} from "../scripts/topic-content.mjs";
import { transaction } from "./database.mjs";
import { resolveCitations } from "./citations.mjs";
import {
  readUnit,
  readRegistry,
  readGlossary,
  unitName,
  matchesStored,
} from "./content-files.mjs";
import { publishedGlossary } from "./content-query.mjs";

const notePath = (dir, slug, author) =>
  `/notes/${dir}/${author ? "author/" : ""}${slug}`;

async function snapshot(client) {
  const topics = (
    await client.query("SELECT slug, site, content FROM topics")
  ).rows.map((row) => ({ ...row.site, slug: row.slug, content: row.content }));
  const directories = (
    await client.query("SELECT dir, metadata, citations FROM note_directories")
  ).rows;
  const notes = (
    await client.query("SELECT dir, slug, author, source FROM notes")
  ).rows;
  const assets = (
    await client.query(
      "SELECT scope, path, sha256, size, content_type FROM assets",
    )
  ).rows;
  const glossary = await publishedGlossary(client);
  return { topics, directories, notes, assets, glossary };
}
function context(data) {
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
let toolkit;
const checkedSmiles = new Set();
async function validateTopics(data, ctx, store) {
  for (const topic of data.topics) {
    const where = `sites/${topic.slug}/content.json`;
    validateTopicContent(topic.content, where);
    for (const chapter of topic.content.chapters)
      for (const term of chapter.terms ?? [])
        if (!Object.hasOwn(ctx.terms, term))
          throw new Error(
            `${where}: chapter ${chapter.id} uses unknown term ${term}`,
          );
    await validatePatentAssets(topic.content, topic.slug, data.assets, store);
    async function visit(value, path) {
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
function notebookSources(data) {
  const directories = data.directories
    .map((row) => ({
      ...row.metadata,
      slug: row.dir,
      path: `/notes/${row.dir}/`,
    }))
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
  const notes = data.notes
    .map((row) => {
      const dir = directories.find((dir) => dir.slug === row.dir);
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
async function compile(data, store, notebook) {
  const ctx = context(data);
  await validateTopics(data, ctx, store);
  const { directories, notes } = notebook ?? notebookSources(data);
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
async function saveCompilation(client, compiled) {
  if (compiled.directories.length)
    await client.query(
      `UPDATE note_directories AS stored SET compiled = item.value
       FROM jsonb_array_elements($1::jsonb) AS item(value)
       WHERE stored.dir = item.value->>'slug'
         AND stored.compiled IS DISTINCT FROM item.value`,
      [JSON.stringify(compiled.directories)],
    );
  // Author identity belongs to the row key, not the reader-facing compiled body.
  if (compiled.notes.length)
    await client.query(
      `UPDATE notes AS stored SET compiled = item.value - 'author'
       FROM jsonb_array_elements($1::jsonb) AS item(value)
       WHERE stored.dir = item.value->>'directory'
         AND stored.slug = item.value->>'slug'
         AND stored.author = (item.value->>'author')::boolean
         AND stored.compiled IS DISTINCT FROM item.value - 'author'`,
      [JSON.stringify(compiled.notes)],
    );
}

/**
 * Stores the objects the store lacks. Each check and upload is a round trip
 * to object storage, so several run at once.
 */
async function uploadMissing(store, objects, concurrency = 8) {
  const queue = [...objects];
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [hash, bytes] = next;
        if (!(await store.hasObject(hash))) await store.putObject(hash, bytes);
      }
    }),
  );
}
/** A publication time as the content command prints it. */
const stamp = (date) =>
  date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
/** The commit, time and pusher of a unit's last publication, as the content command prints them. */
export const publication = (row) =>
  row.pushed_at
    ? `${row.git_commit?.slice(0, 7) ?? "-"}  ${stamp(row.pushed_at)}  ${row.pushed_by ?? "unknown"}`
    : "-";
/**
 * Rejects the whole operation when a unit was published from a commit that
 * `source` does not contain. With `root`, a unit published before commits
 * were recorded must match the working directory, which is clean at the
 * source commit; new units always pass.
 */
async function checkSource(client, units, source, root) {
  const rows = (
    await client.query(
      `SELECT w.unit, u.git_commit, u.pushed_at, u.pushed_by,
         w.unit IN (SELECT 'sites/' || slug FROM topics UNION ALL SELECT 'notes/' || dir FROM note_directories) AS stored
       FROM unnest($1::text[]) AS w(unit) LEFT JOIN content_units u USING (unit)
       ORDER BY w.unit`,
      [units],
    )
  ).rows;
  const unmerged = [];
  const unmatched = [];
  for (const row of rows)
    if (row.git_commit) {
      if (!(await source.contains(row.git_commit))) unmerged.push(row);
    } else if (
      root &&
      row.stored &&
      !(await matchesStored(client, root, row.unit))
    )
      unmatched.push(row);
  const list = (rows) =>
    rows.map((row) => `  ${row.unit}  ${publication(row)}`).join("\n");
  const problems = [];
  if (unmerged.length)
    problems.push(
      `Published from commits that ${source.commit.slice(0, 7)} does not contain; merge them and push again:\n${list(unmerged)}`,
    );
  if (unmatched.length)
    problems.push(
      `Published before commits were recorded and different from ${source.commit.slice(0, 7)}; pull them, check git diff, commit and push again:\n${list(unmatched)}`,
    );
  if (problems.length)
    throw new Error(problems.join("\n") + "\nNothing was written.");
  await source.verify();
}
const recordSource = (client, unit, { commit, pusher }) =>
  client.query(
    `INSERT INTO content_units(unit, git_commit, pushed_by) VALUES ($1, $2, $3)
     ON CONFLICT (unit) DO UPDATE SET git_commit = $2, pushed_at = now(), pushed_by = $3`,
    [unit, commit, pusher],
  );
/** Each published unit with the commit, time and pusher it was published by. */
export async function listUnits(pool) {
  return (
    await pool.query(
      `SELECT w.unit, u.git_commit, u.pushed_at, u.pushed_by
       FROM (SELECT 'sites/' || slug AS unit FROM topics UNION ALL SELECT 'notes/' || dir FROM note_directories) AS w
       LEFT JOIN content_units u USING (unit)
       ORDER BY w.unit LIKE 'notes/%', w.unit`,
    )
  ).rows;
}

/**
 * Reads `units` from the content directory with the glossary and source
 * registry, and resolves their citations against the shelf.
 */
async function readInputs(root, units, shelf) {
  const inputs = [];
  await measureStage("publish.read", async () => {
    for (const unit of units) inputs.push(await readUnit(root, unit));
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
  return { inputs, glossary, registry };
}
/** Replaces the topics, directories, notes and assets of each input's unit in `data`. */
function replaceUnits(data, inputs) {
  for (const input of inputs) {
    const { unit } = input;
    data.assets = [
      ...data.assets.filter((a) => a.scope !== unit),
      ...input.assets,
    ];
    if (input.kind === "sites")
      data.topics = [
        ...data.topics.filter((t) => t.slug !== input.slug),
        { ...input.site, content: input.content },
      ];
    else {
      data.directories = [
        ...data.directories.filter((d) => d.dir !== input.slug),
        {
          dir: input.slug,
          metadata: input.metadata,
          citations: input.citations,
        },
      ];
      data.notes = [
        ...data.notes.filter((n) => n.dir !== input.slug),
        ...input.notes.map((n) => ({ ...n, dir: input.slug })),
      ];
    }
  }
}

/**
 * `source` is the commit being published (`committedSource`); the content
 * command always passes it, and only fixtures seeding a test database
 * publish without it. `shelf` may name the materials and render cache
 * directories (MOLNOTES_MATERIALS_DIR, MOLNOTES_MATERIALS_CACHE).
 */
export async function pushUnits(
  pool,
  store,
  root,
  units,
  { source, shelf = {} } = {},
) {
  if (!units.length || new Set(units).size !== units.length)
    throw new Error("Provide distinct content units");
  const { inputs, glossary, registry } = await readInputs(root, units, shelf);
  return measureStage("publish.transaction", () =>
    transaction(pool, async (client) => {
      await measureStage("publish.lock-wait", () =>
        client.query("SELECT pg_advisory_xact_lock(64081602)"),
      );
      if (source) await checkSource(client, units, source, root);
      const data = await measureStage("publish.snapshot", () =>
        snapshot(client),
      );
      // A recorded asset was uploaded by the publish that recorded it, and
      // objects are never deleted, so only new hashes need the store.
      const stored = new Set(data.assets.map((asset) => asset.sha256));
      data.glossary = glossary;
      replaceUnits(data, inputs);
      const notebook = await measureStage("publish.prepare-notes", () =>
        notebookSources(data),
      );
      await measureStage("publish.references", async () => {
        if (registry) {
          const occurrences = [
            ...data.topics.flatMap((topic) =>
              contentCitations(
                topic.content,
                `sites/${topic.slug}/content.json`,
              ),
            ),
            ...data.directories.flatMap((directory) =>
              noteCitations(
                directory.metadata.intro,
                `notes/${directory.dir}/directory.json`,
              ),
            ),
            ...notebook.notes.flatMap((note) =>
              noteCitations(note.body, note.file, note.offset),
            ),
          ];
          for (const { href, where } of occurrences) {
            try {
              citedSource(registry, href);
            } catch (error) {
              throw new Error(`${where}: ${error.message}`);
            }
          }
        }
      });
      const compiled = await measureStage("publish.compile", () =>
        compile(data, store, notebook),
      );
      await measureStage("publish.upload", () =>
        uploadMissing(
          store,
          new Map(
            inputs.flatMap((input) =>
              input.assets
                .filter((asset) => !stored.has(asset.sha256))
                .map((asset) => [asset.sha256, asset.bytes]),
            ),
          ),
        ),
      );
      await measureStage("publish.persist", async () => {
        for (const input of inputs) {
          const { unit } = input;
          if (source) await recordSource(client, unit, source);
          if (input.kind === "sites")
            await client.query(
              "INSERT INTO topics(slug,site,content,citations) VALUES ($1,$2,$3,$4) ON CONFLICT(slug) DO UPDATE SET site=$2,content=$3,citations=$4",
              [input.slug, input.site, input.content, input.citations],
            );
          else {
            await client.query(
              "INSERT INTO note_directories(dir,metadata,compiled,citations) VALUES ($1,$2,$3,$4) ON CONFLICT(dir) DO UPDATE SET metadata=$2,citations=$4",
              [input.slug, input.metadata, {}, input.citations],
            );
            await client.query("DELETE FROM notes WHERE dir=$1", [input.slug]);
            for (const note of input.notes)
              await client.query(
                "INSERT INTO notes(dir,slug,author,source,compiled) VALUES ($1,$2,$3,$4,$5)",
                [input.slug, note.slug, note.author, note.source, {}],
              );
          }
          await client.query("DELETE FROM assets WHERE scope=$1", [unit]);
          for (const asset of input.assets)
            await client.query(
              "INSERT INTO assets(scope,path,sha256,size,content_type,prompt) VALUES ($1,$2,$3,$4,$5,$6)",
              [
                unit,
                asset.path,
                asset.sha256,
                asset.size,
                asset.content_type,
                asset.prompt,
              ],
            );
        }
        if (registry)
          await client.query(
            "INSERT INTO source_registry(registry) VALUES ($1) ON CONFLICT(id) DO UPDATE SET registry=$1",
            [registry],
          );
        // node-postgres sends a JavaScript array as a SQL array, not JSON.
        await client.query(
          "INSERT INTO glossary(terms) VALUES ($1) ON CONFLICT(id) DO UPDATE SET terms=$1",
          [JSON.stringify(glossary)],
        );
        await saveCompilation(client, compiled);
      });
      // Authors read a notebook's author material before writing or revising it.
      return inputs.map((input) => ({
        unit: input.unit,
        assets: input.assets.length,
        author: (input.notes ?? [])
          .filter((note) => note.author)
          .map((note) => {
            const file = `${input.unit}/author/${note.slug}.md`;
            return { file, ...parseNote(note.source, file) };
          })
          .sort((a, b) => a.order - b.order || a.file.localeCompare(b.file))
          .map(({ file, title }) => ({ file, title })),
      }));
    }),
  );
}
/**
 * Removes a unit. With `source`, the unit must be deleted in that commit and
 * every recorded publication of it contained in the commit.
 */
export async function removeUnit(pool, unit, { source } = {}) {
  const { kind, slug } = unitName(unit);
  if (source && (await source.tracks(unit)))
    throw new Error(
      `${unit}: delete it in the content repository and commit first`,
    );
  return transaction(pool, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(64081602)");
    if (source) await checkSource(client, [unit], source);
    const data = await snapshot(client);
    if (
      kind === "sites"
        ? !data.topics.some((t) => t.slug === slug)
        : !data.directories.some((d) => d.dir === slug)
    )
      throw new Error(`${unit}: not found`);
    data.assets = data.assets.filter((a) => a.scope !== unit);
    if (kind === "sites")
      data.topics = data.topics.filter((t) => t.slug !== slug);
    else {
      data.directories = data.directories.filter((d) => d.dir !== slug);
      data.notes = data.notes.filter((n) => n.dir !== slug);
    }
    // Published bodies and the glossary are unchanged; links still reject deletion.
    const compiled = await compile(data);
    // The removal commit stays recorded, so a branch without it cannot bring the unit back.
    if (source) await recordSource(client, unit, source);
    await client.query(
      kind === "sites"
        ? "DELETE FROM topics WHERE slug=$1"
        : "DELETE FROM note_directories WHERE dir=$1",
      [slug],
    );
    await client.query("DELETE FROM assets WHERE scope=$1", [unit]);
    await saveCompilation(client, compiled);
  });
}

/** Every content unit in the content directory: `sites/<slug>` and `notes/<dir>`. */
async function contentUnits(root) {
  const units = [];
  for (const kind of ["sites", "notes"]) {
    let names;
    try {
      names = await readdir(join(root, kind));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    units.push(...names.sort().map((name) => `${kind}/${name}`));
  }
  return units;
}

/**
 * Reads, validates and compiles every unit of the content directory into the
 * rows a snapshot holds, and the asset bytes by `<scope>/<path>`. `shelf` is
 * as for `pushUnits`; `commit` is recorded in the snapshot.
 */
export async function buildSnapshot(root, { shelf = {}, commit = null } = {}) {
  const units = await contentUnits(root);
  const { inputs, glossary, registry } = await readInputs(root, units, shelf);
  const data = { topics: [], directories: [], notes: [], assets: [], glossary };
  replaceUnits(data, inputs);
  const compiled = await measureStage("publish.compile", () => compile(data));
  const directories = new Map(compiled.directories.map((d) => [d.slug, d]));
  const notes = new Map(
    compiled.notes.map(({ author, ...note }) => [
      `${note.directory}/${author}/${note.slug}`,
      note,
    ]),
  );
  const files = new Map(
    data.assets.map((asset) => [`${asset.scope}/${asset.path}`, asset.bytes]),
  );
  return {
    snapshot: {
      format: 1,
      commit,
      builtAt: new Date().toISOString(),
      topics: inputs
        .filter((input) => input.kind === "sites")
        .map(({ slug, site, content, citations }) => ({
          slug,
          site,
          content,
          citations,
        })),
      directories: inputs
        .filter((input) => input.kind === "notes")
        .map(({ slug, metadata, citations }) => ({
          dir: slug,
          metadata,
          citations,
          compiled: directories.get(slug),
        })),
      notes: data.notes.map(({ dir, slug, author, source }) => ({
        dir,
        slug,
        author,
        source,
        compiled: notes.get(`${dir}/${author}/${slug}`),
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
    files,
  };
}
