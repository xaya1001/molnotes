// The content snapshot: `snapshot.json` as the content build writes it and
// the website reads it, next to the asset files under `files/`.
import type { Citation } from "../src/ui/citations.ts";
import type { TopicContent } from "../src/ui/topic/content.ts";
import type { GlossaryTerm } from "./glossary.ts";
import type { Note, NoteDirectory } from "./notes-index.ts";
import type { SiteManifest } from "./site-catalog.ts";
import type { SourceRegistry } from "./source-citations.ts";

export type Citations = Record<string, Citation>;

/** A topic's `site.json`. */
export interface SnapshotSite extends SiteManifest {
  label?: string;
}

/** A note directory's `directory.json`. */
export interface DirectoryMetadata {
  title: string;
  intro: string;
  order: number;
}

export interface SnapshotAsset {
  scope: string;
  path: string;
  sha256: string;
  size: number;
  content_type: string;
  /** The prompt a generated note image was made from; never sent to readers. */
  prompt: string | null;
}

export interface SnapshotTopic {
  slug: string;
  site: SnapshotSite;
  content: TopicContent;
  citations: Citations;
}

export interface SnapshotDirectory {
  dir: string;
  metadata: DirectoryMetadata;
  citations: Citations;
  compiled: NoteDirectory;
}

export interface SnapshotNote {
  dir: string;
  slug: string;
  /** Author material is compiled and checked but not listed for readers. */
  author: boolean;
  source: string;
  compiled: Note;
}

export interface Snapshot {
  format: 1;
  commit: string | null;
  builtAt: string;
  topics: SnapshotTopic[];
  directories: SnapshotDirectory[];
  notes: SnapshotNote[];
  glossary: GlossaryTerm[];
  registry: SourceRegistry | null;
  assets: SnapshotAsset[];
}
