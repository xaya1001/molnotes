<script setup lang="ts">
import type { ExerciseProse } from "../../../shared/prose-format.ts";
import ChapterText from "./ChapterText.vue";
import { choiceIsCorrect } from "./exercise.ts";

const props = defineProps<{
  options: readonly string[];
  explanations: readonly string[];
  prose?: ExerciseProse;
  answer: number;
  alsoCorrect?: readonly number[];
  selected: number | undefined;
}>();
const correct = (index: number) => choiceIsCorrect(props, index);
</script>

<template>
  <ol class="option-explanations">
    <li
      v-for="(explanation, index) in explanations"
      :key="index"
      :data-correct="correct(index)"
      :data-chosen="selected === index"
    >
      <p>
        <ChapterText :parts="prose?.options?.[index] ?? [options[index]]" />
        <span v-if="correct(index)" class="option-mark">（正确项）</span>
        <span v-if="selected === index" class="option-mark">（你的选择）</span>
      </p>
      <p>
        <ChapterText
          :parts="prose?.optionExplanations?.[index] ?? [explanation]"
        />
      </p>
    </li>
  </ol>
</template>

<style scoped>
.option-explanations {
  padding-left: var(--space-5);
}
.option-explanations li {
  margin-block: var(--space-3);
}
.option-explanations p {
  margin-block: var(--space-1);
}
.option-mark {
  font-size: var(--text-sm);
  font-weight: 500;
}
.option-explanations [data-correct="true"] .option-mark {
  color: var(--success);
}
</style>
