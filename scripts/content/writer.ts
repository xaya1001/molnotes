import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { compileUnit } from "./compile-unit.ts";
import { libraryUsage, readChemicalLibrary } from "./chemical-library.ts";
import { readGlossary } from "./content-files.ts";
import { parseSiteManifest } from "../../shared/site-catalog.ts";
import { checkNote } from "./writer-check.ts";
import {
  readSeriesNotes,
  writerFiles,
  writerRoutes,
} from "./writer-context.ts";
import {
  validateChapterTerms,
  validateTopicSchemes,
  validateTopicValues,
} from "./topic-validation.ts";
import { topicBasePath } from "../../shared/topic-content.ts";

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
      /^(sites\/[a-z0-9-]+)(?:\/(chapters\/[a-z0-9-]+\.md|content\.json#([a-z0-9-]+)))?$/.exec(
        args[0].replace(/^content\//, ""),
      );
    if (target) {
      if (args.length !== 1)
        throw new Error("site check does not accept glossary additions");
      const [, unit, path, id] = target;
      const content = JSON.parse(
        await readFile(join(root, unit, "content.json"), "utf8"),
      );
      const site = parseSiteManifest(
        unit.split("/")[1],
        JSON.parse(await readFile(join(root, unit, "site.json"), "utf8")),
      );
      const library = (await readChemicalLibrary(root)).entries;
      const common = {
        root,
        unit,
        authored: content,
        group: site.group,
        library,
      };
      if (path) {
        const { chapter, data, index } = await compileUnit({
          ...common,
          kind: "chapter",
          chapter: id ?? path,
        });
        const where = `${unit}/content.json`;
        const glossary = await readGlossary(root);
        validateChapterTerms(
          chapter,
          new Set(glossary.map((term) => term.term)),
          where,
        );
        await validateTopicSchemes(chapter.blocks, data, where);
        const source = await writerFiles(root);
        await validateTopicValues(
          chapter,
          `content.chapters[${index}]`,
          site.slug,
          data,
          {
            routes: await writerRoutes(source),
            assets: new Set(source.files.map((file) => `/${file}`)),
          },
        );
        libraryUsage(library, [
          { value: chapter, path: topicBasePath(site), title: site.title },
        ]);
      } else await compileUnit({ ...common, kind: "site" });
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
