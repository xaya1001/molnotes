export function validateTopicContent<T>(content: T, name?: string): T;
export function chapterRoutePath(
  content: { chapterRoute?: string; chapters: readonly { id: string }[] },
  chapter: { id: string; number?: number; path?: string },
): string;
/** The predictions of a chapter with the ids their records are kept under; a matrix block becomes `{ kind: "matrix", model }`. */
export function chapterPredictions<P>(
  chapter: { id: string; blocks: readonly { type: string; id?: string }[] },
  data?: Record<string, unknown>,
): { id: string; prediction: P }[];
export function topicPredictions<P>(content: {
  chapters: readonly {
    id: string;
    blocks: readonly { type: string; id?: string }[];
  }[];
}): { id: string; chapter: string; prediction: P }[];
export function blockSearchText(
  blocks: readonly { type: string }[],
  data?: Record<string, unknown>,
): string[];
/** `value` itself, or the entry of `data` it names. */
export function resolveData<T>(
  value: T | string,
  data: Record<string, unknown> | undefined,
  where: string,
): T;

export function topicBasePath(site: { slug: string; group?: string }): string;
