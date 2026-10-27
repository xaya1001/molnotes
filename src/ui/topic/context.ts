import type { ProblemAnswer } from "./problem.ts";
import type { PatentRecords } from "./patent.ts";
import { inject, provide, type InjectionKey } from "vue";
import type { CheckedTopic, PredictionAnswer, Topic } from "./content.ts";
import type { TopicRecordsStore } from "./records.ts";
import type { GlossaryTerm } from "../../../shared/glossary.ts";

/** The record field every topic mounted by `mountTopic` keeps beside the shared ones. */
export interface TopicPredictionRecords extends PatentRecords {
  /** The reader's answer per prediction id. */
  predictions: Record<string, PredictionAnswer>;
  problems: Record<string, ProblemAnswer>;
  /** The chosen learning path id, when the topic has `paths`. */
  path?: string;
}

/** What the shared topic pages and components read; `mountTopic` provides it once. */
export interface TopicRuntime<
  E extends object = TopicPredictionRecords,
  C extends Topic = CheckedTopic,
> {
  slug: string;
  content: C;
  records: TopicRecordsStore<E>;
  /** Site glossary entries of the terms the chapters use, by name. */
  glossary: Record<string, GlossaryTerm>;
}

const key: InjectionKey<TopicRuntime<object, Topic>> = Symbol("topic-runtime");

export function provideTopic(runtime: TopicRuntime<object, Topic>) {
  provide(key, runtime);
}

/**
 * The topic's runtime; `E` names the topic's own record fields when a page
 * reads them. The runtime that provided it decides the fields, so the
 * injection is the one place the type is asserted.
 */
export function useTopic<
  E extends object = TopicPredictionRecords,
>(): TopicRuntime<E> {
  const runtime = inject(key, null);
  if (!runtime)
    throw new Error("useTopic() needs a topic mounted by mountTopic");
  return runtime as TopicRuntime<E>;
}
