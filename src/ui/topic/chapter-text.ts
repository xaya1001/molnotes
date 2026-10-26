import type { TopicBlock } from "./blocks";

export type ChapterPiece =
  | { kind: "text"; text: string }
  | { kind: "refs"; ids: number[] }
  | { kind: "term"; name: string };

/** Keep the topic's declared IDs: string identifiers are not numeric citations. */
export const sourceIdsOf = (sources: readonly { id: number | string }[]) =>
  new Set(sources.map((source) => source.id));

// Source numbers never start with 0, so a patent paragraph such as [0418]
// stays text.
const REFS = /^\[[1-9]\d*(?:,[1-9]\d*)*\]$/;
const REFS_SPLIT = /(\[[1-9]\d*(?:,[1-9]\d*)*\])/;
const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Splits `text` at the first mention of each term not in `seen`, which gains the terms it finds. */
function linkTerms(
  text: string,
  terms: readonly string[],
  seen: Set<string>,
): ChapterPiece[] {
  const pieces: ChapterPiece[] = [];
  let rest = text;
  for (;;) {
    const pending = terms.filter((term) => !seen.has(term));
    if (!pending.length) break;
    const pattern = new RegExp(
      pending
        .map(escapeRegExp)
        .sort((a, b) => b.length - a.length)
        .join("|"),
    );
    const match = pattern.exec(rest);
    if (!match) break;
    if (match.index)
      pieces.push({ kind: "text", text: rest.slice(0, match.index) });
    pieces.push({ kind: "term", name: match[0] });
    seen.add(match[0]);
    rest = rest.slice(match.index + match[0].length);
  }
  if (rest) pieces.push({ kind: "text", text: rest });
  return pieces;
}

/**
 * One paragraph as pieces: `[5,7]` becomes source numbers (only numbers in
 * `sourceIds`, when given, so a patent paragraph such as [1325] stays text),
 * and the first mention of each term not yet in `seen`
 * becomes a term piece.
 */
export function paragraphPieces(
  paragraph: string,
  terms: readonly string[],
  seen: Set<string>,
  sourceIds?: ReadonlySet<number | string>,
): ChapterPiece[] {
  return paragraph.split(REFS_SPLIT).flatMap((part): ChapterPiece[] => {
    if (REFS.test(part)) {
      const ids = part.slice(1, -1).split(",").map(Number);
      if (!sourceIds || ids.every((id) => sourceIds.has(id)))
        return [{ kind: "refs", ids }];
      return [{ kind: "text", text: part }];
    }
    return linkTerms(part, terms, seen);
  });
}

/**
 * The prose blocks of a chapter as pieces, one entry per block (`null` for a
 * block without prose). Source numbers split out everywhere; the first
 * mention of each term, counted across the chapter, becomes a term piece.
 */
export function blockPieces(
  blocks: readonly TopicBlock[],
  terms: readonly string[],
  sourceIds?: ReadonlySet<number | string>,
): (ChapterPiece[] | null)[] {
  const seen = new Set<string>();
  return blocks.map((block) =>
    block.type === "paragraph" || block.type === "callout"
      ? paragraphPieces(block.text, terms, seen, sourceIds)
      : null,
  );
}
