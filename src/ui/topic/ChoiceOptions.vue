<script setup lang="ts">
import type { ExerciseProse } from "../../../shared/prose-format.ts";
import ChapterText from "./ChapterText.vue";

defineProps<{
  id: string;
  options: readonly string[];
  prose?: ExerciseProse["options"];
  selected: number | undefined;
  immediate?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ pick: [option: number] }>();
</script>

<template>
  <div v-if="immediate" class="choices">
    <button
      v-for="(option, index) in options"
      :key="index"
      class="button"
      type="button"
      :aria-pressed="selected === index"
      :disabled="disabled"
      @click="emit('pick', index)"
    >
      <ChapterText :parts="prose?.[index] ?? [option]" />
    </button>
  </div>
  <fieldset v-else :disabled="disabled">
    <legend>你的选择</legend>
    <label v-for="(option, index) in options" :key="index">
      <input
        type="radio"
        :name="id"
        :value="index"
        :checked="selected === index"
        @change="emit('pick', index)"
      />
      <ChapterText :parts="prose?.[index] ?? [option]" />
    </label>
  </fieldset>
</template>

<style scoped>
.choices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
fieldset {
  border: 1px solid var(--rule);
  padding: var(--space-4);
  margin-block: var(--space-4);
}
label {
  display: block;
  margin-block: var(--space-3);
  font-family: var(--font-sans);
}
</style>
