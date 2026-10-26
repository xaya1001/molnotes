import type { TopicPrediction } from "../src/ui/topic/content";
import type { ProblemBlock } from "../src/ui/topic/blocks";
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

export function quizExplanation(question: {
  answer: number;
  explanation?: string;
  optionExplanations?: string[];
}): string;
