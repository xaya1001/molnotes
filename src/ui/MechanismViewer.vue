<script setup lang="ts">
import { computed } from "vue";
import StepPlayer from "./StepPlayer.vue";
import MoleculeView from "./MoleculeView.vue";
import type { MechanismFrame } from "./chemistry/types.ts";
const props = defineProps<{ frames: readonly MechanismFrame[] }>();
const steps = computed(() =>
  props.frames.map((frame) => ({
    title: frame.title,
    text: frame.explanation,
  })),
);
</script>
<template>
  <StepPlayer label="分步机理" :steps="steps">
    <template #default="{ index }"
      ><MoleculeView class="stage" :key="index" v-bind="frames[index]"
    /></template>
  </StepPlayer>
</template>

<style scoped>
.stage {
  padding: var(--space-3) var(--space-5);
}
</style>
