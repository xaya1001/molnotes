import { isObject, isInteger } from "../../shared/json.ts";
import { readFile, readdir, lstat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { parseNote, noteCitations } from "../../shared/notes-index.ts";
import {
  contentCitations,
  validateSourceRegistry,
} from "../../shared/source-citations.ts";
import { validateGlossary } from "../../shared/glossary.ts";
import { parseSiteManifest } from "../../shared/site-catalog.ts";
import { validateTopicContent } from "../../shared/topic-content.ts";
import { sha256, contentType } from "../../shared/assets.ts";
import type {
  DirectoryMetadata,
  SnapshotAsset,
  SnapshotSite,
} from "../../shared/snapshot.ts";
import type { TopicContent } from "../../src/ui/topic/content.ts";

/** An asset of a unit with its bytes. */
export interface UnitAsset extends SnapshotAsset {
  bytes: Buffer;
}
export interface CitationOccurrence {
  href: unknown;
  where: string;
}
interface UnitBase {
  unit: string;
  slug: string;
  assets: UnitAsset[];
  occurrences: CitationOccurrence[];
}
export interface SiteUnit extends UnitBase {
  kind: "sites";
  site: SnapshotSite;
  content: TopicContent;
}
export interface NotesUnit extends UnitBase {
  kind: "notes";
  metadata: DirectoryMetadata;
  notes: { slug: string; source: string; author: boolean }[];
}
export type ContentUnit = SiteUnit | NotesUnit;

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function unitName(unit: string): {
  kind: ContentUnit["kind"];
  slug: string;
} {
  const [kind, slug, ...rest] = unit.split("/");
  if (
    (kind !== "notes" && kind !== "sites") ||
    !slugPattern.test(slug) ||
    rest.length
  )
    throw new Error(`${unit}: expected notes/<dir> or sites/<slug>`);
  return { kind, slug };
}
// Parsed content files are checked by the validators they are handed to.
const json = async (file: string): Promise<unknown> =>
  JSON.parse(await readFile(file, "utf8"));
async function files(root: string, relative = ""): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(join(root, relative), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !relative)
      return [];
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
function checkDirectoryMetadata(
  metadata: unknown,
  unit: string,
): asserts metadata is DirectoryMetadata {
  if (
    !isObject(metadata) ||
    Object.keys(metadata).sort().join(",") !== "intro,order,title" ||
    typeof metadata.title !== "string" ||
    !metadata.title.trim() ||
    typeof metadata.intro !== "string" ||
    !isInteger(metadata.order) ||
    metadata.order < 1
  )
    throw new Error(`${unit}/directory.json: invalid directory metadata`);
}
export async function readUnit(
  root: string,
  unit: string,
): Promise<ContentUnit> {
  const { kind, slug } = unitName(unit);
  const folder = join(root, unit);
  if (!(await lstat(folder)).isDirectory())
    throw new Error(`${unit}: expected a directory`);
  const prefix = kind === "sites" ? "static" : "assets";
  const assets: UnitAsset[] = [];
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
      const prompt = await readFile(join(folder, "prompts", path), "utf8");
      asset.prompt = prompt;
      if (!prompt.trim())
        throw new Error(`${unit}/prompts/${path}: empty prompt`);
    }
  if (kind === "sites") {
    const metadata = await json(join(folder, "site.json"));
    const site: SnapshotSite = { ...parseSiteManifest(slug, metadata) };
    for (const key of ["label"] as const) {
      if (isObject(metadata) && metadata[key] !== undefined) {
        if (typeof metadata[key] !== "string" || !metadata[key].trim())
          throw new Error(`${unit}/site.json: invalid ${key}`);
        site[key] = metadata[key];
      }
    }
    const content = validateTopicContent(
      await json(join(folder, "content.json")),
      `${unit}/content.json`,
    );
    if ("glossary" in content && content.glossary !== undefined)
      throw new Error(
        `${unit}/content.json: define terms in glossary.json and list them in chapter terms`,
      );
    for (const source of content.sources ?? [])
      if ("file" in source && source.file !== undefined)
        throw new Error(
          `${unit}/content.json: source ${source.id} names a shelf file; register it in sources.json and cite it`,
        );
    const occurrences = contentCitations(content, `${unit}/content.json`);
    return { unit, kind, slug, site, content, assets, occurrences };
  }
  const metadata = await json(join(folder, "directory.json"));
  checkDirectoryMetadata(metadata, unit);
  const notes: NotesUnit["notes"] = [];
  const occurrences: CitationOccurrence[] = noteCitations(
    metadata.intro,
    `${unit}/directory.json`,
  );
  async function read(name: string, author: boolean) {
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
  let author: Dirent[] = [];
  try {
    author = await readdir(join(folder, "author"), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const entry of author) {
    if (!entry.isFile() || !entry.name.endsWith(".md"))
      throw new Error(
        `${unit}/author/${entry.name}: author material must be <slug>.md files`,
      );
    await read(entry.name, true);
  }
  return {
    unit,
    kind,
    slug,
    metadata,
    notes,
    assets,
    occurrences,
  };
}
/** The source registry in the content directory, or null when there is none. */
export async function readRegistry(root: string) {
  let registry;
  try {
    registry = await json(join(root, "sources.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`sources.json: ${(error as Error).message}`);
  }
  return validateSourceRegistry(registry);
}
/** The site glossary in the content directory; every publication needs it. */
export async function readGlossary(root: string) {
  let glossary;
  try {
    glossary = await json(join(root, "glossary.json"));
  } catch (error) {
    throw new Error(
      `glossary.json: ${(error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : (error as Error).message}`,
    );
  }
  return validateGlossary(glossary);
}
const execFileAsync = promisify(execFile);
const git = async (root: string, args: string[]) =>
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
async function checkRepository(root: string) {
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
export async function committedSource(root: string, paths: string[]) {
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
