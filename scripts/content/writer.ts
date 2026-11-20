import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readPracticeChapters } from "./practice-markdown.ts";
import { isObject } from "../../shared/json.ts";
import { validateBlocks } from "../../shared/topic-blocks.ts";
import { checkNote } from "./writer-check.ts";
import { readSeriesNotes } from "./writer-context.ts";

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
    const target =
      /^(sites\/[a-z0-9-]+)\/(chapters\/[a-z0-9-]+\.md|content\.json#([a-z0-9-]+))$/.exec(
        args[0].replace(/^content\//, ""),
      );
    if (target) {
      if (args.length !== 1)
        throw new Error("practice check does not accept glossary additions");
      const [, unit, path, id] = target;
      const content = JSON.parse(
        await readFile(join(root, unit, "content.json"), "utf8"),
      );
      const entry = id
        ? content.chapters.find((c: unknown) => isObject(c) && c.id === id)
        : path;
      if (!entry || !content.chapters.includes(entry))
        throw new Error(`${args[0]}: chapter not found`);
      const site = JSON.parse(
        await readFile(join(root, unit, "site.json"), "utf8"),
      );
      if (site.group !== "练习")
        throw new Error(`${unit}: expected practice site`);
      const selected = { ...content, chapters: [entry] };
      await readPracticeChapters(root, unit, selected, site.group);
      for (const chapter of selected.chapters)
        validateBlocks(chapter, content.data, args[0], {
          excerpts: [],
          quiz: [],
          predictionIds: new Set(),
          pathPicker: false,
        });
      console.log(`${args[0]}: 0 errors`);
      return;
    }
    const result = await checkNote(root, args[0], args[2]);
    for (const error of result.errors) console.error(error);
    for (const hint of result.hints) console.log(`hint: ${hint}`);
    console.log(
      `${args[0]}: ${result.errors.length} errors, ${result.hints.length} hints`,
    );
    if (result.errors.length) process.exitCode = 1;
    return;
  }
  if (args.length !== 1 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args[0]))
    throw new Error("series <directory>");
  const notes = await readSeriesNotes(root);
  const selected = notes.filter((note) => note.directory === args[0]);
  if (!selected.length) throw new Error(`${args[0]}: no written notes`);
  for (const note of selected) {
    console.log(`${note.order}. ${note.title}\t${note.file}`);
    for (const section of note.sections) console.log(`  ${section}`);
    console.log(
      `  terms: ${note.definitions.filter((term) => notes.find((note) => note.definitions.includes(term))?.file === note.file).join(", ") || "—"}`,
    );
  }
}
