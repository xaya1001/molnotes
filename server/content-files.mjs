import { readFile, readdir, lstat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { parseNote, noteCitations } from "../scripts/notes-index.mjs";
import {
  contentCitations,
  validateSourceRegistry,
} from "../scripts/source-citations.mjs";
import { validateGlossary } from "../scripts/glossary.mjs";
import { parseSiteManifest } from "../scripts/site-catalog.mjs";
import { validateTopicContent } from "../scripts/topic-content.mjs";
import { sha256, contentType } from "./assets.mjs";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function unitName(unit) {
  const [kind, slug, ...rest] = unit.split("/");
  if (
    !["notes", "sites"].includes(kind) ||
    !slugPattern.test(slug) ||
    rest.length
  )
    throw new Error(`${unit}: expected notes/<dir> or sites/<slug>`);
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
async function checkRepository(root) {
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
 * `verify()` checks again, after reading, that HEAD and the paths have not
 * moved.
 */
export async function committedSource(root, paths) {
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
    async verify() {
      if ((await head()) !== commit)
        throw new Error(
          `${root}: HEAD moved during publication; publish again`,
        );
      await check();
    },
  };
}
