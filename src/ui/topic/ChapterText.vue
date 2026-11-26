<script setup lang="ts">
import Formula from "../Formula.vue";
import SourceText from "./SourceText.vue";
import TopicRefs from "./TopicRefs.vue";
import TopicTerm from "./TopicTerm.vue";
import { inlinePieces, type ChapterPiece } from "./chapter-text.ts";
import type { ProsePart } from "../../../shared/prose-format.ts";

defineProps<{
  pieces?: ChapterPiece[] | null;
  parts?: ProsePart[];
  linkPatentText?: boolean;
}>();
</script>

<template>
  <template v-for="(piece, i) in parts ? inlinePieces(parts) : pieces" :key="i">
    <TopicTerm v-if="piece.kind === 'term'" :name="piece.name" />
    <TopicRefs v-else-if="piece.kind === 'refs'" :ids="piece.ids" />
    <Formula v-else-if="piece.kind === 'math'" :tex="piece.tex" inline />
    <p v-else-if="piece.kind === 'paragraph'">
      <ChapterText :pieces="piece.pieces" :link-patent-text="linkPatentText" />
    </p>
    <component
      :is="piece.ordered ? 'ol' : 'ul'"
      v-else-if="piece.kind === 'list'"
      :start="piece.start"
    >
      <li v-for="(item, j) in piece.items" :key="j">
        <ChapterText :pieces="item" :link-patent-text="linkPatentText" />
      </li>
    </component>
    <component
      v-else-if="piece.kind === 'styled'"
      :is="piece.style === 'chemical-name' ? 'span' : piece.style"
      :class="piece.style === 'chemical-name' ? 'chemical-name' : undefined"
      ><ChapterText :pieces="piece.pieces" :link-patent-text="linkPatentText"
    /></component>
    <SourceText v-else-if="linkPatentText" :text="piece.text" />
    <template v-else>{{ piece.text }}</template>
  </template>
</template>
