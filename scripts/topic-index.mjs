import { topicProblems } from "../src/ui/topic/problem.ts";
import {
  blockSearchText,
  chapterRoutePath,
  topicBasePath,
  validateTopicContent,
  topicPredictions,
} from "./topic-content.mjs";

/** Searchable text of a chapter: its lead and the prose of its blocks. */
function chapterSearchText(chapter, content) {
  return [chapter.lead, ...blockSearchText(chapter.blocks, content.data)]
    .filter((part) => typeof part === "string" && part)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The explanation a review shows: `explanation`, else the correct option's. */
export function quizExplanation(question) {
  return question.explanation ?? question.optionExplanations[question.answer];
}

export function buildReviewIndex(topics) {
  const chapters = [];
  const quiz = [];
  for (const site of topics) {
    const content = validateTopicContent(
      site.content,
      `sites/${site.slug}/content.json`,
    );
    chapters.push({
      slug: site.slug,
      title: site.title,
      chapters: content.chapters.map((chapter) => ({
        id: chapter.id,
        number: chapter.number,
        title: chapter.title,
        path: `${topicBasePath(site)}${chapterRoutePath(content, chapter)}`,
      })),
      predictions: topicPredictions(content).filter(
        (entry) =>
          entry.prediction.kind !== "matrix" &&
          entry.prediction.kind !== "quiz",
      ),
      problems: topicProblems(content),
      answerKey: Object.fromEntries(
        (content.quiz ?? []).map((question) => [question.id, question.answer]),
      ),
    });
    for (const question of content.quiz ?? [])
      quiz.push({
        slug: site.slug,
        id: question.id,
        question: question.question,
        options: question.options,
        answer: question.answer,
        explanation: quizExplanation(question),
        chapter: question.chapter,
      });
  }
  return { chapters, quiz };
}

export function buildTopicIndex(topics) {
  return {
    ...buildReviewIndex(topics),
    search: topics.flatMap((site) =>
      site.content.chapters.map((chapter) => ({
        slug: site.slug,
        chapterId: chapter.id,
        text: chapterSearchText(chapter, site.content),
      })),
    ),
  };
}
