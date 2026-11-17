import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { noteMarkdown } from "../../shared/notes-index.ts";
import { parse as yaml } from "yaml";
import { readGlossary } from "./content-files.ts";

const exec = promisify(execFile);
const markdown = noteMarkdown();
/** Tracked files remain available to a sparse checkout; local edits take precedence. */
export async function writerFiles(root: string) {
  const local = new Set<string>();
  async function walk(path: string) {
    let entries;
    try {
      entries = await readdir(join(root, path), { withFileTypes: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    for (const entry of entries) {
      const file = `${path}/${entry.name}`;
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) local.add(file);
    }
  }
  await walk("notes");
  await walk("sites");
  let prefix = "",
    head = "",
    sparse = new Set<string>();
  try {
    prefix = (
      await exec("git", ["rev-parse", "--show-prefix"], { cwd: root })
    ).stdout.trim();
    head = (
      await exec("git", ["rev-parse", "HEAD"], { cwd: root })
    ).stdout.trim();
    // S marks skip-worktree paths. Deleted local files must stay deleted.
    const tracked = (
      await exec("git", ["ls-files", "-t", "-z", "--", "notes", "sites"], {
        cwd: root,
        maxBuffer: 16 << 20,
      })
    ).stdout;
    sparse = new Set(
      tracked
        .split("\0")
        .filter((x) => x.startsWith("S "))
        .map((x) => x.slice(2)),
    );
  } catch (e) {
    if ((e as { code?: number }).code !== 128) throw e;
  }
  const files = [...new Set([...local, ...sparse])].sort();
  return {
    files,
    async read(file: string) {
      return local.has(file) || !sparse.has(file)
        ? readFile(join(root, file), "utf8")
        : (
            await exec("git", ["show", `${head}:${prefix}${file}`], {
              cwd: root,
              maxBuffer: 16 << 20,
            })
          ).stdout;
    },
  };
}

export interface WriterNote {
  file: string;
  directory: string;
  directoryOrder: number;
  title: string;
  order: number;
  sections: string[];
  definitions: string[];
}

/** Read series context without compiling note bodies. */
export async function readSeriesNotes(root: string) {
  const source = await writerFiles(root);
  const glossary = await readGlossary(root);
  const notes: WriterNote[] = [];
  const termsByName = new Map(glossary.map((term) => [term.term, term]));
  for (const file of source.files.filter((f) =>
    /^notes\/[^/]+\/[^/]+\.md$/.test(f),
  )) {
    const text = await source.read(file);
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    if (!match) throw new Error(`${file}: missing YAML front matter`);
    const metadata = yaml(match[1]);
    if (
      typeof metadata?.title !== "string" ||
      !Number.isInteger(metadata.order)
    )
      throw new Error(`${file}: expected title and order`);
    const directory = file.split("/")[1];
    const dir = JSON.parse(
      await source.read(`notes/${directory}/directory.json`),
    );
    const body = text.slice(match[0].length);
    const sections: string[] = [];
    const definitions = new Set<string>();
    for (const token of markdown.parse(body, { file })) {
      if (token.type === "heading_open" && ["h2", "h3"].includes(token.tag)) {
        const line = body.split("\n")[token.map![0]];
        sections.push(line.replace(/^#{2,3}\s+/, ""));
      }
      if (token.type === "inline") {
        const children = token.children ?? [];
        for (const [i, child] of children.entries()) {
          if (child.type === "note_term") {
            const full = /^[（(]([^（）()]+)[）)]/.exec(
              children[i + 1]?.content ?? "",
            )?.[1];
            if (
              full &&
              termsByName.get(child.content)?.full.toLowerCase() ===
                full.toLowerCase()
            )
              definitions.add(child.content);
          }
          if (child.type === "text")
            for (const match of child.content.matchAll(
              /([^\s，。；：、（）()]+)[（(]([A-Za-z][^（）()]*?)[）)]/g,
            ))
              if (
                termsByName.get(match[1])?.full.toLowerCase() ===
                match[2].toLowerCase()
              )
                definitions.add(match[1]);
        }
      }
    }
    notes.push({
      file,
      directory,
      directoryOrder: dir.order,
      title: metadata.title,
      order: metadata.order,
      sections,
      definitions: [...definitions],
    });
  }
  return notes.sort(
    (a, b) =>
      a.directoryOrder - b.directoryOrder ||
      a.directory.localeCompare(b.directory) ||
      a.order - b.order ||
      a.file.localeCompare(b.file),
  );
}
