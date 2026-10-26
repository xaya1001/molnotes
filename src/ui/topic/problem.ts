import type { ProblemBlock, TopicBlock } from "./blocks";
import { isObject, type RecordField } from "../../contracts/records.ts";

export interface ProblemAnswer {
  response: string;
  rating?: "know" | "unknown";
}

export function topicProblems(content: {
  chapters: readonly { id: string; blocks: readonly TopicBlock[] }[];
}) {
  return content.chapters.flatMap((chapter) =>
    chapter.blocks
      .filter((block): block is ProblemBlock => block.type === "problem")
      .map((block) => ({ ...block, chapter: chapter.id })),
  );
}

export function problemField(
  problems: readonly { id: string }[],
): RecordField<Record<string, ProblemAnswer>> {
  const ids = new Set(problems.map((problem) => problem.id));
  return {
    empty: () => ({}),
    parse(value) {
      if (value === undefined) return {};
      if (!isObject(value)) throw new Error("开放题记录格式错误");
      const next: Record<string, ProblemAnswer> = {};
      for (const [id, entry] of Object.entries(value)) {
        if (
          !ids.has(id) ||
          !isObject(entry) ||
          Object.keys(entry).some(
            (key) => key !== "response" && key !== "rating",
          ) ||
          typeof entry.response !== "string" ||
          entry.response.length > 20000 ||
          (entry.rating !== undefined &&
            entry.rating !== "know" &&
            entry.rating !== "unknown")
        )
          throw new Error("开放题记录格式错误");
        if (entry.response || entry.rating !== undefined)
          next[id] = {
            response: entry.response,
            ...(entry.rating === undefined ? {} : { rating: entry.rating }),
          };
      }
      return next;
    },
  };
}
