import type { TopicIndex } from "../../shared/topic-index.ts";
import type {
  NotebookIndex,
  NotesSearchIndex,
} from "../../shared/notes-index.ts";
import type { GlossaryTerm } from "../../shared/glossary.ts";
import { api } from "./api.ts";
import {
  directories,
  groups,
  sites,
  type CatalogDirectory,
  type CatalogSite,
} from "./catalog.ts";
export const topics: TopicIndex["chapters"] = [];
export const quiz: TopicIndex["quiz"] = [];
export const entries: TopicIndex["search"] = [];
export const terms: GlossaryTerm[] = [];
export const notesIndex: NotesSearchIndex = { directories: [], notes: [] };
export const notebook: NotebookIndex = {
  directories: [],
  notes: [],
};
let index: Promise<void> | undefined;
/** The site index behind progress and search, fetched once per page; a failed load can be retried. */
export function loadIndex() {
  index ??= api<
    TopicIndex & { terms: GlossaryTerm[]; notesSearch: NotesSearchIndex }
  >("/api/index").then(
    (value) => {
      topics.splice(0, topics.length, ...value.chapters);
      quiz.splice(0, quiz.length, ...value.quiz);
      entries.splice(0, entries.length, ...value.search);
      terms.splice(0, terms.length, ...value.terms);
      Object.assign(notesIndex, value.notesSearch);
    },
    (error) => {
      index = undefined;
      throw error;
    },
  );
  return index;
}
export async function loadCatalog() {
  const catalog = await api<{
    groups: string[];
    sites: CatalogSite[];
    directories: CatalogDirectory[];
  }>("/api/catalog");
  sites.splice(0, sites.length, ...catalog.sites);
  groups.splice(0, groups.length, ...catalog.groups);
  directories.splice(0, directories.length, ...catalog.directories);
}
export async function loadContent(notebookPage = false) {
  await Promise.all([
    loadCatalog(),
    api<NotebookIndex>("/api/notes").then((value) =>
      Object.assign(notebook, value),
    ),
    notebookPage
      ? Promise.resolve()
      : api<Pick<TopicIndex, "chapters" | "quiz">>("/api/review").then(
          (value) => {
            topics.splice(0, topics.length, ...value.chapters);
            quiz.splice(0, quiz.length, ...value.quiz);
          },
        ),
  ]);
}
