import { noteTerms, notesSearchIndex } from "../scripts/notes-reading.mjs";
import { buildTopicIndex, buildReviewIndex } from "../scripts/topic-index.mjs";
import { siteGroups, sortSites } from "../scripts/site-catalog.mjs";
import { chapterRoutePath, topicBasePath } from "../scripts/topic-content.mjs";

// The reader functions below answer from one loaded content snapshot
// (`content-cache.mjs`).

/** The glossary entries a topic's chapters use, in glossary order. */
function topicGlossary(snapshot, content) {
  const used = new Set(content.chapters.flatMap((c) => c.terms ?? []));
  return snapshot.glossary.filter((t) => used.has(t.term));
}
/** Every term with the notes and topic chapters that use it, by term name. */
function glossaryEntries(glossary, notes, topics) {
  const uses = new Map(glossary.map((t) => [t.term, []]));
  for (const note of notes)
    for (const term of noteTerms(note.html))
      uses.get(term)?.push({
        title: note.title,
        context: note.directoryTitle,
        path: note.path,
      });
  for (const topic of topics)
    for (const chapter of topic.content.chapters)
      for (const term of chapter.terms ?? [])
        uses.get(term)?.push({
          title: chapter.title,
          context: topic.title,
          path: `${topicBasePath(topic)}${chapterRoutePath(topic.content, chapter)}`,
        });
  const collator = new Intl.Collator("zh-Hans-CN");
  return glossary
    .map((t) => ({ ...t, uses: uses.get(t.term) }))
    .sort((a, b) => collator.compare(a.term, b.term));
}
const readerNotes = (snapshot) => snapshot.notes.filter((n) => !n.author);
const topicSites = (snapshot) =>
  sortSites(
    snapshot.topics.map((t) => ({
      ...t.site,
      slug: t.slug,
      content: t.content,
    })),
  );
const omit = (value, keys) =>
  Object.fromEntries(Object.entries(value).filter(([k]) => !keys.includes(k)));

function notebookData(snapshot, metadata = false) {
  const directories = [...snapshot.directories]
    .sort(
      (a, b) =>
        a.metadata.order - b.metadata.order || a.dir.localeCompare(b.dir),
    )
    .map(({ compiled }) =>
      metadata ? omit(compiled, ["html", "citations", "intro"]) : compiled,
    );
  const notes = readerNotes(snapshot)
    .map(({ compiled }) =>
      metadata
        ? omit(compiled, [
            "html",
            "text",
            "sections",
            "molecules",
            "diagrams",
            "citations",
          ])
        : compiled,
    )
    .sort(
      (a, b) =>
        directories.findIndex((d) => d.slug === a.directory) -
          directories.findIndex((d) => d.slug === b.directory) ||
        a.order - b.order ||
        a.slug.localeCompare(b.slug),
    );
  return { directories, notes };
}
export function notebookIndex(snapshot) {
  return notebookData(snapshot, true);
}
export function reviewIndex(snapshot) {
  return buildReviewIndex(topicSites(snapshot));
}
export function contentIndex(snapshot) {
  return {
    ...buildTopicIndex(topicSites(snapshot)),
    terms: snapshot.glossary,
    notesSearch: notesSearchIndex(notebookData(snapshot)),
  };
}
export function glossaryIndex(snapshot) {
  return glossaryEntries(
    snapshot.glossary,
    readerNotes(snapshot).map((n) => n.compiled),
    snapshot.topics.map(({ slug, site, content }) => ({
      slug,
      title: site.title,
      group: site.group,
      content,
    })),
  );
}
function proseTerms(snapshot, html) {
  const used = new Set(noteTerms(html));
  return Object.fromEntries(
    snapshot.glossary.filter((t) => used.has(t.term)).map((t) => [t.term, t]),
  );
}

/**
 * Topic metadata in catalog order, the group order of the case directory, and
 * note directories with the practice topics their notes link to.
 */
export function contentCatalog(snapshot) {
  const sites = sortSites(
    snapshot.topics.map(({ slug, site, content }) => ({
      ...site,
      slug,
      chapterIds: content.chapters.map((chapter) => chapter.id),
      chapterPaths: Object.fromEntries(
        content.chapters.map((chapter) => [
          chapter.id,
          chapterRoutePath(content, chapter),
        ]),
      ),
    })),
  );
  const practice = sites.filter((site) => site.group === "练习");
  const linked = new Map();
  for (const { dir, compiled } of readerNotes(snapshot)) {
    const slugs = linked.get(dir) ?? new Set();
    for (const [, slug] of compiled.html.matchAll(
      /href="\/practice\/([a-z0-9-]+)\//g,
    ))
      slugs.add(slug);
    linked.set(dir, slugs);
  }
  return {
    groups: siteGroups,
    sites,
    directories: snapshot.directories
      .map(({ dir, metadata }) => ({
        title: metadata.title,
        order: metadata.order,
        slug: dir,
        path: `/notes/${dir}/`,
        practice: practice
          .filter((site) => linked.get(dir)?.has(site.slug))
          .map((site) => site.slug),
      }))
      .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug)),
  };
}

export function readTopic(snapshot, slug) {
  const topic = snapshot.topic(slug);
  return (
    topic && {
      ...topic.site,
      content: topic.content,
      citations: topic.citations,
      glossary: topicGlossary(snapshot, topic.content),
    }
  );
}

export function readNote(snapshot, directory, slug) {
  const compiled = slug
    ? snapshot.note(directory, slug)?.compiled
    : snapshot.directory(directory)?.compiled;
  return (
    compiled && { ...compiled, terms: proseTerms(snapshot, compiled.html) }
  );
}
