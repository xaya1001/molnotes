export interface EvidenceSource {
  id: number | string;
  title: string;
}
export interface Excerpt {
  id: string;
  source: number | string;
  locator: string;
  text?: string;
  image?: string;
  guide: string;
  /** Opens the original from the locator. */
  cite?: string;
}
export interface ReadingItem {
  source: number | string;
  locator: string;
  minutes: number;
  question: string;
  skip: string;
  /** Opens the original from the locator. */
  cite?: string;
}
export function evidenceSource(
  sources: readonly EvidenceSource[],
  id: number | string,
) {
  const source = sources.find((source) => source.id === id);
  if (!source) throw new Error(`Unknown source: ${id}`);
  return source;
}
export function validateEvidence(
  sources: readonly EvidenceSource[],
  excerpts: readonly Excerpt[],
  reading: readonly ReadingItem[],
) {
  for (const item of [...excerpts, ...reading])
    evidenceSource(sources, item.source);
  for (const item of excerpts)
    if (!item.text && !item.image)
      throw new Error(`Excerpt has no text or image: ${item.id}`);
}
