<script setup lang="ts">
import { computed } from "vue";
import { phrases } from "./model";

const props = defineProps<{ text: string }>();
const lines = computed(() => phrases(props.text));
</script>

<template>
  <template v-for="(line, l) in lines" :key="l"
    ><br v-if="l" /><span
      v-for="(phrase, p) in line"
      :key="p"
      class="diagram-phrase"
      :class="{ 'diagram-phrase--spaced': phrase.endsWith(' ') }"
      >{{ phrase.trimEnd() }}</span
    ></template
  >
</template>

<style scoped>
/* A phrase moves to the next line whole; only a phrase wider than its box breaks inside. */
.diagram-phrase {
  display: inline-block;
  max-width: 100%;
  text-wrap: balance;
}
/* A space at a phrase's end would collapse inside its box; it becomes the gap. */
.diagram-phrase--spaced {
  margin-right: 0.25em;
}
</style>
