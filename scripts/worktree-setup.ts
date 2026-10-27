// Prepares a checkout for development: dependencies through the host's
// worktree-deps, the link to the canonical materials shelf, and links to the
// companion checkout `<canonical>-private` that holds the agent configuration.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(".");
const canonical = dirname(
  execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim(),
);
const run = (command: string, args: string[]) =>
  execFileSync(command, args, { stdio: "inherit" });

function link(target: string, path: string) {
  const entry = lstatSync(path, { throwIfNoEntry: false });
  if (!entry) symlinkSync(target, path);
  else if (!entry.isSymbolicLink())
    throw new Error(`${path} exists and is not a link to ${target}`);
}

run("worktree-deps", []);

const shelf = join(canonical, "materials");
if (root !== canonical && existsSync(shelf))
  link(shelf, join(root, "materials"));

const companion = `${canonical}-private`;
if (existsSync(companion)) {
  link(companion, join(root, "private"));
  for (const name of ["AGENTS.md", ".codex", ".claude"])
    link(join("private", name), join(root, name));
}
