import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pythonInterpreter } from "../python.ts";
import { checkNote } from "./writer-check.ts";
import { excerpt, oneLine, searchIndex, writerIndex } from "./writer-index.ts";

export async function writerCommand(
  root: string,
  command: string,
  args: string[],
) {
  if (command === "check") {
    if (!(
      args.length === 1 ||
      (args.length === 3 && args[1] === "--glossary-additions")
    ))
      throw new Error(
        "check <notes/directory/note.md> [--glossary-additions <json>]",
      );
    const result = await checkNote(root, args[0], args[2]);
    for (const error of result.errors) console.error(error);
    for (const hint of result.hints) console.log(`hint: ${hint}`);
    console.log(
      `${args[0]}: ${result.errors.length} errors, ${result.hints.length} hints`,
    );
    if (result.errors.length) process.exitCode = 1;
    return;
  }
  let scope = "",
    limit = 10;
  if (!args[0]?.trim())
    throw new Error(`${command}: expected a query or directory`);
  if (
    command === "series" &&
    (args.length !== 1 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args[0]))
  )
    throw new Error("series <directory>");
  if (command === "search")
    for (let i = 1; i < args.length; i += 2) {
      if (
        args[i] === "--in" &&
        ["notes", "terms", "books"].includes(args[i + 1])
      )
        scope = args[i + 1];
      else if (
        args[i] === "--limit" &&
        /^\d+$/.test(args[i + 1]) &&
        Number(args[i + 1]) >= 1 &&
        Number(args[i + 1]) <= 100
      )
        limit = Number(args[i + 1]);
      else
        throw new Error(
          "search <query> [--in notes|terms|books] [--limit 1..100]",
        );
    }
  if (scope !== "books") {
    const index = await writerIndex(root);
    try {
      const uses = (term: string) =>
        index.notes.filter((note) => note.terms.includes(term));
      const first = (term: string) =>
        index.notes.find((note) => note.definitions.includes(term));
      if (command === "series") {
        const notes = index.notes.filter((note) => note.directory === args[0]);
        if (!notes.length) throw new Error(`${args[0]}: no written notes`);
        for (const note of notes) {
          console.log(`${note.order}. ${note.title}\t${note.file}`);
          for (const section of note.sections)
            if (section.title) console.log(`  ${section.title}`);
          console.log(
            `  terms: ${note.definitions.filter((term) => first(term)?.file === note.file).join(", ") || "—"}`,
          );
        }
      } else
        for (const kind of ["notes", "terms"]) {
          if (scope && scope !== kind) continue;
          console.log(`[${kind}]`);
          for (const hit of searchIndex(index.db, kind, args[0], limit)) {
            if (kind === "notes") {
              const note = index.notes.find(
                (note) => note.file === hit.identity,
              )!;
              console.log(
                `${note.file}\t${note.directoryTitle} / ${note.title} · ${hit.heading}\t${excerpt(String(hit.text), args[0])}`,
              );
            } else {
              const term = index.glossary.find(
                (term) => term.term === hit.identity,
              )!;
              const references = uses(term.term).filter(
                (note) => note.file !== first(term.term)?.file,
              );
              const refs =
                references
                  .slice(0, limit)
                  .map((note) => note.file)
                  .join(", ") || "—";
              console.log(
                `${term.term}\t${term.full}\t${oneLine(term.definition)}\n  first: ${first(term.term)?.file ?? "—"}; refs: ${
                  refs +
                  (references.length > limit
                    ? ` (+${references.length - limit})`
                    : "")
                }`,
              );
            }
          }
        }
      if (index.rebuilt)
        console.error(
          `notes/terms index: rebuilt in ${(index.milliseconds / 1000).toFixed(3)}s; ${index.file}`,
        );
    } finally {
      index.db.close();
    }
  }
  if (command === "search" && (!scope || scope === "books")) {
    console.log("[books]");
    const script = fileURLToPath(new URL("../material.py", import.meta.url));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        pythonInterpreter(),
        ["-I", script, "search", args[0], String(limit)],
        { stdio: "inherit" },
      );
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`books search exited ${code}`)),
      );
    });
  }
}
