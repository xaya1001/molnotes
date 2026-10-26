<script setup lang="ts">
import PageHeading from "../PageHeading.vue";
import ChapterBody from "./ChapterBody.vue";

defineProps<{
  chapter: { id: string; title: string; summary: string; layout?: "wide" };
  /** Shown as 第 n 章; a chapter without a number (a map) has no eyebrow. */
  number?: number;
}>();
</script>

<template>
  <article :class="chapter.layout === 'wide' ? 'page-wide' : 'page-reading'">
    <PageHeading
      :eyebrow="number === undefined ? undefined : `第 ${number} 章`"
      :title="chapter.title"
      :summary="chapter.summary || undefined"
    />
    <div class="prose"><ChapterBody :id="chapter.id" /></div>
  </article>
</template>
