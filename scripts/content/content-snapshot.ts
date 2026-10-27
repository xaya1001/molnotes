import { randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { buildSnapshot } from "./content-publish.ts";
import { committedSource } from "./content-files.ts";
import type { Shelf } from "./citations.ts";
import type { Snapshot } from "../../shared/snapshot.ts";

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code;

/** Snapshots a release root keeps besides the one `current` names. */
export const keptSnapshots = 5;
/** `<commit>-<build time>`: every build gets its own directory, so `current` always changes path. */
const snapshotName = /^([0-9a-f]{40})-(\d{8}T\d{9}Z)$/;
/** The snapshot directory name of a build of `commit` at `builtAt`. */
const nameOf = (commit: string, builtAt: string) =>
  `${commit}-${builtAt.replace(/[-:.]/g, "")}`;
/** Kept snapshot directories, newest first. */
async function snapshots(releases: string) {
  return (await readdir(releases))
    .map((name) => snapshotName.exec(name))
    .filter((match) => match !== null)
    .map(([name, commit, built]) => ({ name, commit, built }))
    .sort((a, b) => b.built.localeCompare(a.built));
}

/** Asset hashes by file path in the snapshot at `directory`, empty when there is none. */
async function assetHashes(
  directory: string | undefined,
): Promise<Map<string, string>> {
  if (!directory) return new Map();
  try {
    const { assets }: Snapshot = JSON.parse(
      await readFile(join(directory, "snapshot.json"), "utf8"),
    );
    return new Map(assets.map((a) => [`${a.scope}/${a.path}`, a.sha256]));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return new Map();
    throw error;
  }
}

/**
 * Writes a built snapshot to `output`, which must not exist yet: the files
 * go to a sibling directory that is renamed into place once complete. A file
 * whose hash matches the same path in the `previous` snapshot is hard-linked
 * instead of written, so unchanged files take no extra space.
 */
export async function writeSnapshot(
  output: string,
  { snapshot, files }: { snapshot: Snapshot; files: Map<string, Buffer> },
  { previous }: { previous?: string } = {},
) {
  const temporary = join(
    dirname(output),
    `.${basename(output)}.${randomUUID()}`,
  );
  const earlier = await assetHashes(previous);
  const hashes = new Map(
    snapshot.assets.map((a) => [`${a.scope}/${a.path}`, a.sha256]),
  );
  try {
    await mkdir(temporary, { recursive: true });
    for (const [path, bytes] of files) {
      const file = join(temporary, "files", path);
      await mkdir(dirname(file), { recursive: true });
      if (earlier.get(path) && earlier.get(path) === hashes.get(path))
        await link(join(previous!, "files", path), file);
      else await writeFile(file, bytes);
    }
    await writeFile(join(temporary, "snapshot.json"), JSON.stringify(snapshot));
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (errorCode(error) === "ENOTEMPTY" || errorCode(error) === "EEXIST")
      throw new Error(`${output}: already exists`);
    throw error;
  }
}

/** Points `<releases>/current` at the snapshot directory `name` in one rename. */
async function switchCurrent(releases: string, name: string) {
  const link = join(releases, `.current.${randomUUID()}`);
  await symlink(name, link);
  try {
    await rename(link, join(releases, "current"));
  } catch (error) {
    await rm(link, { force: true });
    throw error;
  }
}

/** The snapshot directory `current` names, or undefined before the first publication. */
async function currentName(releases: string) {
  try {
    return await readlink(join(releases, "current"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

/** Removes all but the newest `keptSnapshots` snapshots, never the current one. */
async function prune(releases: string) {
  const current = await currentName(releases);
  const old = (await snapshots(releases)).filter(
    ({ name }) => name !== current,
  );
  for (const { name } of old.slice(keptSnapshots - 1))
    await rm(join(releases, name), { recursive: true, force: true });
}

/**
 * Builds the committed content at `root` into `<releases>/<commit>-<build
 * time>/` and switches `current` to it. The content directory must be clean
 * at HEAD, before and after the build. Returns the snapshot directory name.
 */
export async function publishSnapshot(
  root: string,
  releases: string,
  { shelf }: { shelf?: Shelf } = {},
) {
  const source = await committedSource(root, ["."]);
  const built = await buildSnapshot(root, { shelf, commit: source.commit });
  await source.verify();
  await mkdir(releases, { recursive: true });
  const name = nameOf(source.commit, built.snapshot.builtAt);
  const current = await currentName(releases);
  await writeSnapshot(join(releases, name), built, {
    previous: current && join(releases, current),
  });
  await switchCurrent(releases, name);
  await prune(releases);
  return name;
}

/**
 * Switches `current` back to the newest kept snapshot of a commit, named in
 * full or by a prefix that only one commit matches.
 */
export async function rollbackSnapshot(
  releases: string,
  commit: string | undefined,
) {
  if (commit === undefined || !/^[0-9a-f]{4,40}$/.test(commit))
    throw new Error("Expected a commit");
  const matches = (await snapshots(releases)).filter((snapshot) =>
    snapshot.commit.startsWith(commit),
  );
  if (!matches.length) throw new Error(`${commit}: no kept snapshot`);
  if (new Set(matches.map((snapshot) => snapshot.commit)).size > 1)
    throw new Error(`${commit}: matches several commits`);
  const [{ name }] = matches;
  await stat(join(releases, name, "snapshot.json"));
  await switchCurrent(releases, name);
  return name;
}
