import {
  readFile,
  readdir,
  lstat,
  mkdir,
  writeFile,
  copyFile,
  stat,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify, isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { parseNote, noteCitations } from "../scripts/notes-index.mjs";
import {
  contentCitations,
  validateSourceRegistry,
} from "../scripts/source-citations.mjs";
import { validateGlossary } from "../scripts/glossary.mjs";
import { parseSiteManifest } from "../scripts/site-catalog.mjs";
import { validateTopicContent } from "../scripts/topic-content.mjs";
import { sha256, contentType, cachedAsset } from "./assets.mjs";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function unitName(unit) {
  const [kind, slug, ...rest] = unit.split("/");
  if (
    !["notes", "sites"].includes(kind) ||
    !slugPattern.test(slug) ||
    rest.length
  )
    throw new Error("Expected notes/<dir> or sites/<slug> (database content)");
  return { kind, slug };
}
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
async function files(root, relative = "") {
  const found = [];
  let entries;
  try {
    entries = await readdir(join(root, relative), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT" && !relative) return [];
    throw error;
  }
  for (const entry of entries) {
    const path = join(relative, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`${path}: symbolic links are not allowed in content`);
    if (entry.isDirectory()) found.push(...(await files(root, path)));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}
export async function readUnit(root, unit) {
  const { kind, slug } = unitName(unit);
  const folder = join(root, unit);
  if (!(await lstat(folder)).isDirectory())
    throw new Error(`${unit}: expected a directory`);
  const prefix = kind === "sites" ? "static" : "assets";
  const assets = [];
  for (const path of await files(join(folder, prefix))) {
    const bytes = await readFile(join(folder, prefix, path));
    assets.push({
      scope: unit,
      path: `${prefix}/${path}`,
      sha256: sha256(bytes),
      size: bytes.length,
      content_type: contentType(path),
      prompt: null,
      bytes,
    });
  }
  // A generated note image keeps the prompt that produced it; readers never receive it.
  if (kind === "notes")
    for (const path of await files(join(folder, "prompts"))) {
      const asset = assets.find((a) => `${a.path}.md` === `assets/${path}`);
      if (!asset) throw new Error(`${unit}/prompts/${path}: no matching asset`);
      asset.prompt = await readFile(join(folder, "prompts", path), "utf8");
      if (!asset.prompt.trim())
        throw new Error(`${unit}/prompts/${path}: empty prompt`);
    }
  if (kind === "sites") {
    const metadata = await json(join(folder, "site.json"));
    const site = { ...parseSiteManifest(slug, metadata) };
    for (const key of ["label"]) {
      if (metadata[key] !== undefined) {
        if (typeof metadata[key] !== "string" || !metadata[key].trim())
          throw new Error(`${unit}/site.json: invalid ${key}`);
        site[key] = metadata[key];
      }
    }
    const content = await json(join(folder, "content.json"));
    validateTopicContent(content, `${unit}/content.json`);
    if (content.glossary !== undefined)
      throw new Error(
        `${unit}/content.json: define terms in glossary.json and list them in chapter terms`,
      );
    for (const source of content.sources ?? [])
      if (source.file !== undefined)
        throw new Error(
          `${unit}/content.json: source ${source.id} names a shelf file; register it in sources.json and cite it`,
        );
    const occurrences = contentCitations(content, `${unit}/content.json`);
    return { unit, kind, slug, site, content, assets, occurrences };
  }
  const metadata = await json(join(folder, "directory.json"));
  if (
    !metadata ||
    Object.keys(metadata).sort().join(",") !== "intro,order,title" ||
    typeof metadata.title !== "string" ||
    !metadata.title.trim() ||
    typeof metadata.intro !== "string" ||
    !Number.isInteger(metadata.order) ||
    metadata.order < 1
  )
    throw new Error(`${unit}/directory.json: invalid directory metadata`);
  const notes = [];
  const occurrences = noteCitations(metadata.intro, `${unit}/directory.json`);
  async function read(name, author) {
    const file = `${unit}/${author ? "author/" : ""}${name}`;
    const noteSlug = name.slice(0, -3);
    if (!slugPattern.test(noteSlug)) throw new Error(`${file}: invalid slug`);
    const source = await readFile(join(root, file), "utf8");
    const { body, offset } = parseNote(source, file);
    occurrences.push(...noteCitations(body, file, offset));
    notes.push({ slug: noteSlug, source, author });
  }
  for (const name of (await readdir(folder)).filter((name) =>
    name.endsWith(".md"),
  ))
    await read(name, false);
  // Author material is Markdown notes only; its images live in the directory's assets/.
  let author = [];
  try {
    author = await readdir(join(folder, "author"), { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const entry of author) {
    if (!entry.isFile() || !entry.name.endsWith(".md"))
      throw new Error(
        `${unit}/author/${entry.name}: author material must be <slug>.md files`,
      );
    await read(entry.name, true);
  }
  return { unit, kind, slug, metadata, notes, assets, occurrences };
}
/** The source registry in the content directory, or null when there is none. */
export async function readRegistry(root) {
  let registry;
  try {
    registry = await json(join(root, "sources.json"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`sources.json: ${error.message}`);
  }
  return validateSourceRegistry(registry);
}
/** The site glossary in the content directory; every publication needs it. */
export async function readGlossary(root) {
  let glossary;
  try {
    glossary = await json(join(root, "glossary.json"));
  } catch (error) {
    throw new Error(
      `glossary.json: ${error.code === "ENOENT" ? "missing" : error.message}`,
    );
  }
  return validateGlossary(glossary);
}
/** A unit's published files as JSON ($2 is the slug). */
const unitFilesSql = {
  sites:
    "SELECT jsonb_build_object('site', site, 'content', content, 'citations', citations) FROM topics WHERE slug = $2",
  notes: `SELECT jsonb_build_object('metadata', d.metadata, 'citations', d.citations, 'notes',
      (SELECT coalesce(jsonb_agg(jsonb_build_object('slug', n.slug, 'author', n.author, 'source', n.source)
        ORDER BY n.author, n.slug), '[]') FROM notes n WHERE n.dir = d.dir))
    FROM note_directories d WHERE d.dir = $2`,
};
/** A unit's asset manifest as JSON ($1 is the unit). */
const unitAssetsSql = `SELECT coalesce(jsonb_agg(jsonb_build_object('path', path, 'sha256', sha256,
    'size', size, 'content_type', content_type, 'prompt', prompt) ORDER BY path), '[]')
  FROM assets WHERE scope = $1`;

/** A unit's stored files and asset manifest; undefined when absent. */
async function storedRow(db, unit) {
  const { kind, slug } = unitName(unit);
  return (
    await db.query(
      `SELECT d.files, (${unitAssetsSql}) AS assets FROM (${unitFilesSql[kind]}) AS d(files)`,
      [unit, slug],
    )
  ).rows[0];
}
const jsonText = (value) => JSON.stringify(value, null, 2) + "\n";
/**
 * The working-directory layout of a stored unit: text files by relative path
 * and the asset manifest. Cited pages and articles are rebuilt from the shelf
 * on every push, so they are not part of it.
 */
function storedLayout(kind, { files, assets }) {
  const texts = new Map();
  if (kind === "sites") {
    const { slug: _, ...site } = files.site;
    texts.set("site.json", jsonText(site));
    texts.set("content.json", jsonText(files.content));
  } else {
    texts.set("directory.json", jsonText(files.metadata));
    for (const note of files.notes)
      texts.set(`${note.author ? "author/" : ""}${note.slug}.md`, note.source);
  }
  const binary = assets.filter((asset) => !asset.path.startsWith("cited/"));
  for (const asset of binary)
    if (asset.prompt !== null)
      texts.set(
        `prompts/${asset.path.slice("assets/".length)}.md`,
        asset.prompt,
      );
  return { texts, assets: binary };
}
/** A unit's layout as stored, or null when the database lacks it. */
async function storedUnit(db, unit) {
  const row = await storedRow(db, unit);
  return row ? storedLayout(unitName(unit).kind, row) : null;
}
/** The files `push` reads from the working directory, in the stored layout. */
async function localUnit(root, unit) {
  const { kind } = unitName(unit);
  const folder = join(root, unit);
  const texts = new Map();
  const assets = [];
  const prefix = kind === "sites" ? "static" : "assets";
  for (const path of await files(folder)) {
    if (path.startsWith(prefix + "/")) {
      const bytes = await readFile(join(folder, path));
      assets.push({ path, sha256: sha256(bytes) });
    } else texts.set(path, await readFile(join(folder, path), "utf8"));
  }
  return { texts, assets };
}
/**
 * Whether the working directory holds exactly what the database stores for
 * the unit: every file a pull exports, JSON compared by value and assets by
 * hash, and nothing else.
 */
export async function matchesStored(db, root, unit) {
  const [stored, local] = [
    await storedUnit(db, unit),
    await localUnit(root, unit),
  ];
  if (!stored) return false;
  const json = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return Symbol("invalid");
    }
  };
  const hashes = (layout) =>
    Object.fromEntries(layout.assets.map((a) => [a.path, a.sha256]));
  return (
    stored.texts.size === local.texts.size &&
    [...stored.texts].every(([path, text]) =>
      path.endsWith(".json")
        ? isDeepStrictEqual(json(text), json(local.texts.get(path)))
        : text === local.texts.get(path),
    ) &&
    isDeepStrictEqual(hashes(stored), hashes(local))
  );
}

/** Exports a unit's files. */
export async function pullUnit(pool, store, root, unit, cache) {
  const row = await storedRow(pool, unit);
  if (!row) throw new Error(`${unit}: not found`);
  await writeUnit(
    store,
    join(root, unit),
    storedLayout(unitName(unit).kind, row),
    cache,
  );
}
/**
 * Writes a unit's files. Assets already present with the same hash are left
 * alone; the rest come through the local hash-addressed `cache`, several at a
 * time, so repeated pulls do not download unchanged objects again.
 */
async function writeUnit(store, folder, { texts, assets }, cache) {
  for (const [path, text] of texts) {
    await mkdir(join(folder, path, ".."), { recursive: true });
    await writeFile(join(folder, path), text);
  }
  const queue = [...assets];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let asset = queue.shift(); asset; asset = queue.shift()) {
        const path = join(folder, asset.path);
        if (!(await sameFile(path, asset))) {
          await mkdir(join(path, ".."), { recursive: true });
          await copyFile(await cachedAsset(store, cache, asset), path);
        }
      }
    }),
  );
}
async function sameFile(path, asset) {
  try {
    if ((await stat(path)).size !== Number(asset.size)) return false;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  return sha256(await readFile(path)) === asset.sha256;
}
/** Writes the published source registry back to sources.json; false when none was published. */
export async function pullRegistry(pool, root) {
  const row = (await pool.query("SELECT registry FROM source_registry"))
    .rows[0];
  if (!row) return false;
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "sources.json"),
    JSON.stringify(row.registry, null, 2) + "\n",
  );
  return true;
}
/** Writes the published glossary back to glossary.json; false when none was published. */
export async function pullGlossary(pool, root) {
  const row = (await pool.query("SELECT terms FROM glossary")).rows[0];
  if (!row) return false;
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "glossary.json"),
    JSON.stringify(row.terms, null, 2) + "\n",
  );
  return true;
}

