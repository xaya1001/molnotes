import type { Citation } from "../src/ui/citations";
import type { GlossaryTerm } from "./glossary.mjs";
import type { Flow } from "../src/ui/diagrams/flow";
import type { Timeline } from "../src/ui/diagrams/model";
export interface NoteSection {
  id: string;
  title: string;
  level: number;
}
export interface NoteMolecules {
  id: string;
  molecules: { smiles: string; caption: string }[];
}
export type NoteDiagram =
  | { id: string; kind: "timeline"; timeline: Timeline; caption: string }
  | { id: string; kind: "flow"; flow: Flow; caption: string };
export interface Note {
  slug: string;
  directory: string;
  directoryTitle: string;
  path: string;
  title: string;
  summary: string;
  date: string;
  updated?: string;
  order: number;
  html: string;
  text: string;
  sections: NoteSection[];
  molecules: NoteMolecules[];
  /** Absent until the note is published again. */
  diagrams?: NoteDiagram[];
  /** Resolved citations by href (absent until the note is published again). */
  citations?: Record<string, Citation>;
}
export interface NoteDirectory {
  slug: string;
  title: string;
  intro: string;
  html: string;
  summary: string;
  order: number;
  path: string;
  citations?: Record<string, Citation>;
}
export interface NotesIndex {
  directories: NoteDirectory[];
  notes: Note[];
  terms: Record<string, GlossaryTerm>;
}

export interface NotebookIndex {
  directories: Omit<NoteDirectory, "html" | "citations" | "intro">[];
  notes: Omit<
    Note,
    "html" | "text" | "sections" | "molecules" | "diagrams" | "citations"
  >[];
}

export interface NotesSearchIndex {
  directories: Pick<NoteDirectory, "title" | "summary" | "path">[];
  notes: Pick<Note, "path" | "title" | "directoryTitle" | "summary" | "text">[];
}
