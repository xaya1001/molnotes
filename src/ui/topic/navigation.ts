import type { Topic } from "./content.ts";
import type { TopicRecordsBase } from "../../contracts/records.ts";
import type { TopicExerciseRecords } from "./context.ts";
import { answerOf, exerciseMistaken } from "./exercise.ts";
import { topicProblems } from "./problem.ts";

export function chapterMistakes(
  content: Topic,
  saved: TopicRecordsBase & TopicExerciseRecords,
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
  for (const { chapter, exercise } of content.exercises)
    if (
      exercise.type !== "matrix" &&
      exercise.type !== "quiz" &&
      exerciseMistaken(exercise, answerOf(exercise, saved))
    )
      add(chapter);
  for (const problem of topicProblems(content))
    if (saved.problems[problem.id]?.rating === "unknown") add(problem.chapter);
  return count;
}
