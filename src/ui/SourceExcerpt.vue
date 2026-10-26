<script setup lang="ts">
import { computed } from "vue";
import UiFigure from "./UiFigure.vue";
import CiteButton from "./CiteButton.vue";
import {
  evidenceSource,
  validateEvidence,
  type EvidenceSource,
  type Excerpt,
} from "./evidence";
const props = defineProps<{
  excerpt: Excerpt;
  sources: readonly EvidenceSource[];
}>();
const source = computed(() => {
  validateEvidence(props.sources, [props.excerpt], []);
  return evidenceSource(props.sources, props.excerpt.source);
});
</script>
<template>
  <section
    :id="excerpt.id"
    class="callout callout--evidence"
    aria-label="原文摘录"
  >
    <h3>{{ source.title }}</h3>
    <p class="locator">
      <CiteButton
        v-if="excerpt.cite"
        :href="excerpt.cite"
        :label="excerpt.locator"
      /><template v-else>{{ excerpt.locator }}</template>
    </p>
    <blockquote v-if="excerpt.text">{{ excerpt.text }}</blockquote>
    <UiFigure
      v-if="excerpt.image"
      :src="excerpt.image"
      :alt="`${source.title}，${excerpt.locator}原页`"
      :caption="`${source.title} · ${excerpt.locator}`"
    />
    <p>{{ excerpt.guide }}</p>
  </section>
</template>
<style scoped>
.locator {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--ink-muted);
}
</style>
