import type { PatentData } from "../../../shared/patent-contract.ts";
import type { ExerciseProse } from "../../../shared/prose-format.ts";
import {
  chapterRoutePath,
  resolveData,
  topicExercises,
  validateTopicContent,
} from "../../../shared/topic-content.ts";
import type { MoleculeData } from "../chemistry/types.ts";
import type { EvidenceSource, Excerpt, ReadingItem } from "../evidence.ts";
import { validateEvidence } from "../evidence.ts";
import type { MatrixModel } from "../matrix/model.ts";
import type { DataRef, TopicBlock } from "./blocks.ts";

interface ExerciseBase {
  question: string;
  prose?: ExerciseProse;
  id: string;
  /** The setting the reader needs before answering, shown under the question. */
  context?: string;
  source?: string;
  explanation: string;
  /** Structures drawn with the question. */
  molecules?: MoleculeData[];
  /** Excerpt shown with the result. */
  excerpt?: string;
  evidence?: string[];
  /** Offers 重新判断 on the result, which deletes the record and allows another attempt. */
  reset?: boolean;
}

/** The reader picks one option. */
export interface TextChoiceExercise extends ExerciseBase {
  type: "choice";
  kind?: never;
  options: string[];
  optionExplanations?: string[];
  answer: number;
  /** Other options that also count as right. */
  alsoCorrect?: number[];
}

/** The reader picks atoms or bonds on `molecule`. */
export interface SingleStructureExercise extends ExerciseBase {
  type: "structure";
  kind: "atoms" | "bonds";
  molecule: MoleculeData;
  answer: number[];
  /** Labels drawn on the structure once the result shows, by atom index. */
  labels?: Record<number, string>;
  /** How many picks to submit (default one); `exact` wants the whole answer set, `subset` any picks inside it. */
  minSelections?: number;
  maxSelections?: number;
  match?: "exact" | "subset";
}

/** The reader picks a set of atoms on each molecule; each set must match that molecule's `answer`. */
export interface AtomSetExercise extends ExerciseBase {
  type: "structure";
  kind: "atom-set";
  molecules: (MoleculeData & { answer: number[] })[];
  labels?: Record<number, string>;
  /** A choice submitted with the atoms; both must be right. */
  options?: string[];
  optionAnswer?: number;
  /** False: the atoms are recorded and shown beside the right ones but not graded. */
  gradeAtoms?: boolean;
  optionExplanations?: string[];
}

/** The reader picks one curved arrow on `molecule`: its source atom, then its target atom. */
export interface ArrowExercise extends ExerciseBase {
  type: "structure";
  kind: "arrows";
  molecule: MoleculeData;
  answer: { from: number; to: number };
  labels?: Record<number, string>;
  /** A choice submitted together with the arrow; both must be right. */
  options?: string[];
  optionAnswer?: number;
  optionExplanations?: string[];
}

/** The reader picks atoms and a design choice together; every `groups` entry must be hit and no other atom picked. */
export interface DesignExercise extends ExerciseBase {
  type: "structure";
  kind: "design";
  molecule: MoleculeData;
  groups: number[][];
  options: string[];
  answer: number;
  /** Why those atoms, shown beside the structure verdict. */
  atomExplanation?: string;
  labels?: Record<number, string>;
  optionExplanations?: string[];
}

/** The reader ranks every option; only the first place is graded against `answer`. */
export interface RankingExercise extends ExerciseBase {
  type: "ranking";
  kind?: never;
  options: string[];
  answer: number;
  optionExplanations?: string[];
}

/** The reader picks one marked point on a picture, optionally with a choice; both must be right. */
export interface ImageChoiceExercise extends ExerciseBase {
  type: "choice";
  kind: "image-points";
  image:
    | { src: string; alt: string }
    | import("../../../shared/chemical-library/types.ts").FigureReference;
  /** Marked positions as percentages of the picture's width and height. */
  points: { id: string; label: string; x: number; y: number }[];
  answer: string[];
  options?: string[];
  optionAnswer?: number;
  optionExplanations?: string[];
}

/** The reader types an estimate; `answer` ± `tolerance` grades it, `readout` runs a lab model on it. */
export interface NumberExercise extends ExerciseBase {
  type: "number";
  kind?: never;
  input: {
    label: string;
    unit?: string;
    min?: number;
    max?: number;
    step?: number;
  };
  answer?: number;
  tolerance?: number;
  readout?: { model: string; input: string };
}

export type TopicExercise =
  | TextChoiceExercise
  | SingleStructureExercise
  | AtomSetExercise
  | ArrowExercise
  | NumberExercise
  | DesignExercise
  | RankingExercise
  | ImageChoiceExercise;

/** A `matrix` block: answered once every required cell is. */
export interface MatrixGate {
  type: "matrix";
  kind?: never;
  model: MatrixModel;
}

/** A `quiz` block with an id: answered once every question has an answer; it keeps no record of its own. */
export interface QuizGate {
  type: "quiz";
  kind?: never;
  questions: string[];
  diagnostic: boolean;
}

/** What a reader answered to an exercise. */
export type ExerciseAnswer =
  | { option: number }
  | { selected: number[] }
  | { sets: number[][]; choice?: number }
  | { from: number; to: number; choice?: number }
  | { value: number }
  | { atoms: number[]; option: number }
  | { ranking: number[] }
  | { point: string; choice?: number };

export interface MatrixAnswer {
  cells: Record<string, number>;
}

