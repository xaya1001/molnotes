<script setup lang="ts">
import { computed } from "vue";
import PredictionMatrix from "../matrix/PredictionMatrix.vue";
import type { MatrixBlock } from "./blocks.ts";
import { useTopic } from "./context.ts";
import TopicRefs from "./TopicRefs.vue";

/**
 * A `matrix` block: the reader guesses every required cell, each answer opens
 * that cell's evidence, and the whole grid opens once all are answered. The
 * answers live in `records.matrices[id].cells`.
 */
const props = defineProps<{ block: MatrixBlock; id: string }>();
const { content, records } = useTopic();
const entry = content.exercises.find((item) => item.id === props.id);
if (!entry || entry.exercise.type !== "matrix")
  throw new Error(`No matrix ${props.id}`);
const model = entry.exercise.model;
const answers = computed(() => records.records.matrices[props.id]?.cells ?? {});
function answer(cell: string, choice: number) {
  records.records.matrices[props.id] = {
    cells: { ...answers.value, [cell]: choice },
  };
}
function reset(cell: string) {
  const { [cell]: _, ...rest } = answers.value;
  if (Object.keys(rest).length)
    records.records.matrices[props.id] = { cells: rest };
  else delete records.records.matrices[props.id];
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
