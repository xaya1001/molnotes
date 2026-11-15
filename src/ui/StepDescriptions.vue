<script setup lang="ts">
defineProps<{
  items: { title: string; text: string; number?: number; block?: string }[];
  numbered?: boolean;
  columns?: boolean;
}>();
</script>
<template>
  <div class="step-descriptions-layout">
    <ol
      class="step-descriptions"
      :class="{
        'step-descriptions--columns': columns,
        'step-descriptions--numbered': numbered,
      }"
    >
      <li v-for="(item, index) in items" :key="index" class="step-description">
        <span
          v-if="numbered"
          class="step-number"
          :class="{ 'step-number--blocked': item.block }"
          >{{ item.number ?? index + 1 }}</span
        >
        <h4 v-if="item.title">{{ item.title }}</h4>
        <p v-if="item.text">{{ item.text }}</p>
      </li>
    </ol>
  </div>
</template>
<style scoped>
.step-descriptions-layout {
  container-type: inline-size;
}
.step-descriptions {
  display: grid;
  gap: var(--space-5) var(--space-4);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}
.step-description {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-1) var(--space-2);
  align-content: start;
  margin: 0;
}
.step-descriptions--numbered .step-description {
  grid-template-columns: var(--figure-step-size) minmax(0, 1fr);
}
.step-description h4 {
  margin: 0;
  color: var(--ink);
  font: 600 var(--text-sm)/1.7 var(--font-sans);
}
.step-description p {
  margin: 0;
  color: var(--ink-soft);
  font: var(--text-sm)/1.7 var(--font-sans);
}
.step-descriptions--numbered p {
  grid-column: 2;
}
.step-number {
  grid-row: 1 / 3;
}
@container (min-width: 600px) {
  .step-descriptions--columns {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
