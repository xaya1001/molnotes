<script setup lang="ts">
import { computed } from "vue";
import {
  formatAmount,
  type ProcessData,
  type ProcessStep,
} from "../../../shared/process.ts";
import { processLosses } from "./process-state.ts";
const props = defineProps<{
  data: ProcessData;
  steps: ProcessStep[];
  index: number;
  progress: number;
}>();
const losses = computed(() =>
  processLosses(props.steps, props.index, props.progress),
);
const remaining = computed(
  () =>
    props.data.total!.amount -
    losses.value.reduce((sum, loss) => sum + loss.amount!, 0),
);
</script>
<template>
  <div v-if="data.total" class="budget">
    <div class="budget-label">
      <span
        >{{ data.total.label }}（{{ data.total.amount }}
        {{ data.total.unit }}）</span
      ><span>剩余 {{ formatAmount(remaining) }} {{ data.total.unit }}</span>
    </div>
    <div
      class="bar"
      role="img"
      :aria-label="`剩余 ${formatAmount(remaining)} ${data.total.unit}`"
    >
      <span
        class="remaining"
        :style="{ width: `${(remaining / data.total.amount) * 100}%` }"
      />
      <span
        v-for="(loss, i) in losses"
        :key="i"
        class="loss-segment"
        :style="{ width: `${(loss.amount! / data.total.amount) * 100}%` }"
        :title="`${loss.label} ${formatAmount(loss.amount!)} ${data.total.unit}`"
      />
    </div>
  </div>
</template>
<style scoped>
.budget {
  margin: 0 var(--space-5) var(--space-4);
}
.budget-label {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  font: 500 var(--text-xs) var(--font-sans);
  color: var(--ink-muted);
  margin-bottom: var(--space-1);
}
.bar {
  display: flex;
  height: 14px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--paper-deep);
}
.remaining {
  background: var(--accent);
}
.loss-segment {
  background: var(--danger);
  border-left: 1px solid var(--surface);
}
</style>
