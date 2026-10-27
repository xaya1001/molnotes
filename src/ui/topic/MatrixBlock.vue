<script setup lang="ts">
import { computed } from "vue";
import PredictionMatrix from "../matrix/PredictionMatrix.vue";
import type { MatrixBlock } from "./blocks.ts";
import { useTopic } from "./context.ts";
import TopicRefs from "./TopicRefs.vue";

/**
 * A `matrix` block: the reader guesses every required cell, each answer opens
 * that cell's evidence, and the whole grid opens once all are answered. The
 * answers live in `records.predictions[id].cells`.
 */
const props = defineProps<{ block: MatrixBlock; id: string }>();
const { content, records } = useTopic();
const entry = content.predictions.find((item) => item.id === props.id);
if (!entry || entry.prediction.kind !== "matrix")
  throw new Error(`No matrix prediction ${props.id}`);
const model = entry.prediction.model;
const answers = computed(() => {
  const saved = records.records.predictions[props.id];
  return saved && "cells" in saved ? saved.cells : {};
});
function answer(cell: string, choice: number) {
  records.records.predictions[props.id] = {
    cells: { ...answers.value, [cell]: choice },
  };
}
function reset(cell: string) {
  const { [cell]: _, ...rest } = answers.value;
  if (Object.keys(rest).length)
    records.records.predictions[props.id] = { cells: rest };
  else delete records.records.predictions[props.id];
}
</script>

<template>
  <PredictionMatrix
    :model="model"
    :answers="answers"
    :question="block.question"
    :label="block.label"
    :caption="block.caption"
    :row-header="block.rowHeader"
    :heading="block.heading"
    :instruction="block.instruction"
    :quote-lang="block.quoteLang"
    @answer="answer"
    @reset="reset"
  >
    <template #source="{ id: source }"><TopicRefs :ids="[source]" /></template>
  </PredictionMatrix>
</template>
