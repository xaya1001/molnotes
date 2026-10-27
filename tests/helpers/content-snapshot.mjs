// Release roots in the layout `content publish` maintains, for tests that
// switch the snapshot a running website reads.
import { mkdir, readdir, rename, symlink } from "node:fs/promises";
import { join } from "node:path";

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
