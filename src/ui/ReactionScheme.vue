<script setup lang="ts">
import { computed, ref, useId, watch } from "vue";
import { loadChemistry } from "./chemistry/rdkit.ts";
import { alignScheme } from "../../shared/reaction-chemistry.ts";
import {
  schemeRuns,
  type SynthesisRoute,
} from "../../shared/reaction-scheme.ts";
import SchemeArrow from "./SchemeArrow.vue";
import SchemeCompounds from "./SchemeCompounds.vue";
const props = defineProps<{ route: SynthesisRoute }>();
const index = ref(0),
  coordinates = ref<Record<string, string>>({}),
  warnings = ref<string[]>([]);
const explanation = useId();
const runs = computed(() => schemeRuns(props.route));
watch(
  () => props.route,
  async (route, _, cleanup) => {
    let active = true;
    cleanup(() => {
      active = false;
    });
    index.value = 0;
    coordinates.value = {};
    warnings.value = [];
    const toolkit = await loadChemistry();
    if (!active) return;
    const aligned = alignScheme(toolkit, route);
    coordinates.value = aligned.smiles;
    warnings.value = aligned.warnings;
  },
  { immediate: true },
);
</script>
<template>
  <section
    class="reaction-scheme"
    :aria-label="route.title"
    :data-alignment-warning="warnings.length ? warnings.join('\n') : undefined"
  >
    <div v-for="(run, r) in runs" :key="r" class="scheme-run">
      <SchemeCompounds :compounds="run.initial" :coordinates="coordinates" />
      <div
        v-for="item in run.steps"
        :key="item.index"
        class="scheme-step"
        :data-step="item.index"
      >
        <SchemeArrow
          :step="item.step"
          :retro="route.direction === 'retro'"
          :selected="index === item.index"
          :controls="explanation"
          @select="index = item.index"
        />
        <SchemeCompounds :compounds="item.after" :coordinates="coordinates" />
      </div>
    </div>
    <div
      :id="explanation"
      class="scheme-explanation"
      aria-live="polite"
      :data-selected-step="index"
    >
      <strong>{{ route.steps[index].title }}</strong>
      <p>{{ route.steps[index].explanation }}</p>
    </div>
  </section>
</template>
<style scoped>
.scheme-run {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-block: var(--space-5);
}
.scheme-step {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  max-width: 100%;
}
.scheme-step > :last-child {
  flex: 0 1 auto;
}
.scheme-step > :first-child {
  flex-shrink: 0;
}
.scheme-explanation {
  border-left: var(--space-1) solid var(--accent);
  padding: var(--space-3) var(--space-4);
  font: var(--text-base)/var(--leading-body) var(--font-sans);
}
.scheme-explanation p {
  margin: var(--space-2) 0 0;
}
@media (max-width: 640px) {
  .scheme-run,
  .scheme-step {
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: center;
    width: 100%;
  }
  .scheme-step {
    gap: var(--space-3);
  }
  .scheme-step > :first-child {
    flex-shrink: 1;
  }
}
</style>
