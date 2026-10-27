import { spawn } from "node:child_process";
import {
  mkdir,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { isMainModule } from "../../shared/main-module.mjs";
import { systemConfig } from "./system-config.mjs";

/**
 * The update service runs from an immutable copy of `server/system/` and the
 * `shared/` modules it imports per main revision: `<root>/releases/<sha>/`,
 * with `<root>/current` pointing at the active one. The canonical checkout
 * can then move without touching the running service.
 */
const shaPattern = /^[0-9a-f]{40}$/;
const KEEP_RELEASES = 5;
const RELEASED = ["server/system", "shared"];
/** The service entry inside a release. */
const ENTRY = "server/system/server.mjs";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function releasesDir(root) {
  return join(root, "releases");
}

/**
 * Writes the released directories at `revision` from the repository into its
 * release directory, keeping their repository paths. A complete release is
 * immutable and reused as it is.
 */
export async function prepareRelease({ repo, root, revision }) {
  if (!shaPattern.test(revision)) throw new Error("invalid revision");
  const target = join(releasesDir(root), revision);
  if (await exists(join(target, ENTRY))) return target;
  const staging = `${target}.partial`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  await new Promise((resolve, reject) => {
    const archive = spawn(
      "git",
      ["-C", repo, "archive", revision, ...RELEASED],
      {
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const extract = spawn("tar", ["-x", "-C", staging], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    archive.stdout.pipe(extract.stdin);
    let pending = 2;
    const done = (name) => (code) => {
      if (code !== 0) reject(new Error(`${name} exited ${code}`));
      else if (--pending === 0) resolve();
    };
    archive.once("error", reject);
    extract.once("error", reject);
    archive.once("close", done("git archive"));
    extract.once("close", done("tar"));
  });
  await stat(join(staging, ENTRY));
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
  return target;
}

export async function activeRevision(root) {
  try {
    return basename(await readlink(join(root, "current")));
  } catch {
    return null;
  }
}

/**
 * Points `current` at a prepared release by atomically replacing the link,
 * then removes all but the newest releases, never the active or previous one.
 */
export async function activateRelease({ root, revision }) {
  if (!shaPattern.test(revision)) throw new Error("invalid revision");
  const target = join(releasesDir(root), revision);
  await stat(join(target, ENTRY));
  const previous = await activeRevision(root);
  const link = join(root, "current");
  const next = `${link}.next`;
  await rm(next, { force: true });
  await symlink(target, next);
  await rename(next, link);

  const entries = await readdir(releasesDir(root), { withFileTypes: true });
  const releases = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && shaPattern.test(entry.name))
      .map(async (entry) => ({
        name: entry.name,
        time: (await stat(join(releasesDir(root), entry.name))).mtimeMs,
      })),
  );
  const keep = new Set([revision, previous]);
  for (const { name } of releases
    .sort((a, b) => b.time - a.time)
    .slice(KEEP_RELEASES)) {
    if (!keep.has(name))
      await rm(join(releasesDir(root), name), { recursive: true, force: true });
  }
  return { previous, current: revision };
}

// Installs and activates a release of a main revision from the canonical
// checkout, for the first installation and for rollback:
// `node server/system/releases.mjs <sha>`.
if (isMainModule(import.meta.url)) {
  const revision = process.argv[2];
  const { checkout, releases } = systemConfig();
  await prepareRelease({ repo: checkout, root: releases, revision });
  const { previous, current } = await activateRelease({
    root: releases,
    revision,
  });
  process.stdout.write(
    `server release ${current} active (previous ${previous ?? "none"})\n`,
  );
}
