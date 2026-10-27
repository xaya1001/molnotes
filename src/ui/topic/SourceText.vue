<script setup lang="ts">
import { computed } from "vue";
import { useTopic } from "./context.ts";
import { patentData, sourceLink } from "./patent.ts";
const props = defineProps<{ text: string; source?: string }>();
const data = patentData(useTopic().content);
const parts = computed(() =>
  props.text.split(/(\[\d+\])/).map((text) => {
    const match = /^\[(\d+)\]$/.exec(text),
      source = props.source ?? Object.keys(data.sources ?? {})[0],
      pages = data.sources?.[source]?.paragraphs;
    const page =
      match && (pages?.[match[1]] ?? pages?.[String(Number(match[1]))]);
    return { text, to: page ? sourceLink({ page }, source) : undefined };
  }),
);
</script>
<template>
  <span class="source-text"
    ><template v-for="(part, i) in parts" :key="i"
      ><RouterLink v-if="part.to" :to="part.to">{{ part.text }}</RouterLink
      ><template v-else>{{ part.text }}</template></template
    ></span
  >
</template>
<style scoped>
.source-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
