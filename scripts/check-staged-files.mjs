#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

const forbiddenDirectories = new Set([
  "node_modules",
  "dist",
  "logs",
  "backups",
  "secrets",
]);

export function findForbiddenPaths(paths) {
  return paths.filter((path) => {
    const name = basename(path);
    return (
      path.split("/").some((part) => forbiddenDirectories.has(part)) ||
      name === ".env" ||
      (name.startsWith(".env.") && name !== ".env.example") ||
      name === "auth.json" ||
      name.endsWith(".pem") ||
      name.endsWith(".key") ||
      name.endsWith(".p12") ||
      name.endsWith(".pfx") ||
      name.startsWith("id_ed25519") ||
      name.endsWith(".log")
    );
  });
}

function pathsFor(mode) {
  const args =
    mode === "--staged"
      ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
      : ["ls-files", "-z"];
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length || !["--staged", "--tracked"].includes(mode)) {
    throw new Error("usage: check-staged-files.mjs --staged|--tracked");
  }
  const forbidden = findForbiddenPaths(pathsFor(mode));
  if (forbidden.length) {
    throw new Error(
      `protected paths cannot be committed:\n${forbidden.join("\n")}`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
