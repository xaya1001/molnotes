<script setup lang="ts">
import { computed } from "vue";
import {
  evidenceSource,
  type EvidenceSource,
  type ReadingItem,
} from "./evidence";
import CiteButton from "./CiteButton.vue";
const props = defineProps<{
  items: readonly ReadingItem[];
  sources: readonly EvidenceSource[];
}>();
const readings = computed(() =>
  props.items.map((item) => ({
    ...item,
    title: evidenceSource(props.sources, item.source).title,
  })),
);
</script>
<template>
  <section aria-label="教材学习指引">
    <h2>教材学习指引</h2>
    <article v-for="(item, index) in readings" :key="index" class="callout">
      <h3>{{ item.title }}</h3>
      <p>
        <CiteButton
          v-if="item.cite"
          :href="item.cite"
          :label="item.locator"
        /><template v-else>{{ item.locator }}</template> · 约
        {{ item.minutes }} 分钟
      </p>
      <p><strong>带着问题读：</strong>{{ item.question }}</p>
      <p><strong>可跳过：</strong>{{ item.skip }}</p>
    </article>
  </section>
</template>
