import type { TopicPrediction } from "../src/ui/topic/content.ts";
import type { ProblemBlock } from "../src/ui/topic/blocks.ts";
import { topicProblems } from "../src/ui/topic/problem.ts";
import {
  blockSearchText,
  chapterRoutePath,
  topicBasePath,
  validateTopicContent,
  topicPredictions,
} from "./topic-content.ts";

export interface IndexedTopic {
  slug: string;
  title: string;
  chapters: { id: string; number: number; title: string; path: string }[];
  /** Correct option per review question id. */
  answerKey: Record<string, number>;
  predictions: { id: string; chapter: string; prediction: TopicPrediction }[];
  problems: (ProblemBlock & { chapter: string })[];
}

export interface IndexedQuestion {
  slug: string;
  id: string;
  question: string;
  options: string[];
  answer: number;
  explanation: string;
  chapter: string;
}

export interface ChapterSearchEntry {
  slug: string;
  chapterId: string;
  text: string;
}

export interface TopicIndex {
  chapters: IndexedTopic[];
  quiz: IndexedQuestion[];
  search: ChapterSearchEntry[];
}

/** Searchable text of a chapter: its lead and the prose of its blocks. */
function chapterSearchText(chapter: any, content: any) {
  return [chapter.lead, ...blockSearchText(chapter.blocks, content.data)]
    .filter((part) => typeof part === "string" && part)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The explanation a review shows: `explanation`, else the correct option's. */
export function quizExplanation(question: {
  answer: number;
  explanation?: string;
  optionExplanations?: string[];
}): string {
  // Validated content has an explanation or one per option.
  return question.explanation ?? question.optionExplanations![question.answer];
}

interface TopicSite {
  slug: string;
  title: string;
  group?: string;
  content: any;
}

export function buildReviewIndex(
  topics: TopicSite[],
): Omit<TopicIndex, "search"> {
  const chapters: IndexedTopic[] = [];
  const quiz: IndexedQuestion[] = [];
  for (const site of topics) {
    const content = validateTopicContent(
      site.content,
      `sites/${site.slug}/content.json`,
    );
    chapters.push({
      slug: site.slug,
      title: site.title,
      chapters: content.chapters.map((chapter: any) => ({
        id: chapter.id,
        number: chapter.number,
        title: chapter.title,
        path: `${topicBasePath(site)}${chapterRoutePath(content, chapter)}`,
      })),
      predictions: topicPredictions<
        TopicPrediction | { kind: "matrix" | "quiz" }
      >(content).filter(
        (entry): entry is IndexedTopic["predictions"][number] =>
          entry.prediction.kind !== "matrix" &&
          entry.prediction.kind !== "quiz",
      ),
      problems: topicProblems(content),
      answerKey: Object.fromEntries(
        (content.quiz ?? []).map((question: any) => [
          question.id,
          question.answer,
        ]),
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

export function buildTopicIndex(topics: TopicSite[]): TopicIndex {
  return {
    ...buildReviewIndex(topics),
    search: topics.flatMap((site) =>
      site.content.chapters.map((chapter: any) => ({
        slug: site.slug,
        chapterId: chapter.id,
        text: chapterSearchText(chapter, site.content),
      })),
    ),
  };
}
