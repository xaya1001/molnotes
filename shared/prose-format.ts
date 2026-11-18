export type ProsePart =
  string | { style: "chemical-name" | "em"; parts: ProsePart[] };

/** Even entries are plain text, odd entries are explicit emphasis. */
export function captionParts(text: string) {
  return text.split(
    /(?<![\\*A-Za-z0-9\p{Script=Greek}])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?!\*)/u,
  );
}
