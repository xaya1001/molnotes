<script setup lang="ts">
defineProps<{ source?: string }>();
</script>
<template>
  <p v-if="source" class="exercise-source">{{ source }}</p>
</template>
<style scoped>
.exercise-source {
  margin-block: var(--space-2);
  color: var(--ink-muted);
  font: 400 var(--text-sm) / var(--leading-body) var(--font-sans);
  overflow-wrap: anywhere;
}
</style>
