import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { compileUnit } from "./compile-unit.ts";
import {
  libraryUsage,
  readChemicalLibrary,
  readChemicalLibraryEntries,
} from "./chemical-library.ts";
import { noteFigureBlocks } from "../../shared/notes-index.ts";
import { readGlossary } from "./content-files.ts";
import { parseSiteManifest } from "../../shared/site-catalog.ts";
import { checkNote } from "./writer-check.ts";
import { checkPageFigures } from "./writer-figures.ts";
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
    const { positionals, values } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        "glossary-additions": { type: "string" },
        "figure-base": { type: "string" },
      },
    });
    if (positionals.length !== 1)
      throw new Error(
        "check <page> [--glossary-additions <json>] [--figure-base <commit>]",
      );
    const [file] = positionals;
    const { "glossary-additions": additions, "figure-base": base } = values;
    const target =
      /^(sites\/[a-z0-9-]+)(?:\/(chapters\/[a-z0-9-]+\.md|content\.json#([a-z0-9-]+)))?$/.exec(
        file.replace(/^content\//, ""),
      );
    if (target) {
      if (additions !== undefined)
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
      const page = { unit, chapter: id ?? path };
      if (page.chapter) {
        const { chapter, data, index, references } = await compileUnit({
          ...common,
          kind: "chapter",
          chapter: page.chapter,
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
        if (base !== undefined)
          await checkPageFigures(root, base, page, file, library, [
            chapter,
            ...references,
          ]);
      } else {
        const { content, references } = await compileUnit({
          ...common,
          kind: "site",
        });
        if (base !== undefined)
          await checkPageFigures(root, base, page, file, library, [
            content,
            ...references,
          ]);
      }
      console.log(`${file}: 0 errors`);
      return;
    }
    const result = await checkNote(root, file, additions);
    for (const error of result.errors) console.error(error);
    for (const hint of result.hints) console.log(`hint: ${hint}`);
    if (!result.errors.length && base !== undefined) {
      const blocks = noteFigureBlocks(
        await readFile(join(root, file), "utf8"),
        file,
      );
      const { entries } = blocks.length
        ? await readChemicalLibraryEntries(root)
        : { entries: {} };
      await checkPageFigures(root, base, file, file, entries, blocks);
    }
    console.log(
      `${file}: ${result.errors.length} errors, ${result.hints.length} hints`,
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