const execFileAsync = promisify(execFile);
const git = async (root, args) =>
  (
    await execFileAsync(
      "git",
      ["-C", root, "-c", "core.quotePath=false", ...args],
      {
        maxBuffer: 64 << 20,
      },
    )
  ).stdout;
/** Fails unless `root` is a directory inside a Git work tree. */
export async function checkRepository(root) {
  let inside;
  try {
    inside =
      (await git(root, ["rev-parse", "--is-inside-work-tree"])).trim() ===
      "true";
  } catch {
    inside = false;
  }
  if (!inside)
    throw new Error(
      `${root}: not inside a Git work tree; the content directory must be in a Git repository or one of its worktrees`,
    );
}
/**
 * The committed state of the content repository at `root` for publishing
 * `paths`: HEAD, with none of those paths changed, untracked or ignored.
 * `contains(commit)` tells whether HEAD includes a commit; `verify()` checks
 * again, after reading, that HEAD and the paths have not moved.
 */
export async function committedSource(root, paths, pusher) {
  await checkRepository(root);
  const head = async () => {
    try {
      return (
        await git(root, ["rev-parse", "--verify", "HEAD^{commit}"])
      ).trim();
    } catch {
      throw new Error(`${root}: no commit yet; commit the content first`);
    }
  };
  const check = async () => {
    const changed = (
      await git(root, [
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--ignored=matching",
        "--",
        ...paths,
      ])
    ).trimEnd();
    if (changed)
      throw new Error(
        `Only committed content is published; commit or remove these first:\n${changed
          .split("\n")
          .map((line) => "  " + line)
          .join("\n")}`,
      );
  };
  const commit = await head();
  await check();
  return {
    commit,
    pusher,
    async contains(ancestor) {
      try {
        await git(root, ["merge-base", "--is-ancestor", ancestor, commit]);
        return true;
      } catch {
        // Not an ancestor, or a commit this repository does not have.
        return false;
      }
    },
    /** Whether HEAD tracks files under `path`. */
    async tracks(path) {
      return (
        (await git(root, ["ls-tree", "--name-only", commit, "--", path])) !== ""
      );
    },
    async verify() {
      if ((await head()) !== commit)
        throw new Error(`${root}: HEAD moved during publication; push again`);
      await check();
    },
  };
}
