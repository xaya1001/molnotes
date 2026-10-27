<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { useTopic } from "./context.ts";
import { patentData } from "./patent.ts";
const { content, records } = useTopic(),
  route = useRoute();
const collections = patentData(content).collections ?? {};
const trays = computed(() =>
  Object.entries(records.records.pins).filter(
    ([key, ids]) =>
      ids.length && route.path !== `/${collections[key].route}/compare`,
  ),
);
</script>
<template>
  <aside
    v-for="[key, ids] in trays"
    :key="key"
    class="tray"
    :aria-label="`${collections[key].title}比较区`"
  >
    <span
      >{{ collections[key].title }} · {{ ids.length }} /
      {{ collections[key].pins!.max }}</span
    ><button
      v-for="id in ids"
      :key="id"
      class="button"
      :aria-label="`移除 ${id}`"
      @click="records.records.pins[key] = ids.filter((n) => n !== id)"
    >
      {{ id }} ×</button
    ><RouterLink
      :to="{
        path: `/${collections[key].route}/compare`,
        query: { ids: ids.join(',') },
      }"
      >并排比较 →</RouterLink
    >
  </aside>
</template>
<style scoped>
.tray {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--accent-soft);
  position: sticky;
  bottom: 0;
  z-index: 2;
}
</style>
