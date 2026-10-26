<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import MoleculeView from "../MoleculeView.vue";
import MatrixCellEvidence from "./MatrixCellEvidence.vue";
import { matrixCellId, type MatrixModel } from "./model";

/**
 * Guess first, then look. The reader answers each cell in `model.required`
 * by picking one of `model.choices`; a submitted answer shows that cell's
 * evidence. Once every required cell is answered the whole grid opens, each
 * cell with its outcome, system, locator and quotes; a cell the source did not
 * measure says so. The component keeps no records: answers come in through
 * `answers` and go out as `answer` / `reset`, so the page decides where they
 * are stored. `part` splits the two stages for pages that put their own text
 * between them.
 */
const props = withDefaults(
  defineProps<{
    model: MatrixModel;
    /** Cell id to the position of the reader's pick in `model.choices`. */
    answers: Readonly<Record<string, number>>;
    /** The questions, the grid (shown once everything is answered), or both. */
    part?: "questions" | "matrix" | "both";
    /** Question for a required cell, with {row} and {column} filled in. */
    question: string;
    /** Heading above the questions. */
    heading?: string;
    /** One line under each question: how to answer, what the choices mean. */
    instruction?: string;
    /** Name of the grid for assistive technology. */
    label: string;
    /** Table caption: what the rows and columns are and what a cell claims. */
    caption: string;
    /** Header of the row labels. */
    rowHeader: string;
    /** Language of the evidence quotes, e.g. "en". */
    quoteLang?: string;
  }>(),
  { part: "both" },
);
const emit = defineEmits<{
  answer: [id: string, choice: number];
  reset: [id: string];
}>();

const draft = reactive<Record<string, number | null>>({});
const current = (id: string) => draft[id] ?? props.answers[id] ?? null;
const answered = (id: string) => props.answers[id] !== undefined;
const complete = computed(() => props.model.isComplete(props.answers));
const selected = ref<string | null>(null);

function questionText(id: string) {
  const cell = props.model.cellById(id);
  return props.question
    .replace("{row}", () => rowOf(cell.row).label)
    .replace("{column}", () => columnOf(cell.column).label);
}
const rowOf = (id: string) => props.model.rows.find((row) => row.id === id)!;
const columnOf = (id: string) =>
  props.model.columns.find((column) => column.id === id)!;
