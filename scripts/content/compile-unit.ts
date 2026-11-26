import { compileNotes } from "../../shared/notes-index.ts";
import {
  validateTopicContent,
  validateTopicChapter,
  validateBlockReferences,
  validateChapterDetails,
  validateChapterRoutes,
  validateTopicCitationSyntax,
} from "../../shared/topic-content.ts";
import { isObject } from "../../shared/json.ts";
import type { TopicBlock } from "../../src/ui/topic/blocks.ts";
import type { BlockReferences } from "../../shared/topic-blocks.ts";
import type { Library } from "../../shared/chemical-library/types.ts";
import { compileTableStructures } from "./table-structures.ts";
import { resolveCompoundSlots } from "./compound-slots.ts";
import {
  compileChoiceProse,
  compilePracticeExercises,
  readPracticeChapters,
} from "./practice-markdown.ts";
import { lintProse, proseTerms } from "./prose-lint.ts";

type SiteInput = {
  kind: "site";
  root: string;
  unit: string;
  authored: unknown;
  group: string;
  library: Library;
  onRequest?: Parameters<typeof readPracticeChapters>[4];
};
type NotesInput = {
  kind: "notes";
  root: string;
  input: Parameters<typeof compileNotes>[0];
};
type ChapterInput = Omit<SiteInput, "kind"> & {
  kind: "chapter";
  chapter: string;
};

export function compileUnit(input: SiteInput): Promise<{
  content: ReturnType<typeof validateTopicContent>;
  references: ReturnType<typeof resolveCompoundSlots>["references"];
}>;
export function compileUnit(input: NotesInput): ReturnType<typeof compileNotes>;
export function compileUnit(input: ChapterInput): Promise<{
  chapter: {
    id: string;
    title: string;
    blocks: TopicBlock[];
    terms?: string[];
  };
  data: Record<string, unknown> | undefined;
  index: number;
  references: ReturnType<typeof resolveCompoundSlots>["references"];
}>;
export async function compileUnit(
  input: SiteInput | NotesInput | ChapterInput,
) {
  if (input.kind === "notes") {
    const terms = await proseTerms(input.root);
    for (const note of input.input.notes) {
      if (note.author || !note.body || !note.file) continue;
      const errors = lintProse(note.body, note.file, terms);
      if (errors.length) throw new Error(errors.join("\n"));
    }
    return compileNotes(input.input);
  }
  const where = `${input.unit}/content.json`;
  let authored = input.authored;
  let index = 0;
  if (input.kind === "chapter") {
    if (!isObject(authored) || !Array.isArray(authored.chapters))
      throw new Error(`${where}: chapters must be an array`);
    index = authored.chapters.findIndex((entry) =>
      typeof entry === "string"
        ? entry === input.chapter
        : isObject(entry) && entry.id === input.chapter,
    );
    if (index === -1)
      throw new Error(`${input.unit}/${input.chapter}: chapter not found`);
    authored = { ...authored, chapters: [authored.chapters[index]] };
  }
  await compileTableStructures(authored, input.library, where);
  const resolved = resolveCompoundSlots(authored, input.library, where);
  await readPracticeChapters(
    input.root,
    input.unit,
    resolved.value,
    input.group,
    input.onRequest,
  );
  if (input.kind === "chapter") {
    if (!isObject(resolved.value) || !Array.isArray(resolved.value.chapters))
      throw new Error(`${where}: chapters must be an array`);
    const data = resolved.value.data;
    if (data !== undefined && !isObject(data))
      throw new Error(`${where}: data must be an object`);
    const chapter: unknown = resolved.value.chapters[0];
    const found: BlockReferences = {
      excerpts: [],
      quiz: [],
      exerciseIds: new Set(),
      pathPicker: false,
    };
    validateTopicChapter(chapter, data, where, found);
    const ids = (value: unknown) =>
      new Set(
        Array.isArray(value) ? value.filter(isObject).map((row) => row.id) : [],
      );
    const excerptIds = ids(resolved.value.excerpts);
    validateChapterRoutes(resolved.value.chapterRoute, [chapter], where);
    validateTopicCitationSyntax({ chapters: [chapter] }, where);
    validateBlockReferences(found.excerpts, excerptIds, "excerpt");
    validateChapterDetails(
      chapter,
      ids(resolved.value.sources),
      excerptIds,
      where,
    );
    validateBlockReferences(
      found.quiz,
      new Set([...ids(resolved.value.quiz), ...ids(resolved.value.placement)]),
      "quiz question",
    );
    if (found.pathPicker && resolved.value.paths === undefined)
      throw new Error(`${where}: a path-picker block needs top-level paths`);
    compilePracticeExercises(chapter, where);
    return { chapter, data, index, references: resolved.references };
  }
  const content = validateTopicContent(resolved.value, where);
  if ("glossary" in content && content.glossary !== undefined)
    throw new Error(
      `${where}: define terms in glossary.json and list them in chapter terms`,
    );
  for (const source of content.sources ?? [])
    if ("file" in source && source.file !== undefined)
      throw new Error(
        `${where}: source ${source.id} names a shelf file; register it in sources.json and cite it`,
      );
  for (const chapter of content.chapters)
    compilePracticeExercises(chapter, where);
  for (const question of [
    ...(content.quiz ?? []),
    ...(content.placement ?? []),
  ])
    compileChoiceProse(question, `${where}: question ${question.id}`);
  return { content, references: resolved.references };
}
