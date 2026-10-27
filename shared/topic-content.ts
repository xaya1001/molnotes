import type { TopicBlock } from "../src/ui/topic/blocks.ts";
import type { PredictionEntry, TopicContent } from "../src/ui/topic/content.ts";
import { isInteger, isList, isObject, type JsonObject } from "./json.ts";
import { validatePatentData } from "./patent-contract.ts";
import { contentCitations, parseCitation } from "./source-citations.ts";
// The part of a topic's content.json every topic shares. Topics add their own
// fields beside these; this check only covers the common core and the cross
// references between its parts, and it runs during publication
// (content build) and when a topic module loads (defineTopicContent).
import {
  chapterPredictions,
  validateBlocks,
  validateStaticBlocks,
  type BlockReferences,
} from "./topic-blocks.ts";

export {
  blockSearchText,
  chapterPredictions,
  resolveData,
} from "./topic-blocks.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function text(value: unknown, where: string): asserts value is string {
  assert(typeof value === "string" && value.trim(), `${where} must be text`);
}

const routePlaceholder = /\{(\w+)\}/g;

/**
 * Route of a chapter inside its topic. A chapter's own `path` wins;
 * otherwise `chapterRoute` (for example `/chapters/{number}`) names it from
 * the chapter's `{id}` or `{number}`; without it chapters use `/<id>`. The root is the topic home.
 */
export function chapterRoutePath(
  content: { chapterRoute?: string },
  chapter: { id: string; number?: unknown; path?: string },
): string {
  if (chapter.path !== undefined) return chapter.path;
  if (content.chapterRoute === undefined) return `/${chapter.id}`;
  // The content check allows only these two placeholders.
  return content.chapterRoute.replace(routePlaceholder, (_, name: string) =>
    String(name === "number" ? chapter.number : chapter.id),
  );
}

/** Throws on the first contract violation; returns the content unchanged. */
export function validateTopicContent(
  content: unknown,
  name = "content.json",
): TopicContent {
  checkTopicContent(content, name);
  return content;
}

/** A chapter whose id, title and path the first pass has checked. */
type ChapterHead = JsonObject & { id: string; path?: string };

