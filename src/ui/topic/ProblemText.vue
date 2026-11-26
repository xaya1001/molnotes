<script setup lang="ts">
import { computed } from "vue";
import type { ProseBlock } from "../../../shared/prose-format.ts";
import {
  inlinePieces,
  paragraphPieces,
  sourceIdsOf,
  type ChapterPiece,
} from "./chapter-text.ts";
import { useTopic } from "./context.ts";
import ChapterText from "./ChapterText.vue";
const props = defineProps<{
  text: string | string[];
  prose?: ProseBlock[] | null;
  chapter: string;
}>();
const { content } = useTopic();
const pieces = computed(() => {
  const seen = new Set<string>();
  const terms =
    content.chapters.find((c) => c.id === props.chapter)?.terms ?? [];
  const sources = sourceIdsOf(content.sources);
  const blocks: ProseBlock[] =
    props.prose ??
    (Array.isArray(props.text) ? props.text : [props.text]).map((text) => ({
      type: "paragraph",
      parts: [text],
    }));
  const render = (blocks: ProseBlock[]): ChapterPiece[] =>
    blocks.map((block) =>
      block.type === "list"
        ? {
            kind: "list",
            ordered: block.ordered,
            start: block.start,
            items: block.items.map(render),
          }
        : {
            kind: "paragraph",
            pieces: inlinePieces(block.parts, (text) =>
              paragraphPieces(text, terms, seen, sources),
            ),
          },
    );
  return render(blocks);
});
</script>
<template>
  <ChapterText :pieces="pieces" link-patent-text />
</template>
