<script setup lang="ts">
import { computed } from "vue";
import { useTopic } from "./context.ts";
import TopicRefs from "./TopicRefs.vue";

/**
 * One judgement question: choose once, read the explanation, go to its
 * chapter. The default slot sits between the question and its options, for a
 * structure or figure the question is about.
 */
const props = defineProps<{ id: string; diagnostic?: boolean }>();
const { content, records } = useTopic();
const question = computed(() => content.quizById(props.id));
const answers = computed(() =>
  props.diagnostic ? records.records.diagnostic : records.records.answers,
);
function answer(option: number) {
  if (answers.value[props.id] === undefined) answers.value[props.id] = option;
}
</script>

<template>
  <section
    class="callout"
    :aria-label="`${diagnostic ? '起点自测' : '判断练习'} ${question.id}`"
  >
    <h3>{{ question.question }}</h3>
    <slot />
    <div class="choices">
      <button
        v-for="(option, index) in question.options"
        :key="index"
        class="button"
        :aria-pressed="answers[id] === index"
        :disabled="answers[id] !== undefined"
        @click="answer(index)"
      >
        {{ option }}
      </button>
    </div>
    <div v-if="answers[id] !== undefined" role="status">
      <p>
        <strong
          >{{
            answers[id] === question.answer ? "判断正确" : "再核对一次"
          }}。</strong
        >{{ question.explanation
        }}<TopicRefs v-if="question.refs?.length" :ids="question.refs" />
      </p>
      <dl v-if="question.optionExplanations">
        <template v-for="(option, index) in question.options" :key="index">
          <dt>
            {{ option }}{{ index === question.answer ? "（符合证据）" : "" }}
          </dt>
          <dd>{{ question.optionExplanations[index] }}</dd>
        </template>
      </dl>
      <RouterLink :to="content.chapterPath(question.chapter)"
        >{{
          diagnostic && answers[id] === question.answer
            ? "可跳过或复习："
            : "建议阅读："
        }}{{ content.chapterById(question.chapter).title }}</RouterLink
      >
    </div>
  </section>
</template>

<style scoped>
dt {
  font-weight: 600;
  margin-top: var(--space-3);
}
dd {
  margin: var(--space-2) 0 0;
}
.choices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
