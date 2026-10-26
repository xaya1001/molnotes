<script setup lang="ts">
import { computed, ref, watch } from "vue";
import ReactionStep from "./ReactionStep.vue";
import type { SynthesisRoute } from "./chemistry/types";
const props = defineProps<{ routes: readonly SynthesisRoute[] }>();
const routeIndex = ref(0),
  index = ref(0);
const route = computed(() => props.routes[routeIndex.value]);
watch(route, () => {
  index.value = 0;
});
</script>
<template>
  <section aria-label="分步合成路线">
    <div class="controls">
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
    <div class="controls">
      <button
        v-for="(step, i) in route.steps"
        :key="i"
        class="button"
        :aria-pressed="index === i"
        @click="index = i"
      >
        {{ i + 1 }} · {{ step.title }}
      </button>
    </div>
    <div aria-live="polite"><ReactionStep :step="route.steps[index]" /></div>
    <div class="controls">
      <button class="button" :disabled="index === 0" @click="index--">
        上一步</button
      ><span>{{ index + 1 }} / {{ route.steps.length }}</span
      ><button
        class="button"
        :disabled="index === route.steps.length - 1"
        @click="index++"
      >
        下一步
      </button>
    </div>
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
