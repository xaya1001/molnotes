import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { noteMarkdown } from "../../shared/notes-index.ts";
import { parse as yaml } from "yaml";
import { readGlossary } from "./content-files.ts";

const exec = promisify(execFile);
const markdown = noteMarkdown();
export const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
export function excerpt(text: string, query: string) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  return oneLine(
    text.slice(Math.max(0, at - 60), Math.max(0, at) + query.length + 100),
  );
}

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
    async signature() {
      const rows = await Promise.all(
        ["glossary.json", ...files.filter((f) => /\.(md|json)$/.test(f))].map(
          async (file) => {
            if (sparse.has(file) && !local.has(file)) return [file, head];
            const info = await stat(join(root, file));
            return [file, info.mtimeMs, info.size];
          },
        ),
      );
      return JSON.stringify(rows);
    },
  };
}

export interface WriterNote {
  file: string;
  directory: string;
  directoryTitle: string;
  directoryOrder: number;
  slug: string;
  title: string;
  order: number;
  sections: { title: string; body: string }[];
  terms: string[];
  definitions: string[];
}

/** Search reads metadata without compiling unrelated drafts. Check owns strict validation. */
async function indexNotes(
  source: Awaited<ReturnType<typeof writerFiles>>,
  glossary: Awaited<ReturnType<typeof readGlossary>>,
) {
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
    const sections = [{ title: "", body: "" }];
    const terms = new Set<string>();
    const definitions = new Set<string>();
    for (const token of markdown.parse(body, { file })) {
      if (token.type === "heading_open" && ["h2", "h3"].includes(token.tag)) {
        const line = body.split("\n")[token.map![0]];
        sections.push({ title: line.replace(/^#{2,3}\s+/, ""), body: "" });
      }
      if (token.type === "inline") {
        sections.at(-1)!.body += `${token.content}\n`;
        const children = token.children ?? [];
        for (const [i, child] of children.entries()) {
          if (child.type === "note_term") {
            terms.add(child.content);
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
      directoryTitle: dir.title,
      directoryOrder: dir.order,
      slug: file.split("/")[2].slice(0, -3),
      title: metadata.title,
      order: metadata.order,
      sections,
      terms: [...terms],
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

export async function writerIndex(root: string) {
  const started = performance.now();
  const source = await writerFiles(root);
  const signature = "1:" + (await source.signature());
  const cache =
    process.env.MOLNOTES_WRITER_CACHE ||
    join(
      process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
      "molnotes",
      "writer",
    );
  await mkdir(cache, { recursive: true });
  const file = join(
    cache,
    createHash("sha256").update(resolve(root)).digest("hex").slice(0, 24) +
      ".sqlite3",
  );
  const db = new DatabaseSync(file);
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS entries USING fts5(kind UNINDEXED, identity UNINDEXED, heading UNINDEXED, text, tokenize='trigram');`);
    let rebuilt = false;
    if (
      db.prepare("SELECT value FROM state WHERE key='signature'").get()
        ?.value !== signature
    ) {
      const glossary = await readGlossary(root);
      const notes = await indexNotes(source, glossary);
      db.exec("BEGIN");
      try {
        db.exec("DELETE FROM entries; DELETE FROM state");
        const insert = db.prepare("INSERT INTO entries VALUES (?, ?, ?, ?)");
        for (const note of notes)
          for (const section of note.sections)
            insert.run(
              "notes",
              note.file,
              section.title,
              `${note.directoryTitle}\n${note.title}\n${section.title}\n${section.body}`,
            );
        for (const term of glossary)
          insert.run(
            "terms",
            term.term,
            "",
            `${term.term}\n${term.full}\n${term.definition}`,
          );
        const save = db.prepare("INSERT INTO state VALUES (?, ?)");
        save.run("notes", JSON.stringify(notes));
        save.run("glossary", JSON.stringify(glossary));
        save.run("signature", signature);
        db.exec("COMMIT");
        rebuilt = true;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
    const notes: WriterNote[] = JSON.parse(
      String(
        db.prepare("SELECT value FROM state WHERE key='notes'").get()!.value,
      ),
    );
    const glossary: Awaited<ReturnType<typeof readGlossary>> = JSON.parse(
      String(
        db.prepare("SELECT value FROM state WHERE key='glossary'").get()!.value,
      ),
    );
    return {
      db,
      source,
      notes,
      glossary,
      rebuilt,
      milliseconds: performance.now() - started,
      file,
    };
  } catch (e) {
    db.close();
    throw e;
  }
}

export function searchIndex(
  db: DatabaseSync,
  kind: string,
  query: string,
  limit: number,
) {
  // MATCH is literal, so punctuation and FTS operators in a query are not syntax.
  const long = Array.from(query).length >= 3;
  return db
    .prepare(
      `SELECT identity, heading, text FROM entries WHERE kind=? AND ${long ? "entries MATCH ?" : "instr(lower(text), lower(?)) > 0"} ORDER BY ${long ? "rank" : "rowid"} LIMIT ?`,
    )
    .all(kind, long ? `"${query.replaceAll('"', '""')}"` : query, limit);
}
