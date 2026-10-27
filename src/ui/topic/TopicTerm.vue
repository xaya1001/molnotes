<script setup lang="ts">
import { useTopic } from "./context.ts";
import { openTerm } from "./overlay.ts";

/** A glossary term inside prose; opens its card without leaving the page. */
const props = defineProps<{ name: string }>();
const { glossary } = useTopic();
if (!Object.hasOwn(glossary, props.name))
  throw new Error(`Unknown glossary term: ${props.name}`);
</script>

<template>
  <button
    class="term"
    type="button"
    :aria-label="`术语：${name}`"
    @click="openTerm(name)"
  >
    {{ name }}
  </button>
</template>

<style scoped>
.term {
  display: inline;
  padding: 0;
  border: 0;
  border-bottom: 1px dotted var(--accent);
  background: none;
  color: inherit;
  font: inherit;
  cursor: help;
}
.term:hover {
  color: var(--accent);
}
</style>