// `content` is parsed JSON; the checks below are its boundary.
function checkTopicContent(
  content: unknown,
  name: string,
): asserts content is TopicContent {
  assert(isObject(content), `${name} must be an object`);
  assert(isList(content.chapters), `${name}: chapters must be an array`);
  if (content.data !== undefined)
    assert(isObject(content.data), `${name}: data must be an object`);
  validatePatentData({ chapters: content.chapters, data: content.data }, name);
  const chapterIds = new Set<unknown>();
  // Cross references the blocks and predictions make, checked once the
  // excerpts and quiz are known.
  const found: BlockReferences = {
    excerpts: [],
    quiz: [],
    predictionIds: new Set(),
    pathPicker: false,
  };
  function chapterHead(chapter: unknown): asserts chapter is ChapterHead {
    assert(isObject(chapter), `${name}: each chapter must be an object`);
    text(chapter.id, `${name}: chapter id`);
    assert(
      !chapterIds.has(chapter.id),
      `${name}: duplicate chapter ${chapter.id}`,
    );
    chapterIds.add(chapter.id);
    const where = `${name}: chapter ${chapter.id}`;
    text(chapter.title, `${where} title`);
    assert(
      chapter.path === undefined ||
        (typeof chapter.path === "string" && chapter.path.startsWith("/")),
      `${where} path must start with /`,
    );
  }
  const chapters: ChapterHead[] = [];
  for (const chapter of content.chapters) {
    chapterHead(chapter);
    chapters.push(chapter);
    validateBlocks(
      { id: chapter.id, blocks: chapter.blocks },
      content.data,
      `${name}: chapter ${chapter.id}`,
      found,
    );
  }

  // Learning paths: named chapter orders a reader can choose; the first is
  // the default. Previous and next follow the chosen path.
  if (content.paths !== undefined) {
    assert(
      isList(content.paths) && content.paths.length > 0,
      `${name}: paths must be a non-empty array`,
    );
    const pathIds = new Set<unknown>();
    for (const path of content.paths) {
      assert(isObject(path), `${name}: each path must be an object`);
      text(path.id, `${name}: path id`);
      assert(!pathIds.has(path.id), `${name}: duplicate path ${path.id}`);
      pathIds.add(path.id);
      text(path.title, `${name}: path ${path.id} title`);
      text(path.summary, `${name}: path ${path.id} summary`);
      assert(
        isList(path.chapters) &&
          path.chapters.length > 0 &&
          path.chapters.every((id) => chapterIds.has(id)),
        `${name}: path ${path.id} chapters must list known chapter ids`,
      );
    }
  }
  assert(
    !found.pathPicker || content.paths !== undefined,
    `${name}: a path-picker block needs top-level paths`,
  );

  const route = content.chapterRoute;
  if (route !== undefined) {
    assert(
      typeof route === "string" &&
        route.startsWith("/") &&
        [...route.matchAll(routePlaceholder)].every(([, name]) =>
          ["id", "number"].includes(name),
        ) &&
        !/[{}]/.test(route.replace(routePlaceholder, "")),
      `${name}: chapterRoute must start with / and use only {id} and {number}`,
    );
    if (route.includes("{number}"))
      for (const chapter of chapters)
        assert(
          isInteger(chapter.number),
          `${name}: chapter ${chapter.id} needs a number for chapterRoute`,
        );
    const paths = new Set(
      chapters.map((chapter) =>
        chapterRoutePath({ chapterRoute: route }, chapter),
      ),
    );
    assert(
      !paths.has("/") && paths.size === chapters.length,
      `${name}: chapterRoute gives two chapters the same path`,
    );
  }
  {
    const paths = new Set(
      chapters.map((chapter) =>
        chapterRoutePath({ chapterRoute: route }, chapter),
      ),
    );
    assert(
      !paths.has("/") && paths.size === chapters.length,
      `${name}: chapter paths must be unique and cannot be /`,
    );
  }

  const sourceIds = new Set<unknown>();
  const sources = content.sources ?? [];
  assert(isList(sources), `${name}: sources must be an array`);
  for (const source of sources) {
    assert(isObject(source), `${name}: each source must be an object`);
    assert(
      typeof source.id === "number" || typeof source.id === "string",
      `${name}: source id must be a number or text`,
    );
    assert(!sourceIds.has(source.id), `${name}: duplicate source ${source.id}`);
    sourceIds.add(source.id);
    text(source.title, `${name}: source ${source.id} title`);
  }
  for (const { href, where } of contentCitations(content, name)) {
    try {
      parseCitation(href);
    } catch (error) {
      throw new Error(
        `${where}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (content.sourcesIntro !== undefined) {
    const intro = content.sourcesIntro;
    assert(isObject(intro), `${name}: sourcesIntro must be an object`);
    text(intro.title, `${name}: sourcesIntro title`);
    assert(
      (intro.paragraphs === undefined) !== (intro.blocks === undefined),
      `${name}: sourcesIntro needs paragraphs or blocks`,
    );
    if (intro.paragraphs !== undefined)
      assert(
        isList(intro.paragraphs) &&
          intro.paragraphs.length > 0 &&
          intro.paragraphs.every((p) => typeof p === "string" && p),
        `${name}: sourcesIntro paragraphs must be a list of text`,
      );
    else {
      const intros = validateStaticBlocks(
        intro.blocks,
        content.data,
        `${name}: sourcesIntro`,
        found.predictionIds,
      );
      found.excerpts.push(...intros.excerpts);
    }
  }
  const refs = (ids: unknown, where: string) => {
    if (ids === undefined) return;
    assert(isList(ids), `${where} refs must be an array`);
    for (const id of ids)
      assert(sourceIds.has(id), `${where} refers to unknown source ${id}`);
  };
  for (const chapter of chapters) {
    assert(isList(chapter.refs), `${name}: chapter ${chapter.id} needs refs`);
    refs(chapter.refs, `${name}: chapter ${chapter.id}`);
  }

  const excerptIds = new Set<unknown>();
  const excerpts = content.excerpts ?? [];
  assert(isList(excerpts), `${name}: excerpts must be an array`);
  for (const excerpt of excerpts) {
    assert(isObject(excerpt), `${name}: each excerpt must be an object`);
    text(excerpt.id, `${name}: excerpt id`);
    assert(
      !excerptIds.has(excerpt.id),
      `${name}: duplicate excerpt ${excerpt.id}`,
    );
    excerptIds.add(excerpt.id);
    assert(
      sourceIds.has(excerpt.source),
      `${name}: excerpt ${excerpt.id} refers to unknown source ${excerpt.source}`,
    );
    assert(
      excerpt.text || excerpt.image,
      `${name}: excerpt ${excerpt.id} has no text or image`,
    );
  }
  for (const [id, where] of found.excerpts)
    assert(excerptIds.has(id), `${where} refers to unknown excerpt ${id}`);
  for (const chapter of chapters) {
    if (chapter.excerpts === undefined) continue;
    assert(
      isList(chapter.excerpts),
      `${name}: chapter ${chapter.id} excerpts must be an array`,
    );
    for (const id of chapter.excerpts) {
      // Some topics inline the excerpt object in the chapter instead of an id.
      if (typeof id !== "string") {
        assert(isObject(id), `${name}: chapter ${chapter.id} excerpts`);
        continue;
      }
      assert(
        excerptIds.has(id),
        `${name}: chapter ${chapter.id} refers to unknown excerpt ${id}`,
      );
    }
  }

  const quiz = content.quiz ?? [];
  assert(isList(quiz), `${name}: quiz must be an array`);
  const placement = content.placement ?? [];
  assert(isList(placement), `${name}: placement must be an array`);
  const quizIds = new Set<unknown>();
  [...quiz, ...placement].forEach((question, index) => {
    const where = `${name}: quiz ${(isObject(question) ? question.id : undefined) ?? index}`;
    assert(isObject(question), `${where} must be an object`);
    text(question.id, `${where} id`);
    assert(!quizIds.has(question.id), `${where} is a duplicate id`);
    quizIds.add(question.id);
    text(question.question, `${where} question`);
    assert(
      isList(question.options) && question.options.length >= 2,
      `${where} needs at least two options`,
    );
    assert(
      isInteger(question.answer) &&
        question.answer >= 0 &&
        question.answer < question.options.length,
      `${where} answer is out of range`,
    );
    if (question.optionExplanations !== undefined)
      assert(
        isList(question.optionExplanations) &&
          question.optionExplanations.length === question.options.length,
        `${where} needs one explanation per option`,
      );
    else text(question.explanation, `${where} explanation`);
    if (question.chapter !== undefined)
      assert(
        chapterIds.has(question.chapter),
        `${where} refers to unknown chapter`,
      );
    refs(question.refs, where);
  });
  for (const [id, where] of found.quiz)
    assert(quizIds.has(id), `${where} refers to unknown quiz question ${id}`);

  // The terms a chapter uses; their definitions live in the site glossary.
  for (const chapter of chapters) {
    if (chapter.terms === undefined) continue;
    const where = `${name}: chapter ${chapter.id} terms`;
    assert(
      isList(chapter.terms) &&
        chapter.terms.every((term) => typeof term === "string" && term),
      `${where} must be a list of term names`,
    );
    assert(
      new Set(chapter.terms).size === chapter.terms.length,
      `${where} repeat a term`,
    );
  }
}

/** Every prediction of the topic with the id its records are kept under and its chapter. */
export function topicPredictions(content: {
  chapters: readonly { id: string; blocks: readonly TopicBlock[] }[];
  data?: Record<string, unknown>;
}): PredictionEntry[] {
  return content.chapters.flatMap((chapter) =>
    chapterPredictions(chapter, content.data).map((entry) => ({
      ...entry,
      chapter: chapter.id,
    })),
  );
}

/** Public base for a topic; content storage continues to use sites/<slug>. */
export function topicBasePath(site: { slug: string; group?: string }): string {
  return `/${site.group === "练习" ? "practice" : "sites"}/${site.slug}`;
}
