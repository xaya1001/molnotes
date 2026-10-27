import type { Topic } from "./content.ts";
import type { TopicRecordsBase } from "../../contracts/records.ts";
import type { TopicPredictionRecords } from "./context.ts";
import { predictionMistaken } from "./prediction.ts";
import { topicProblems } from "./problem.ts";

export function chapterMistakes(
  content: Topic,
  saved: TopicRecordsBase & TopicPredictionRecords,
) {
  const count = new Map<string, number>();
  const add = (chapter: string) =>
    count.set(chapter, (count.get(chapter) ?? 0) + 1);
  for (const question of content.quiz)
    if (
      saved.answers[question.id] !== undefined &&
      saved.answers[question.id] !== question.answer
    )
      add(question.chapter);
  for (const { id, chapter, prediction } of content.predictions)
    if (
      prediction.kind !== "matrix" &&
      prediction.kind !== "quiz" &&
      predictionMistaken(prediction, saved.predictions[id])
    )
      add(chapter);
  for (const problem of topicProblems(content))
    if (saved.problems[problem.id]?.rating === "unknown") add(problem.chapter);
  return count;
}