/** A chapter exercise or a gate that checks its recorded answers. */
export interface ExerciseEntry {
  id: string;
  chapter: string;
  exercise: TopicExercise | MatrixGate | QuizGate;
}

export interface LearningPath {
  id: string;
  title: string;
  summary: string;
  chapters: string[];
}

export interface TopicChapter {
  id: string;
  /** Reader note resolved by the content build. */
  note?: { href: string; title: string };
  /** The chapter's content, in order; see `blocks.ts`. */
  blocks: TopicBlock[];
  /** The chapter's own route, overriding `chapterRoute` and the default; e.g. "/map" for a map chapter. */
  path?: string;
  number: number;
  title: string;
  short: string;
  minutes: number;
  lead: string;
  refs: (number | string)[];
  /** Excerpt ids, or the excerpt objects themselves. */
  excerpts?: (string | Excerpt)[];
  reading?: ReadingItem[];
  /** Wide chapters get the `page-wide` reading width. */
  layout?: "wide";
  /** Site glossary terms the chapter uses; their first mention in prose opens the definition. */
  terms?: string[];
}

export interface TopicQuizQuestion {
  id: string;
  question: string;
  options: string[];
  answer: number;
  /** Why the answer holds; a topic may instead explain every option. */
  explanation?: string;
  optionExplanations?: string[];
  chapter: string;
  refs?: (number | string)[];
  prose?: ExerciseProse;
}

export interface TopicSource extends EvidenceSource {
  kind: string;
  note: string;
  checked?: string;
  url?: string | null;
  /** Citations of the registered shelf source, each opening its original. */
  cite?: string[];
}

/** The shared core of a topic's content.json; topics add fields beside it. */
export interface TopicContent {
  /**
   * Chapter route pattern with `{id}` or `{number}`, such as
   * `/chapters/{number}`; without it the first chapter is the topic root and
   * the rest are `/<id>`.
   */
  chapterRoute?: string;
  parts: { title: string; summary?: string; chapters: string[] }[];
  chapters: TopicChapter[];
  /** Large block values by key (mechanism frames, route steps, table rows), named by blocks. */
  data?: Record<string, unknown> & PatentData;
  /** Excerpts shared by id; a topic may instead inline them in its chapters. */
  excerpts?: Excerpt[];
  /** The topic's reading route when it is not spread over the chapters. */
  reading?: ReadingItem[];
  quiz?: TopicQuizQuestion[];
  /** The entry self-test when its questions are not part of `quiz`. */
  placement?: TopicQuizQuestion[];
  sources: TopicSource[];
  /** Named chapter orders a reader can choose; the first is the default. */
  paths?: LearningPath[];
  /** How the sources page introduces the topic's sources and model boundaries. */
  sourcesIntro?: {
    title: string;
    paragraphs?: string[];
    blocks?: TopicBlock[];
  };
}

/** A chapter as `mountTopic` reads it after the shared contract has checked it. */
export type CheckedChapter = TopicChapter;

export interface CheckedContent extends TopicContent {
  chapters: CheckedChapter[];
}

export interface TopicLookups<Chapter, Quiz> {
  chapterById(id: string): Chapter;
  excerptById(id: string): Excerpt;
  quizById(id: string): Quiz;
  /** Route of a chapter inside the topic, from `chapterRoute` or the default. */
  chapterPath(id: string): string;
  /** Every exercise or answer gate, in chapter order. */
  exercises: ExerciseEntry[];
  /** A block field's value, or the `data` entry it names. */
  dataOf<T>(value: DataRef<T>): T;
}

export type Topic<Content extends TopicContent = TopicContent> = Content & {
  quiz: TopicQuizQuestion[];
} & TopicLookups<
    Content["chapters"][number],
    NonNullable<Content["quiz"]>[number]
  >;

export type CheckedTopic = Topic<CheckedContent>;

/**
 * Checks the shared contract of a topic's content.json (cross references
 * between chapters, blocks, excerpts, sources and quiz) and returns
 * it with the lookups every page needs. Topic-specific fields keep their
 * types.
 */
export function defineTopicContent<Content extends TopicContent>(
  content: Content,
): Topic<Content> {
  validateTopicContent(content);
  const quiz = content.quiz ?? [];
  const excerpts = content.excerpts ?? [];
  validateEvidence(content.sources, excerpts, content.reading ?? []);
  for (const chapter of content.chapters)
    validateEvidence(
      content.sources,
      (chapter.excerpts ?? []).filter(
        (item): item is Excerpt => typeof item !== "string",
      ),
      chapter.reading ?? [],
    );
  const chapterById = (id: string) => {
    const chapter = content.chapters.find((item) => item.id === id);
    if (!chapter) throw new Error(`Unknown chapter: ${id}`);
    return chapter;
  };
  const excerptById = (id: string) => {
    const excerpt = excerpts.find((item) => item.id === id);
    if (!excerpt) throw new Error(`Unknown excerpt: ${id}`);
    return excerpt;
  };
  const quizById = (id: string) => {
    const question = [...quiz, ...(content.placement ?? [])].find(
      (item) => item.id === id,
    );
    if (!question) throw new Error(`Unknown quiz question: ${id}`);
    return question;
  };
  const chapterPath = (id: string) =>
    chapterRoutePath(content, chapterById(id));
  const dataOf = <T>(value: DataRef<T>) =>
    resolveData(value, content.data, "block");
  return Object.assign(content, {
    quiz,
    chapterById,
    excerptById,
    quizById,
    chapterPath,
    exercises: topicExercises(content),
    dataOf,
  });
}
