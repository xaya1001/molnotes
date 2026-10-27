<script setup lang="ts">
import { computed } from "vue";
import PageHeading from "../PageHeading.vue";
import SidebarGroup from "../SidebarGroup.vue";
import ChapterBlocks from "./ChapterBlocks.vue";
import { catalogSite } from "../catalog.ts";
import { useTopic } from "./context.ts";
import { chapterMistakes } from "./navigation.ts";
const { slug, content, records } = useTopic();
const site = catalogSite(slug);
const mistakes = computed(() => chapterMistakes(content, records.records));
const items = computed(() =>
  content.chapters.map((chapter) => ({
    to: content.chapterPath(chapter.id),
    label: chapter.title,
    read: records.records.complete.includes(chapter.id),
    bookmarked: records.records.bookmarks.includes(chapter.id),
    mistakes: mistakes.value.get(chapter.id),
  })),
);
const nav = {
  current: undefined,
  shows: () => true,
  showsGroup: () => true,
  picked() {},
};
</script>
<template>
  <article class="page-reading">
    <PageHeading :title="site.title" :summary="site.description" />
    <nav aria-label="全部章节">
      <SidebarGroup :group="{ items }" :nav="nav" />
    </nav>
    <div v-if="content.sourcesIntro" class="prose">
      <h2>{{ content.sourcesIntro.title }}</h2>
      <p
        v-for="paragraph in content.sourcesIntro.paragraphs ?? []"
        :key="paragraph"
      >
        {{ paragraph }}
      </p>
      <ChapterBlocks
        v-if="content.sourcesIntro.blocks"
        chapter="sources"
        :blocks="content.sourcesIntro.blocks"
      />
    </div>
  </article>
</template>
