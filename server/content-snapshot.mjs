import { randomUUID } from "node:crypto";
import {
  mkdir,
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
const snapshotName = /^[0-9a-f]{40}$/;

/**
 * Writes a built snapshot to `output`, which must not exist yet: the files
 * go to a sibling directory that is renamed into place once complete.
 */
export async function writeSnapshot(output, { snapshot, files }) {
  const temporary = join(
    dirname(output),
    `.${basename(output)}.${randomUUID()}`,
  );
  try {
    await mkdir(temporary, { recursive: true });
    for (const [path, bytes] of files) {
      const file = join(temporary, "files", path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, bytes);
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
  const snapshots = [];
  for (const name of await readdir(releases))
    if (snapshotName.test(name) && name !== current)
      snapshots.push({
        name,
        built: (await stat(join(releases, name, "snapshot.json"))).mtimeMs,
      });
  snapshots.sort((a, b) => b.built - a.built);
  for (const { name } of snapshots.slice(keptSnapshots - 1))
    await rm(join(releases, name), { recursive: true, force: true });
}

/**
 * Builds the committed content at `root` into `<releases>/<commit>/` and
 * switches `current` to it. The content directory must be clean at HEAD,
 * before and after the build. Returns the commit.
 */
export async function publishSnapshot(root, releases, { shelf } = {}) {
  const source = await committedSource(root, ["."]);
  const built = await buildSnapshot(root, { shelf, commit: source.commit });
  await source.verify();
  await mkdir(releases, { recursive: true });
  const target = join(releases, source.commit);
  const staged = join(releases, `.build.${randomUUID()}`);
  await writeSnapshot(staged, built);
  // A commit published again (for example after a compiler change) replaces its snapshot.
  const replaced = join(releases, `.replaced.${randomUUID()}`);
  let replacing = true;
  try {
    await rename(target, replaced);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    replacing = false;
  }
  await rename(staged, target);
  await switchCurrent(releases, source.commit);
  if (replacing) await rm(replaced, { recursive: true, force: true });
  await prune(releases);
  return source.commit;
}

/** Switches `current` back to a kept snapshot named by its commit or a unique prefix of it. */
export async function rollbackSnapshot(releases, commit) {
  if (!/^[0-9a-f]{4,40}$/.test(commit ?? ""))
    throw new Error("Expected a commit");
  const matches = (await readdir(releases)).filter(
    (name) => snapshotName.test(name) && name.startsWith(commit),
  );
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? `${commit}: matches several snapshots`
        : `${commit}: no kept snapshot`,
    );
  const [name] = matches;
  await stat(join(releases, name, "snapshot.json"));
  await switchCurrent(releases, name);
  return name;
}
