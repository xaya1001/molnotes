<script setup lang="ts">
import { ref, watchEffect } from "vue";
import katex from "katex";
import "katex/dist/katex.min.css";

const props = defineProps<{ tex: string }>();
const element = ref<HTMLElement | null>(null);

watchEffect(() => {
  if (element.value)
    katex.render(props.tex, element.value, { throwOnError: true });
});
</script>

<template>
  <div ref="element" class="formula" :aria-label="tex"></div>
</template>

<style scoped>
.formula {
  margin-block: var(--space-4);
  overflow-x: auto;
  font-size: 1.1em;
}
</style>
