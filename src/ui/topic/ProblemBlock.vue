<script setup lang="ts">
import ExerciseSource from "./ExerciseSource.vue";
import { computed, ref } from "vue";
import type { ProblemBlock } from "./blocks.ts";
import { useTopic } from "./context.ts";
import ProblemText from "./ProblemText.vue";
import SourceExcerpt from "../SourceExcerpt.vue";
const props = defineProps<{ block: ProblemBlock; chapter: string }>();
const { records, content } = useTopic();
const saved = computed(() => records.records.problems[props.block.id]);
const response = computed({
  get: () => saved.value?.response ?? "",
  set: (response: string) => {
    if (!response && !saved.value?.rating)
      delete records.records.problems[props.block.id];
    else
      records.records.problems[props.block.id] = { ...saved.value, response };
  },
});
const revealed = ref(false);
function rate(rating: "know" | "unknown") {
  records.records.problems[props.block.id] = {
    response: response.value,
    rating,
  };
}
</script>
<template>
  <section
    class="problem"
    :lang="block.lang"
    :data-testid="`problem-${block.id}`"
  >
    <p v-if="block.task" class="caption">{{ block.task }}</p>
    <header v-if="block.label" class="problem-meta">
      <strong v-if="block.label">{{ block.label }}</strong>
    </header>
    <ExerciseSource :source="block.source" />
    <ProblemText v-if="block.prompt" :text="block.prompt" :chapter="chapter" />
    <ol v-if="block.parts" type="a" class="problem-parts">
      <li v-for="(part, i) in block.parts" :key="i">
        <ProblemText :text="part" :chapter="chapter" />
      </li>
    </ol>
    <label class="problem-response"
      >我的答案
      <textarea
        v-model="response"
        rows="5"
        maxlength="20000"
        :disabled="!records.loaded.value"
      />
    </label>
    <button
      class="button"
      type="button"
      :aria-expanded="revealed"
      :aria-controls="`answer-${block.id}`"
      @click="revealed = !revealed"
    >
      {{ revealed ? "收起参考答案" : "看参考答案" }}
    </button>
    <div v-if="revealed" :id="`answer-${block.id}`" class="problem-answer">
      <p class="caption">
        {{ block.answer.origin === "book" ? "书内答案" : "AI 答案" }}
      </p>
      <ProblemText :text="block.answer.text" :chapter="chapter" />
      <p class="caption">{{ block.answer.basis }}</p>
      <SourceExcerpt
        v-for="id in block.evidence ?? []"
        :key="id"
        :excerpt="content.excerptById(id)"
        :sources="content.sources"
      />
      <div class="problem-rating" role="group" aria-label="自评">
        <button
          v-for="rating in ['know', 'unknown'] as const"
          :key="rating"
          class="button"
          type="button"
          :aria-pressed="saved?.rating === rating"
          :disabled="!records.loaded.value"
          @click="rate(rating)"
        >
          {{ rating === "know" ? "会" : "不会" }}
        </button>
      </div>
    </div>
  </section>
</template>
<style scoped>
.problem {
  margin-block: var(--space-6);
  padding-block: var(--space-4);
  border-block: 1px solid var(--rule);
  overflow-wrap: anywhere;
  min-width: 0;
}
.problem:lang(en) {
  hyphens: auto;
  max-width: var(--measure);
}
.problem:lang(en) :deep(p) {
  margin-block: var(--space-4);
}
.problem-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  font-size: var(--text-sm);
  color: var(--ink-muted);
}
.problem-meta strong {
  color: var(--ink);
  font-weight: 500;
}
.problem-parts {
  padding-left: var(--space-6);
}
.problem-parts li {
  padding-left: var(--space-1);
}
.problem-response {
  display: grid;
  gap: var(--space-2);
  margin-block: var(--space-4);
  font-size: var(--text-sm);
}
textarea {
  box-sizing: border-box;
  width: 100%;
  resize: vertical;
  font: inherit;
  line-height: var(--leading-body);
  padding: var(--space-3);
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius-sm);
  color: var(--ink);
  background: var(--surface);
}
.problem-answer {
  margin-top: var(--space-4);
}
.problem-rating {
  display: flex;
  gap: var(--space-3);
}
[aria-pressed="true"] {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
</style>
