import { noteTerms, notesSearchIndex } from "../../shared/notes-reading.ts";
import { buildTopicIndex, buildReviewIndex } from "../../shared/topic-index.ts";
import { siteGroups, sortSites } from "../../shared/site-catalog.ts";
import { chapterRoutePath, topicBasePath } from "../../shared/topic-content.ts";
import type { GlossaryTerm, GlossaryUse } from "../../shared/glossary.ts";
import type { Note } from "../../shared/notes-index.ts";
import type { TopicContent } from "../../src/ui/topic/content.ts";
import type { LoadedSnapshot } from "./content-cache.ts";

// The reader functions below answer from one loaded content snapshot
// (`content-cache.ts`).

/** The glossary entries a topic's chapters use, in glossary order. */
function topicGlossary(snapshot: LoadedSnapshot, content: TopicContent) {
  const used = new Set(content.chapters.flatMap((c) => c.terms ?? []));
  return snapshot.glossary.filter((t) => used.has(t.term));
}
/** Every term with the notes and topic chapters that use it, by term name. */
function glossaryEntries(
  glossary: GlossaryTerm[],
  notes: Note[],
  topics: {
    slug: string;
    title: string;
    group?: string;
    content: TopicContent;
  }[],
) {
  const uses = new Map(glossary.map((t) => [t.term, [] as GlossaryUse[]]));
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
const readerNotes = (snapshot: LoadedSnapshot) =>
  snapshot.notes.filter((n) => !n.author);
const topicSites = (snapshot: LoadedSnapshot) =>
  sortSites(
    snapshot.topics.map((t) => ({
      ...t.site,
      slug: t.slug,
      content: t.content,
    })),
  );
const omit = <T extends object, K extends keyof T>(value: T, keys: K[]) =>
  Object.fromEntries(
    Object.entries(value).filter(([k]) => !keys.includes(k as K)),
  ) as Omit<T, K>;

function notebookData(snapshot: LoadedSnapshot) {
  const directories = [...snapshot.directories]
    .sort(
      (a, b) =>
        a.metadata.order - b.metadata.order || a.dir.localeCompare(b.dir),
    )
    .map(({ compiled }) => compiled);
  const notes = readerNotes(snapshot)
    .map(({ compiled }) => compiled)
    .sort(
      (a, b) =>
        directories.findIndex((d) => d.slug === a.directory) -
          directories.findIndex((d) => d.slug === b.directory) ||
        a.order - b.order ||
        a.slug.localeCompare(b.slug),
    );
  return { directories, notes };
}
export function notebookIndex(snapshot: LoadedSnapshot) {
  const { directories, notes } = notebookData(snapshot);
  return {
    directories: directories.map((directory) =>
      omit(directory, ["html", "citations", "intro"]),
    ),
    notes: notes.map((note) =>
      omit(note, [
        "html",
        "text",
        "sections",
        "molecules",
        "diagrams",
        "citations",
      ]),
    ),
  };
}
export function reviewIndex(snapshot: LoadedSnapshot) {
  return buildReviewIndex(topicSites(snapshot));
}
export function contentIndex(snapshot: LoadedSnapshot) {
  return {
    ...buildTopicIndex(topicSites(snapshot)),
    terms: snapshot.glossary,
    notesSearch: notesSearchIndex(notebookData(snapshot)),
  };
}
export function glossaryIndex(snapshot: LoadedSnapshot) {
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
function proseTerms(snapshot: LoadedSnapshot, html: string) {
  const used = new Set(noteTerms(html));
  return Object.fromEntries(
    snapshot.glossary.filter((t) => used.has(t.term)).map((t) => [t.term, t]),
  );
}

/**
 * Topic metadata in catalog order, the group order of the case directory, and
 * note directories with the practice topics their notes link to.
 */
export function contentCatalog(snapshot: LoadedSnapshot) {
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
  const linked = new Map<string, Set<string>>();
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

export function readTopic(snapshot: LoadedSnapshot, slug: string) {
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

export function readNote(
  snapshot: LoadedSnapshot,
  directory: string,
  slug?: string,
) {
  const compiled = slug
    ? snapshot.note(directory, slug)?.compiled
    : snapshot.directory(directory)?.compiled;
  return (
    compiled && { ...compiled, terms: proseTerms(snapshot, compiled.html) }
  );
}
