<script setup lang="ts">
import { computed } from "vue";
import { paragraphPieces, sourceIdsOf } from "./chapter-text";
import { useTopic } from "./context";
import SourceText from "./SourceText.vue";
import TopicRefs from "./TopicRefs.vue";
import TopicTerm from "./TopicTerm.vue";
const props = defineProps<{ text: string | string[]; chapter: string }>();
const { content } = useTopic();
const paragraphs = computed(() => {
  const seen = new Set<string>();
  const terms =
    content.chapters.find((c) => c.id === props.chapter)?.terms ?? [];
  return (Array.isArray(props.text) ? props.text : [props.text]).map((text) =>
    paragraphPieces(text, terms, seen, sourceIdsOf(content.sources)),
  );
});
</script>
<template>
  <p v-for="(paragraph, i) in paragraphs" :key="i">
    <template v-for="(piece, j) in paragraph" :key="j">
      <TopicTerm v-if="piece.kind === 'term'" :name="piece.name" />
      <TopicRefs v-else-if="piece.kind === 'refs'" :ids="piece.ids" />
      <SourceText v-else :text="piece.text" />
    </template>
  </p>
</template>
