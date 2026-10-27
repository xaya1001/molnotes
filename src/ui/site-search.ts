import {
  entries,
  notesIndex,
  terms as glossary,
  topics,
} from "./content-data.ts";

/** A piece of result text; `hit` pieces match a search word. */
export interface Fragment {
  text: string;
  hit: boolean;
}

export interface ChapterResult {
  topic: string;
  number: number;
  title: string;
  path: string;
  excerpt: Fragment[];
}

export interface TermResult {
  term: string;
  full: string;
  path: string;
  excerpt: Fragment[];
}

export interface SearchGroup<T> {
  items: T[];
  total: number;
}

const LIMIT = 20;

/** Chapters by `<slug>/<chapter id>`, built once the site index has loaded. */
let chapterMap: Map<
  string,
  { topic: string } & (typeof topics)[number]["chapters"][number]
>;
function chapters() {
  chapterMap ??= new Map(
    topics.flatMap((topic) =>
      topic.chapters.map((chapter) => [
        `${topic.slug}/${chapter.id}`,
        { topic: topic.title, ...chapter },
      ]),
    ),
  );
  return chapterMap;
}

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** About 120 characters of `text` around the first hit, hits marked. */
function excerpt(text: string, words: string[]): Fragment[] {
  const pattern = new RegExp(words.map(escape).join("|"), "giu");
  const first = text.search(pattern);
  const start = first > 30 ? first - 30 : 0;
  const end = Math.min(text.length, start + 120);
  const shown = text.slice(start, end);
  const fragments: Fragment[] = [];
  let at = 0;
  for (const match of shown.matchAll(pattern)) {
    if (match.index > at)
      fragments.push({ text: shown.slice(at, match.index), hit: false });
    fragments.push({ text: match[0], hit: true });
    at = match.index + match[0].length;
  }
  if (at < shown.length) fragments.push({ text: shown.slice(at), hit: false });
  if (start > 0) fragments.unshift({ text: "…", hit: false });
  if (end < text.length) fragments.push({ text: "…", hit: false });
  return fragments;
}

const includesAll = (text: string, words: string[]) => {
  const lower = text.toLowerCase();
  return words.every((word) => lower.includes(word));
};

const includesAny = (text: string, words: string[]) => {
  const lower = text.toLowerCase();
  return words.some((word) => lower.includes(word));
};

/**
 * Chapters of every topic and site glossary terms containing all the
 * whitespace-separated words of `query`, ignoring case; chapters whose title
 * matches come first.
 */
export function searchSite(query: string): {
  chapters: SearchGroup<ChapterResult>;
  terms: SearchGroup<TermResult>;
} {
  const words = query.trim().toLowerCase().split(/\s+/);
  const titled: ChapterResult[] = [];
  const untitled: ChapterResult[] = [];
  const terms: TermResult[] = [];
  for (const entry of entries) {
    const chapter = chapters().get(`${entry.slug}/${entry.chapterId}`);
    if (!chapter || !includesAll(`${chapter.title} ${entry.text}`, words))
      continue;
    (includesAny(chapter.title, words) ? titled : untitled).push({
      topic: chapter.topic,
      number: chapter.number,
      title: chapter.title,
      path: chapter.path,
      excerpt: excerpt(entry.text, words),
    });
  }
  for (const entry of glossary)
    if (includesAll(`${entry.term} ${entry.full} ${entry.definition}`, words))
      terms.push({
        term: entry.term,
        full: entry.full,
        path: `/glossary/#${encodeURIComponent(entry.term)}`,
        excerpt: excerpt(entry.definition, words),
      });
  const found = [...titled, ...untitled];
  return {
    chapters: { items: found.slice(0, LIMIT), total: found.length },
    terms: { items: terms.slice(0, LIMIT), total: terms.length },
  };
}

/** Notes whose title or text contains `query`, ignoring case. */
export function searchNotes(query: string) {
  const q = query.trim().toLocaleLowerCase();
  return q
    ? notesIndex.notes.filter((note) =>
        `${note.title} ${note.text}`.toLocaleLowerCase().includes(q),
      )
    : [];
}
export function snippet(text: string, query: string) {
  const q = query.trim();
  const at = text.toLocaleLowerCase().indexOf(q.toLocaleLowerCase());
  if (!q || at < 0) return [];
  const start = Math.max(0, at - 25),
    end = Math.min(text.length, at + q.length + 75);
  return [
    { text: (start ? "…" : "") + text.slice(start, at), hit: false },
    { text: text.slice(at, at + q.length), hit: true },
    {
      text: text.slice(at + q.length, end) + (end < text.length ? "…" : ""),
      hit: false,
    },
  ];
}
