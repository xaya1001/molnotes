import type { NotesIndex, NotesSearchIndex } from "./notes-index.ts";

/** The terms a compiled note's HTML marks, in order of first use. */
export function noteTerms(html: string): string[] {
  const names = [...html.matchAll(/data-term="([^"]*)"/g)].map(([, name]) =>
    name
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&amp;", "&"),
  );
  return [...new Set(names)];
}

/** Search consumers never receive rendered HTML, structures or the glossary. */
export function notesSearchIndex(index: NotesIndex): NotesSearchIndex {
  return {
    directories: index.directories.map(({ title, summary, path }) => ({
      title,
      summary,
      path,
    })),
    notes: index.notes.map(
      ({ path, title, directoryTitle, summary, text }) => ({
        path,
        title,
        directoryTitle,
        summary,
        text,
      }),
    ),
  };
}
