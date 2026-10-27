<script setup lang="ts">
import { evidenceSource } from "../evidence.ts";
import { useTopic } from "./context.ts";
import { openSource } from "./overlay.ts";

/** Source numbers after a sentence; each opens that source's card. */
const props = defineProps<{ ids: readonly (number | string)[] }>();
const { content } = useTopic();
for (const id of props.ids) evidenceSource(content.sources, id);
</script>

<template>
  <span class="refs">
    <button
      v-for="id in ids"
      :key="id"
      class="ref-button"
      type="button"
      :aria-label="`查看来源 ${id}`"
      @click="openSource(id)"
    >
      {{ id }}
    </button>
  </span>
</template>

<style scoped>
.refs {
  display: inline-flex;
  gap: 0.15em;
  margin-left: 0.2em;
  vertical-align: 0.3em;
}
.ref-button {
  padding: 0 0.3em;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--accent-soft);
  color: var(--accent);
  font: 500 0.68rem / 1.5 var(--font-sans);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.ref-button:hover {
  background: var(--accent);
  color: var(--surface);
}
</style>
