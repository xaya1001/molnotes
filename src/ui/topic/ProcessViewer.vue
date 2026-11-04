<script setup lang="ts">
import { computed, ref } from "vue";
import { formatAmount, type ProcessData } from "../../../shared/process.ts";
import StepPlayer from "../StepPlayer.vue";
import ProcessDiagram from "./ProcessDiagram.vue";
import ProcessBudget from "./ProcessBudget.vue";
import { processLosses } from "./process-state.ts";
const props = defineProps<{ data: ProcessData }>();
const scenarioIndex = ref(0);
const steps = computed(() => props.data.scenarios[scenarioIndex.value].steps);
function remaining(index: number) {
  return (
    props.data.total!.amount -
    processLosses(steps.value, index, 1).reduce(
      (sum, loss) => sum + loss.amount!,
      0,
    )
  );
}
</script>
<template>
  <StepPlayer :label="data.title" :title="data.title" :steps="steps">
    <template #head>
      <div
        v-if="data.scenarios.length > 1"
        class="seg"
        role="group"
        aria-label="场景"
      >
        <button
          v-for="(scenario, i) in data.scenarios"
          :key="i"
          type="button"
          :aria-pressed="i === scenarioIndex"
          @click="scenarioIndex = i"
        >
          {{ scenario.name }}
        </button>
      </div>
    </template>
    <template #default="{ index, progress, reduced }">
      <ProcessDiagram
        :data="data"
        :steps="steps"
        :index="index"
        :progress="progress"
        :reduced="reduced"
      />
    </template>
    <template #trace-head>
      <th class="destination" scope="col">去向</th>
      <th v-if="data.total" scope="col">剩余</th>
    </template>
    <template #trace-row="{ index }">
      <td class="destination">
        {{ data.nodes[steps[index].from].name
        }}{{
          steps[index].kind === "local"
            ? " · 内部"
            : steps[index].kind === "exit"
              ? ` → ${steps[index].loss!.label}`
              : ` → ${data.nodes[steps[index].to].name}`
        }}
      </td>
      <td v-if="data.total" class="quantity">
        {{ formatAmount(remaining(index)) }} {{ data.total.unit }}
      </td>
    </template>
    <template #summary="{ index, progress }">
      <ProcessBudget
        v-if="data.total"
        :data="data"
        :steps="steps"
        :index="index"
        :progress="progress"
      />
    </template>
  </StepPlayer>
</template>
<style scoped>
.seg {
  display: inline-flex;
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius);
  overflow: hidden;
}
.seg button {
  font: 500 var(--text-sm) var(--font-sans);
  border: 0;
  padding: var(--space-1) var(--space-3);
  background: transparent;
  color: var(--ink-soft);
  cursor: pointer;
}
.seg button + button {
  border-left: 1px solid var(--rule-strong);
}
.seg button[aria-pressed="true"] {
  background: var(--accent);
  color: var(--surface);
}
th,
td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--rule);
  color: var(--ink-soft);
}
th {
  font: 500 var(--text-xs) var(--font-sans);
  color: var(--ink-muted);
  text-align: left;
}
.quantity {
  font-family: var(--font-mono);
  white-space: nowrap;
}
:deep(.current) td {
  background: var(--accent-soft);
  color: var(--ink);
}
:deep(.future) td {
  color: var(--ink-muted);
  opacity: 0.6;
}
@media (max-width: 560px) {
  .destination {
    display: none;
  }
}
</style>
