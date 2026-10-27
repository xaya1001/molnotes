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
import { buildSnapshot } from "./content-publish.mjs";
import { committedSource } from "./content-files.mjs";

/** Snapshots a release root keeps besides the one `current` names. */
export const keptSnapshots = 5;
/** `<commit>-<build time>`: every build gets its own directory, so `current` always changes path. */
const snapshotName = /^([0-9a-f]{40})-(\d{8}T\d{9}Z)$/;
/** The snapshot directory name of a build of `commit` at `builtAt`. */
const nameOf = (commit, builtAt) =>
  `${commit}-${builtAt.replace(/[-:.]/g, "")}`;
/** Kept snapshot directories, newest first. */
async function snapshots(releases) {
  return (await readdir(releases))
    .map((name) => snapshotName.exec(name))
    .filter(Boolean)
    .map(([name, commit, built]) => ({ name, commit, built }))
    .sort((a, b) => b.built.localeCompare(a.built));
}

/** Asset hashes by file path in the snapshot at `directory`, empty when there is none. */
async function assetHashes(directory) {
  if (!directory) return new Map();
  try {
    const { assets } = JSON.parse(
      await readFile(join(directory, "snapshot.json"), "utf8"),
    );
    return new Map(assets.map((a) => [`${a.scope}/${a.path}`, a.sha256]));
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
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
  output,
  { snapshot, files },
  { previous } = {},
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
        await link(join(previous, "files", path), file);
      else await writeFile(file, bytes);
    }
    await writeFile(join(temporary, "snapshot.json"), JSON.stringify(snapshot));
    await rename(temporary, output);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (error.code === "ENOTEMPTY" || error.code === "EEXIST")
      throw new Error(`${output}: already exists`);
    throw error;
  }
}

/** Points `<releases>/current` at the snapshot directory `name` in one rename. */
async function switchCurrent(releases, name) {
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
async function currentName(releases) {
  try {
    return await readlink(join(releases, "current"));
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

/** Removes all but the newest `keptSnapshots` snapshots, never the current one. */
async function prune(releases) {
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
export async function publishSnapshot(root, releases, { shelf } = {}) {
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
export async function rollbackSnapshot(releases, commit) {
  if (!/^[0-9a-f]{4,40}$/.test(commit ?? ""))
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
