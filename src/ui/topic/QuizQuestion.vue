<script setup lang="ts">
import { computed } from "vue";
import ChapterText from "./ChapterText.vue";
import ChoiceOptions from "./ChoiceOptions.vue";
import ChoiceExplanations from "./ChoiceExplanations.vue";
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
    <h3>
      <ChapterText :parts="question.prose?.question ?? [question.question]" />
    </h3>
    <slot />
    <ChoiceOptions
      :id="id"
      :options="question.options"
      :prose="question.prose?.options"
      :selected="answers[id]"
      :disabled="answers[id] !== undefined"
      immediate
      @pick="answer"
    />
    <div v-if="answers[id] !== undefined" role="status">
      <p>
        <strong
          >{{
            answers[id] === question.answer ? "判断正确" : "再核对一次"
          }}。</strong
        ><ChapterText
          v-if="question.explanation"
          :parts="question.prose?.explanation ?? [question.explanation]"
        /><TopicRefs v-if="question.refs?.length" :ids="question.refs" />
      </p>
      <ChoiceExplanations
        v-if="question.optionExplanations"
        :options="question.options"
        :explanations="question.optionExplanations"
        :prose="question.prose"
        :answer="question.answer"
        :selected="answers[id]"
      />
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
