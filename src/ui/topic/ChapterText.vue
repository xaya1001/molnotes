<script setup lang="ts">
import SourceText from "./SourceText.vue";
import TopicRefs from "./TopicRefs.vue";
import TopicTerm from "./TopicTerm.vue";
import type { ChapterPiece } from "./chapter-text.ts";

defineProps<{ pieces: ChapterPiece[] | null; linkPatentText?: boolean }>();
</script>

<template>
  <template v-for="(piece, i) in pieces" :key="i">
    <TopicTerm v-if="piece.kind === 'term'" :name="piece.name" />
    <TopicRefs v-else-if="piece.kind === 'refs'" :ids="piece.ids" />
    <component
      v-else-if="piece.kind === 'styled'"
      :is="piece.style === 'em' ? 'em' : 'span'"
      :class="piece.style === 'chemical-name' ? 'chemical-name' : undefined"
      ><ChapterText :pieces="piece.pieces" :link-patent-text="linkPatentText"
    /></component>
    <SourceText v-else-if="linkPatentText" :text="piece.text" />
    <template v-else>{{ piece.text }}</template>
  </template>
</template>
