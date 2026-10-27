import { catalogSite, topicBase } from "../catalog.ts";
import { problemField, topicProblems } from "./problem.ts";
import { patentRecordFields } from "./patent-records.ts";
import { defineComponent, h } from "vue";
import { mountApp } from "../app.ts";
import { defineTopicContent, type CheckedContent } from "./content.ts";
import { provideTopic, type TopicPredictionRecords } from "./context.ts";
import { pathField, predictionField } from "./prediction.ts";
import { createTopicRecords } from "./records.ts";
import type { RecordFields } from "../../contracts/records.ts";
import { defineTopicRoutes } from "./routes.ts";
import TopicApp from "./TopicApp.vue";
import { openCitation } from "./overlay.ts";
import { provideCitations, type Citation } from "../citations.ts";
import type { GlossaryTerm } from "../../../shared/glossary.ts";

export interface TopicOptions {
  slug: string;
  /** The topic's content.json; checked against the shared contract when the topic mounts. */
  content: object;
  /** Directory label of the chapters when the topic has one part. */
  label?: string;
  /** The topic's resolved citations by href. */
  citations: Record<string, Citation>;
  /** Site glossary entries of the terms the chapters use. */
  glossary: GlossaryTerm[];
}

/**
 * Mounts a topic under its catalog section from its content.json: it validates
 * the content, opens the browser records, builds the directory and routes,
 * and provides the runtime that `useTopic()` and the shared pages read.
 */
export async function mountTopic(options: TopicOptions) {
  const { slug } = options;
  // validateTopicContent (inside defineTopicContent) is the check behind this type.
  const content = defineTopicContent(options.content as CheckedContent);
  const extras = {
    ...patentRecordFields(content),
    problems: problemField(topicProblems(content)),
    predictions: predictionField(content.predictions),
    ...(content.paths ? { path: pathField(content.paths) } : {}),
  } as RecordFields<TopicPredictionRecords>;
  const records = createTopicRecords<TopicPredictionRecords>({
    slug,
    chapterIds: content.chapters.map((chapter) => chapter.id),
    quiz: content.quiz,
    diagnostic: content.placement ?? content.quiz,
    extras,
  });
  await records.ready;
  const { groups, routes } = defineTopicRoutes({
    content,
    label: options.label,
  });
  const glossary = Object.fromEntries(
    options.glossary.map((entry) => [entry.term, entry]),
  );
  const runtime = { slug, content, records, glossary };
  const root = defineComponent({
    name: "TopicRoot",
    setup() {
      provideTopic(runtime);
      provideCitations({ citations: options.citations, open: openCitation });
      return () => h(TopicApp, { groups });
    },
  });
  mountApp(root, { base: topicBase(catalogSite(slug)), routes });
}
