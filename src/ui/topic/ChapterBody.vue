<script setup lang="ts">
import { computed } from "vue";
import ReadingGuide from "../ReadingGuide.vue";
import SourceExcerpt from "../SourceExcerpt.vue";
import ChapterBlocks from "./ChapterBlocks.vue";
import ChapterRecords from "./ChapterRecords.vue";
import QuizQuestion from "./QuizQuestion.vue";
import ChapterSources from "./ChapterSources.vue";
import { useTopic } from "./context.ts";

/** Chapter blocks followed by questions, excerpts, reading and records; placed content is not repeated. */
const props = defineProps<{ id: string }>();
const { content } = useTopic();
const chapter = computed(() => content.chapterById(props.id));
const blocks = computed(() => chapter.value.blocks);
const predictions = computed(() =>
  content.predictions.filter((entry) => entry.chapter === props.id),
);
const placedQuestions = computed(
  () =>
    new Set(
      blocks.value.flatMap((block) =>
        block.type === "quiz" ? block.questions : [],
      ),
    ),
);
const questions = computed(() =>
  content.quiz.filter(
    (question) =>
      question.chapter === props.id && !placedQuestions.value.has(question.id),
  ),
);
const shownExcerpts = computed(
  () =>
    new Set([
      ...predictions.value.flatMap((entry) => [
        ...("excerpt" in entry.prediction && entry.prediction.excerpt
          ? [entry.prediction.excerpt]
          : []),
        ...("evidence" in entry.prediction
          ? (entry.prediction.evidence ?? [])
          : []),
      ]),
      ...blocks.value.flatMap((block) =>
        block.type === "excerpt" ? [block.excerpt] : [],
      ),
    ]),
);
const readingPlaced = computed(() =>
  blocks.value.some((block) => block.type === "reading"),
);
const excerpts = computed(() =>
  (chapter.value.excerpts ?? [])
    .map((item) =>
      typeof item === "string" ? content.excerptById(item) : item,
    )
    .filter((item) => !shownExcerpts.value.has(item.id)),
);
</script>

<template>
  <a v-if="chapter.note" class="chapter-note" :href="chapter.note.href">
    <span class="chapter-note-kind">对应笔记</span>
    <span class="chapter-note-title">{{ chapter.note.title }}</span>
    <span class="chapter-note-go">阅读 →</span>
  </a>
  <ChapterBlocks :chapter="id" :blocks="blocks" />
  <template v-if="questions.length">
    <h2>判断练习</h2>
    <QuizQuestion v-for="q in questions" :id="q.id" :key="q.id" />
  </template>
  <template v-if="excerpts.length">
    <h2>原文区</h2>
    <SourceExcerpt
      v-for="excerpt in excerpts"
      :key="excerpt.id"
      :excerpt="excerpt"
      :sources="content.sources"
    />
  </template>
  <ReadingGuide
    v-if="chapter.reading?.length && !readingPlaced"
    :items="chapter.reading"
    :sources="content.sources"
  />
  <ChapterRecords :id="id" />
  <ChapterSources :id="id" />
</template>

<style scoped>
.chapter-note {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  margin-top: var(--space-5);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius);
  background: var(--paper-deep);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--ink);
  text-decoration: none;
}
.chapter-note-kind {
  font-size: var(--text-xs);
  color: var(--ink-muted);
}
.chapter-note-go {
  margin-left: auto;
  color: var(--accent);
  white-space: nowrap;
}
.chapter-note:hover {
  background: var(--accent-soft);
}
</style>
