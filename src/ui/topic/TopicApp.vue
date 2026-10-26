<script setup lang="ts">
import SourceSearch from "./SourceSearch.vue";
import { patentBlocks } from "../../../scripts/patent-contract.mjs";
import RecordTray from "./RecordTray.vue";
import { computed, watch } from "vue";
import { useRoute } from "vue-router";
import TopicShell from "../TopicShell.vue";
import { catalogSite } from "../catalog";
import { topicSection } from "../site-sections";
import { flatItems, type NavGroup, type NavItem } from "../sidebar";
import { useTopic } from "./context";
import TopicOverlays from "./TopicOverlays.vue";
import { updateTopicSnapshot } from "../site-records";
import { chapterMistakes } from "./navigation";

/**
 * The default topic shell: the directory groups with each chapter's read
 * mark, bookmark and open mistakes (wrong quiz and prediction answers and
 * problems rated unknown), and, when the topic has learning paths and the
 * current chapter lies on the chosen one, previous and next along that path.
 */
const props = defineProps<{
  groups: NavGroup[];
}>();
const { slug, content, records } = useTopic();
const site = catalogSite(slug);
const hasPages = patentBlocks(content).some(
  (block) => block.type === "source-pages",
);
const route = useRoute();
const chapterByPath = new Map(
  content.chapters.map((chapter) => [content.chapterPath(chapter.id), chapter]),
);
const mistakes = computed(() => chapterMistakes(content, records.records));
watch(
  [() => route.path, () => records.loaded.value],
  ([path, loaded]) => {
    const chapter = chapterByPath.get(path);
    if (loaded && chapter) {
      records.records.recent = { chapter: chapter.id, opened: Date.now() };
      updateTopicSnapshot(slug, records.records);
    }
  },
  { immediate: true },
);
const mark = (item: NavItem): NavItem => {
  const chapter = chapterByPath.get(item.to);
  if (!chapter) return item;
  return {
    ...item,
    read: records.records.complete.includes(chapter.id),
    bookmarked: records.records.bookmarks.includes(chapter.id),
    mistakes: mistakes.value.get(chapter.id),
  };
};
const groups = computed(() =>
  props.groups.map((group) => ({ ...group, items: group.items.map(mark) })),
);
const items = computed(() => flatItems(groups.value));
const sequence = computed<NavItem[] | undefined>(() => {
  const chosen = content.paths?.find((p) => p.id === records.records.path);
  const current = chapterByPath.get(route.path);
  if (!chosen || !current || !chosen.chapters.includes(current.id))
    return undefined;
  const onPath = new Set(chosen.chapters.map((id) => content.chapterPath(id)));
  const chapterItems = chosen.chapters.map((id) =>
    items.value.find((item) => item.to === content.chapterPath(id))!,
  );
  // Non-chapter pages keep their place around the path's chapters.
  const first = items.value.findIndex((item) => chapterByPath.has(item.to));
  const last =
    items.value.length -
    1 -
    [...items.value].reverse().findIndex((item) => chapterByPath.has(item.to));
  return [
    ...items.value.slice(0, first).filter((item) => !onPath.has(item.to)),
    ...chapterItems,
    ...items.value.slice(last + 1),
  ];
});
</script>

<template>
  <TopicShell
    :title="site.title"
    :topic-slug="slug"
    :completed-chapters="
      records.loaded.value ? records.records.complete : undefined
    "
    :description="site.description"
    :groups="groups"
    :mistakes="[...mistakes.values()].reduce((sum, count) => sum + count, 0)"
    :sequence="sequence"
    :section="topicSection(site.group)"
  >
    <SourceSearch v-if="hasPages" />
    <p
      v-if="records.storageError.value"
      class="callout callout--caution"
      role="alert"
    >
      {{ records.storageError.value }}
      <button class="button" @click="records.retry()">
        {{ records.storageConflict.value ? "保留本页修改并保存" : "重试" }}
      </button>
    </p>
    <RouterView v-if="records.loaded.value" :key="$route.path" />
    <RecordTray v-if="records.loaded.value" />
    <TopicOverlays />
  </TopicShell>
</template>
