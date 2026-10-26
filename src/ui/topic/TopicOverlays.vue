<script setup lang="ts">
import { computed } from "vue";
import UiDialog from "../UiDialog.vue";
import CiteButton from "../CiteButton.vue";
import CitedSource from "../CitedSource.vue";
import TermDefinition from "../TermDefinition.vue";
import { useCitations } from "../citations";
import { useTopic } from "./context";
import { closeOverlay, overlay } from "./overlay";

/** The term card and source card opened from TopicTerm and TopicRefs, and the viewer of a cited original. */
const { content, glossary } = useTopic();
const citations = useCitations()!.citations;
const shown = (kind: "term" | "source" | "citation") =>
  computed({
    get: () => overlay.value?.kind === kind,
    set: (value: boolean) => {
      if (!value) closeOverlay();
    },
  });
const termCard = shown("term");
const card = shown("source");
const viewer = shown("citation");
const citation = computed(() => {
  const value = overlay.value;
  return value?.kind === "citation" ? citations[value.href] : undefined;
});
const term = computed(() => {
  const value = overlay.value;
  return value?.kind === "term" ? glossary[value.term] : undefined;
});
const source = computed(() => {
  const value = overlay.value;
  return value?.kind === "source"
    ? content.sources.find((item) => item.id === value.id)
    : undefined;
});
</script>

<template>
  <TermDefinition v-model:open="termCard" :term="term" />
  <UiDialog v-model:open="card" :title="source ? `来源 ${source.id}` : '证据'">
    <div class="prose">
      <template v-if="source">
        <h3>{{ source.title }}</h3>
        <p>
          {{ source.kind
          }}<template v-if="source.checked">
            · 核对日期 {{ source.checked }}</template
          >
        </p>
        <p>{{ source.note }}</p>
        <ul v-if="source.cite">
          <li v-for="href in source.cite" :key="href">
            <CiteButton :href="href" />
          </li>
        </ul>
        <p>
          <a
            v-if="source.url"
            :href="source.url"
            target="_blank"
            rel="noopener noreferrer"
            >打开原始来源</a
          >
          <RouterLink to="/sources" @click="closeOverlay"
            >全部来源与核对记录</RouterLink
          >
        </p>
      </template>
    </div>
  </UiDialog>
  <CitedSource v-model:open="viewer" :citation="citation" />
</template>
