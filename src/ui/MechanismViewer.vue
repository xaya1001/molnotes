<script setup lang="ts">
import { ref } from "vue";
import MoleculeView from "./MoleculeView.vue";
import type { MechanismFrame } from "./chemistry/types.ts";
defineProps<{ frames: readonly MechanismFrame[] }>();
const index = ref(0);
</script>
<template>
  <section aria-label="分步机理">
    <MoleculeView :key="index" v-bind="frames[index]" />
    <p aria-live="polite">{{ frames[index].explanation }}</p>
    <div class="controls">
      <button class="button" :disabled="index === 0" @click="index--">
        上一帧</button
      ><span>{{ index + 1 }} / {{ frames.length }}</span
      ><button
        class="button"
        :disabled="index === frames.length - 1"
        @click="index++"
      >
        下一帧
      </button>
    </div>
  </section>
</template>
<style scoped>
.controls {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
</style>
