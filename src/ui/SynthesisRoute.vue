<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ReactionScheme from "./ReactionScheme.vue";
import type { SynthesisRoute } from "../../shared/reaction-scheme.ts";
const props = defineProps<{ routes: readonly SynthesisRoute[] }>();
const routeIndex = ref(0);
watch(
  () => props.routes,
  () => {
    routeIndex.value = 0;
  },
);
const route = computed(() => props.routes[routeIndex.value]);
</script>
<template>
  <section aria-label="合成方案">
    <div v-if="routes.length > 1" class="controls">
      <button
        v-for="(r, i) in routes"
        :key="r.id"
        class="button"
        :aria-pressed="routeIndex === i"
        @click="routeIndex = i"
      >
        {{ r.title }}
      </button>
    </div>
    <ReactionScheme :route="route" />
  </section>
</template>
<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-block: var(--space-4);
}
</style>
