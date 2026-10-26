<script setup lang="ts">
import { computed } from "vue";
import { useTopic } from "./context";

/**
 * The entry self-test summed up: how many of its questions are answered, and
 * per chapter whether every question of that chapter was right (the chapter
 * can be skipped) or not (read it), with a link to the chapter. The
 * questions are `placement`, or `quiz` when the topic has no placement.
 */
defineProps<{ title?: string }>();
const { content, records } = useTopic();
const questions = computed(() => content.placement ?? content.quiz);
const answered = computed(
  () =>
    questions.value.filter(
      (q) => records.records.diagnostic[q.id] !== undefined,
    ).length,
);
const chapters = computed(() =>
  content.chapters
    .map((chapter) => {
      const own = questions.value.filter((q) => q.chapter === chapter.id);
      const done = own.every(
        (q) => records.records.diagnostic[q.id] !== undefined,
      );
      const right = own.every(
        (q) => records.records.diagnostic[q.id] === q.answer,
      );
      return { chapter, count: own.length, done, right };
    })
    .filter((item) => item.count > 0),
);
</script>

<template>
  <section aria-label="起点自测汇总">
    <h2 v-if="title">{{ title }}</h2>
    <p aria-live="polite">已答 {{ answered }} / {{ questions.length }} 题。</p>
    <ul>
      <li v-for="item in chapters" :key="item.chapter.id">
        <RouterLink :to="content.chapterPath(item.chapter.id)">{{
          item.chapter.title
        }}</RouterLink>
        ：{{ item.done && item.right ? "答对，可跳过" : "建议阅读" }}
      </li>
    </ul>
  </section>
</template>
