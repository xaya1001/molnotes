#!/usr/bin/env node
// Keeps private terms out of the public repository. The term list lives in the
// companion checkout (`private/leak-terms.txt`, one case-insensitive regular
// expression per line, `#` comments) and is never committed here.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function parseTerms(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => new RegExp(line, "i"));
}

/** Locations whose text matches a term; reports the location only, never the matched text. */
export function findPrivateTerms(terms, entries) {
  const hits = [];
  for (const { where, text } of entries)
    text.split("\n").forEach((line, index) => {
      if (terms.some((term) => term.test(line)))
        hits.push(`${where}:${index + 1}`);
    });
  return hits;
}

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });

function stagedEntries() {
  const entries = git(["diff", "--cached", "--name-only", "-z"])
    .split("\0")
    .filter(Boolean)
    .map((path) => ({ where: `${path} (path)`, text: path }));
  let file = null;
  for (const line of git([
    "diff",
    "--cached",
    "-U0",
    "--no-color",
    "--no-ext-diff",
  ]).split("\n")) {
    if (line.startsWith("+++ ")) file = line.slice(6);
    else if (line.startsWith("+") && file && file !== "package-lock.json")
      entries.push({ where: `${file} (added)`, text: line.slice(1) });
  }
  return entries;
}

function trackedEntries() {
  const entries = [];
  for (const path of git(["ls-files", "-z"]).split("\0").filter(Boolean)) {
    entries.push({ where: `${path} (path)`, text: path });
    if (path === "package-lock.json") continue;
    const content = readFileSync(path);
    if (!content.includes(0))
      entries.push({ where: path, text: content.toString("utf8") });
  }
  return entries;
}

function main() {
  const [mode, file] = process.argv.slice(2);
  const top = git(["rev-parse", "--show-toplevel"]).trim();
  let terms;
  try {
    terms = parseTerms(readFileSync(`${top}/private/leak-terms.txt`, "utf8"));
  } catch {
    throw new Error(
      "private/leak-terms.txt is missing; run npm run worktree:setup",
    );
  }
  const entries =
    mode === "--staged"
      ? stagedEntries()
      : mode === "--tracked"
        ? trackedEntries()
        : mode === "--message" && file
          ? [{ where: "commit message", text: readFileSync(file, "utf8") }]
          : null;
  if (!entries)
    throw new Error(
      "usage: check-private-terms.mjs --staged|--tracked|--message <file>",
    );
  const hits = findPrivateTerms(terms, entries);
  if (hits.length) throw new Error(`private terms found:\n${hits.join("\n")}`);
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