function choiceText(choice: string) {
  const outcome = props.model.outcomes.find((item) => item.id === choice)!;
  return outcome.choiceLabel ?? outcome.label;
}
function submit(id: string) {
  const pick = draft[id];
  if (pick === null || pick === undefined) return;
  emit("answer", id, pick);
  delete draft[id];
}
function again(id: string) {
  delete draft[id];
  emit("reset", id);
}
const counts = computed(() =>
  props.model.outcomes
    .map((outcome) => ({
      outcome,
      count: props.model.cells.filter((cell) => cell.outcome === outcome.id)
        .length,
    }))
    .filter((item) => item.count > 0),
);
function mark(id: string) {
  const pick = props.answers[id];
  if (!props.model.required.includes(id) || pick === undefined) return "";
  return props.model.isCorrect(id, pick) ? "你猜对" : "你猜错";
}
const detail = computed(() => {
  if (!selected.value) return undefined;
  const cell = props.model.cellById(selected.value);
  return {
    cell,
    row: rowOf(cell.row),
    column: columnOf(cell.column),
    outcome: props.model.outcomeOf(cell),
  };
});
</script>
<template>
  <template v-if="part !== 'matrix'">
    <h2 v-if="heading">{{ heading }}</h2>
    <section
      v-for="id in model.required"
      :key="id"
      class="exercise"
      :aria-label="questionText(id)"
      :data-testid="`matrix-${id}`"
    >
      <h3>{{ questionText(id) }}</h3>
      <p v-if="instruction" class="given">{{ instruction }}</p>
      <MoleculeView
        v-if="rowOf(model.cellById(id).row).smiles"
        :name="rowOf(model.cellById(id).row).label"
        :smiles="rowOf(model.cellById(id).row).smiles!"
      />
      <fieldset :disabled="answered(id)">
        <legend>先选择，再提交</legend>
        <label
          v-for="(choice, index) in model.choices"
          :key="choice"
          class="choice"
        >
          <input
            type="radio"
            :name="`matrix-${id}`"
            :value="index"
            :checked="current(id) === index"
            @change="draft[id] = index"
          />
          {{ choiceText(choice) }}
        </label>
      </fieldset>
      <button
        class="button button--primary"
        :disabled="answered(id) || current(id) === null"
        @click="submit(id)"
      >
        提交预测
      </button>
      <div v-if="answered(id)" role="status" class="callout callout--evidence">
        <p>
          <strong>{{
            model.isCorrect(id, answers[id]) ? "判断符合证据" : "再看证据"
          }}</strong>
          · 原文：{{ model.outcomeOf(model.cellById(id)).label }}
        </p>
        <MatrixCellEvidence
          :cell="model.cellById(id)"
          :outcome="model.outcomeOf(model.cellById(id))"
          :quote-lang="quoteLang"
        >
          <template #source="{ id: source }"
            ><slot name="source" :id="source">[{{ source }}]</slot></template
          >
        </MatrixCellEvidence>
        <button class="button button--quiet" @click="again(id)">
          重新判断
        </button>
      </div>
    </section>
  </template>
  <section v-if="part !== 'questions' && complete" :aria-label="label">
    <h3>{{ model.cells.length }} 个格子</h3>
    <p class="caption">
      <template v-for="(item, index) in counts" :key="item.outcome.id"
        >{{ item.count }} 个{{ item.outcome.summary ?? item.outcome.label
        }}{{ index < counts.length - 1 ? "，" : "。" }}</template
      >点格子看原文。
    </p>
    <div class="table-scroll">
      <table class="matrix">
        <caption>
          {{
            caption
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ rowHeader }}</th>
            <th v-for="column in model.columns" :key="column.id" scope="col">
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in model.rows" :key="row.id">
            <th scope="row">{{ row.label }}</th>
            <td v-for="column in model.columns" :key="column.id">
              <button
                class="cell"
                :class="[
                  `tone-${model.outcomeOf(model.cellById(matrixCellId(row.id, column.id))).tone}`,
                  { chosen: selected === matrixCellId(row.id, column.id) },
                ]"
                :aria-label="`${row.label} 对 ${column.label}：${model.outcomeOf(model.cellById(matrixCellId(row.id, column.id))).label}`"
                :aria-pressed="selected === matrixCellId(row.id, column.id)"
                @click="selected = matrixCellId(row.id, column.id)"
              >
                {{
                  model.outcomeOf(
                    model.cellById(matrixCellId(row.id, column.id)),
                  ).label
                }}
                <small v-if="mark(matrixCellId(row.id, column.id))">{{
                  mark(matrixCellId(row.id, column.id))
                }}</small>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <section v-if="detail" class="detail" aria-label="所选格子的证据">
      <h4>{{ detail.row.label }} × {{ detail.column.label }}</h4>
      <p v-if="detail.column.full" class="caption">{{ detail.column.full }}</p>
      <MoleculeView
        v-if="detail.row.smiles"
        :name="detail.row.label"
        :smiles="detail.row.smiles"
      />
      <MatrixCellEvidence
        :cell="detail.cell"
        :outcome="detail.outcome"
        :quote-lang="quoteLang"
      >
        <template #source="{ id: source }"
          ><slot name="source" :id="source">[{{ source }}]</slot></template
        >
      </MatrixCellEvidence>
    </section>
  </section>
</template>
<style scoped>
.exercise {
  margin-block: var(--space-6);
  padding: var(--space-5);
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius);
}
.given,
legend,
.choice {
  font-family: var(--font-sans);
}
.given {
  color: var(--ink-soft);
  font-size: var(--text-sm);
}
fieldset {
  border: 0;
  padding: 0;
  margin-block: var(--space-4);
}
.choice {
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-2);
  margin-right: var(--space-5);
}
table.matrix {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
}
.cell {
  width: 100%;
  min-width: 4.5rem;
  padding: var(--space-2);
  font: inherit;
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--ink);
  cursor: pointer;
}
.cell small {
  display: block;
  color: var(--ink-muted);
}
.cell.tone-success {
  background: var(--success-soft);
}
.cell.tone-accent {
  background: var(--accent-soft);
}
.cell.tone-danger {
  background: var(--danger-soft);
}
.cell.tone-evidence {
  background: var(--evidence-soft);
}
.cell.tone-untested {
  background: var(--paper-deep);
  border-style: dashed;
  color: var(--ink-muted);
}
.cell.chosen {
  outline: var(--focus-ring);
  outline-offset: 1px;
}
.detail {
  margin-block: var(--space-5);
  padding: var(--space-4);
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius);
}
</style>
