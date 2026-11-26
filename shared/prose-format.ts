export type ProsePart =
  | string
  | { style: "chemical-name" | "em" | "strong"; parts: ProsePart[] }
  | { style: "math"; tex: string };

export type ProseBlock =
  | { type: "paragraph"; parts: ProsePart[] }
  | { type: "list"; ordered: boolean; start?: number; items: ProseBlock[][] };

export interface ExerciseProse {
  question?: ProsePart[];
  options?: (ProsePart[] | null)[];
  explanation?: ProsePart[];
  optionExplanations?: (ProsePart[] | null)[];
}

export interface ProblemProse {
  prompt?: ProseBlock[];
  parts?: (ProseBlock[] | null)[];
  answer?: ProseBlock[];
}

/** Even entries are plain text, odd entries are explicit emphasis. */
export function captionParts(text: string) {
  return text.split(
    /(?<![\\*A-Za-z0-9\p{Script=Greek}])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?!\*)/u,
  );
}
