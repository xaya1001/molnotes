export interface GlossaryTerm {
  term: string;
  /** The English original or the full name. */
  full: string;
  definition: string;
  /** What the term is commonly confused with. */
  confusion: string;
}

/** A note or topic chapter that uses a term. */
export interface GlossaryUse {
  title: string;
  /** The note's directory or the chapter's topic. */
  context: string;
  path: string;
}

export interface GlossaryEntry extends GlossaryTerm {
  uses: GlossaryUse[];
}

export function validateGlossary(
  glossary: unknown,
  name?: string,
): GlossaryTerm[];
