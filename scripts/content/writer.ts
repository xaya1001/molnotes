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
