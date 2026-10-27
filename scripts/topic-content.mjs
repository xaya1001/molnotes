import { validatePatentData } from "./patent-contract.mjs";
import { contentCitations, parseCitation } from "./source-citations.mjs";
// The part of a topic's content.json every topic shares. Topics add their own
// fields beside these; this check only covers the common core and the cross
// references between its parts, and it runs during publication
// (content build) and when a topic module loads (defineTopicContent).
import {
  chapterPredictions,
  validateBlocks,
  validateStaticBlocks,
} from "./topic-blocks.mjs";

export {
  blockSearchText,
  chapterPredictions,
  resolveData,
} from "./topic-blocks.mjs";

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function text(value, where) {
  assert(typeof value === "string" && value.trim(), `${where} must be text`);
}

const routePlaceholder = /\{(\w+)\}/g;

/**
 * Route of a chapter inside its topic. A chapter's own `path` wins;
 * otherwise `chapterRoute` (for example `/chapters/{number}`) names it from
 * the chapter's `{id}` or `{number}`; without it chapters use `/<id>`. The root is the topic home.
 */
export function chapterRoutePath(content, chapter) {
  if (chapter.path !== undefined) return chapter.path;
  if (content.chapterRoute === undefined) return `/${chapter.id}`;
  return content.chapterRoute.replace(routePlaceholder, (_, name) =>
    String(chapter[name]),
  );
}

/** Throws on the first contract violation; returns the content unchanged. */
export function validateTopicContent(content, name = "content.json") {
  assert(isObject(content), `${name} must be an object`);
  assert(Array.isArray(content.chapters), `${name}: chapters must be an array`);
  if (content.data !== undefined)
    assert(isObject(content.data), `${name}: data must be an object`);
  validatePatentData(content, name);
  const chapterIds = new Set();
  // Cross references the blocks and predictions make, checked once the
  // excerpts and quiz are known.
  const found = {
    excerpts: [],
    quiz: [],
    predictionIds: new Set(),
    pathPicker: false,
  };
  for (const chapter of content.chapters) {
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
    validateBlocks(chapter, content.data, where, found);
  }

  // Learning paths: named chapter orders a reader can choose; the first is
  // the default. Previous and next follow the chosen path.
  if (content.paths !== undefined) {
    assert(
      Array.isArray(content.paths) && content.paths.length > 0,
      `${name}: paths must be a non-empty array`,
    );
    const pathIds = new Set();
    for (const path of content.paths) {
      assert(isObject(path), `${name}: each path must be an object`);
      text(path.id, `${name}: path id`);
      assert(!pathIds.has(path.id), `${name}: duplicate path ${path.id}`);
      pathIds.add(path.id);
      text(path.title, `${name}: path ${path.id} title`);
      text(path.summary, `${name}: path ${path.id} summary`);
      assert(
        Array.isArray(path.chapters) &&
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

  if (content.chapterRoute !== undefined) {
    const route = content.chapterRoute;
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
      for (const chapter of content.chapters)
        assert(
          Number.isInteger(chapter.number),
          `${name}: chapter ${chapter.id} needs a number for chapterRoute`,
        );
    const paths = new Set(
      content.chapters.map((chapter) => chapterRoutePath(content, chapter)),
    );
    assert(
      !paths.has("/") && paths.size === content.chapters.length,
      `${name}: chapterRoute gives two chapters the same path`,
    );
  }
  {
    const paths = new Set(
      content.chapters.map((chapter) => chapterRoutePath(content, chapter)),
    );
    assert(
      !paths.has("/") && paths.size === content.chapters.length,
      `${name}: chapter paths must be unique and cannot be /`,
    );
  }

  const sourceIds = new Set();
  const sources = content.sources ?? [];
  assert(Array.isArray(sources), `${name}: sources must be an array`);
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
      throw new Error(`${where}: ${error.message}`);
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
        Array.isArray(intro.paragraphs) &&
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
  const refs = (ids, where) => {
    if (ids === undefined) return;
    assert(Array.isArray(ids), `${where} refs must be an array`);
    for (const id of ids)
      assert(sourceIds.has(id), `${where} refers to unknown source ${id}`);
  };
  for (const chapter of content.chapters) {
    assert(
      Array.isArray(chapter.refs),
      `${name}: chapter ${chapter.id} needs refs`,
    );
    refs(chapter.refs, `${name}: chapter ${chapter.id}`);
  }

  const excerptIds = new Set();
  const excerpts = content.excerpts ?? [];
  assert(Array.isArray(excerpts), `${name}: excerpts must be an array`);
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
  for (const chapter of content.chapters) {
    if (chapter.excerpts === undefined) continue;
    assert(
      Array.isArray(chapter.excerpts),
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
  assert(Array.isArray(quiz), `${name}: quiz must be an array`);
  const placement = content.placement ?? [];
  assert(Array.isArray(placement), `${name}: placement must be an array`);
  const quizIds = new Set();
  [...quiz, ...placement].forEach((question, index) => {
    const where = `${name}: quiz ${question?.id ?? index}`;
    assert(isObject(question), `${where} must be an object`);
    text(question.id, `${where} id`);
    assert(!quizIds.has(question.id), `${where} is a duplicate id`);
    quizIds.add(question.id);
    text(question.question, `${where} question`);
    assert(
      Array.isArray(question.options) && question.options.length >= 2,
      `${where} needs at least two options`,
    );
    assert(
      Number.isInteger(question.answer) &&
        question.answer >= 0 &&
        question.answer < question.options.length,
      `${where} answer is out of range`,
    );
    if (question.optionExplanations !== undefined)
      assert(
        Array.isArray(question.optionExplanations) &&
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
  for (const chapter of content.chapters) {
    if (chapter.terms === undefined) continue;
    const where = `${name}: chapter ${chapter.id} terms`;
    assert(
      Array.isArray(chapter.terms) &&
        chapter.terms.every((term) => typeof term === "string" && term),
      `${where} must be a list of term names`,
    );
    assert(
      new Set(chapter.terms).size === chapter.terms.length,
      `${where} repeat a term`,
    );
  }
  return content;
}

/** Every prediction of the topic with the id its records are kept under and its chapter. */
export function topicPredictions(content) {
  return content.chapters.flatMap((chapter) =>
    chapterPredictions(chapter, content.data).map((entry) => ({
      ...entry,
      chapter: chapter.id,
    })),
  );
}

/** Public base for a topic; content storage continues to use sites/<slug>. */
export function topicBasePath(site) {
  return `/${site.group === "练习" ? "practice" : "sites"}/${site.slug}`;
}
