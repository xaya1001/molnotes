<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useTopicContext } from "./topic-context.ts";

const props = defineProps<{
  title: string;
  eyebrow?: string;
  summary?: string;
}>();

const heading = ref<HTMLElement | null>(null);
const topic = useTopicContext();

function show() {
  if (topic && heading.value) topic.showHeading(props.title, heading.value);
}
onMounted(show);
watch(() => props.title, show, { flush: "post" });
</script>

<template>
  <header class="page-heading">
    <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
    <h1 ref="heading" tabindex="-1">{{ title }}</h1>
    <div v-if="summary || $slots.default" class="page-heading-summary">
      <slot>{{ summary }}</slot>
    </div>
  </header>
</template>

<style scoped>
.page-heading {
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-5);
  border-bottom: 1px solid var(--rule);
}

h1 {
  margin: var(--space-2) 0 0;
  font-size: var(--text-3xl);
  font-weight: 600;
  line-height: var(--leading-tight);
  letter-spacing: 0.01em;
}

h1:focus {
  outline: none;
}

.page-heading-summary {
  margin-top: var(--space-3);
  color: var(--ink-soft);
  font-size: var(--text-lg);
  line-height: 1.7;
}
</style>
