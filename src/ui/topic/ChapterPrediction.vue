<script setup lang="ts">
import ExerciseSource from "./ExerciseSource.vue";
import { computed, ref } from "vue";
import MoleculeView from "../MoleculeView.vue";
import ImagePoints from "./ImagePoints.vue";
import { labModels, modelInputs } from "../models/catalog.mjs";
import PredictionExercise from "../PredictionExercise.vue";
import SourceExcerpt from "../SourceExcerpt.vue";
import type { PredictionAnswer, TopicPrediction } from "./content";
import { useTopic } from "./context";
import {
  designAtomsRight,
  isChoice,
  predictionCorrect,
  selectionRange,
} from "./prediction";

/**
 * One prediction from content.json: a choice; one atom or bond picked on a
 * structure; a set of atoms picked on each of several structures; or one
 * curved arrow, picked as its source atom then its target. `id` and
 * `prediction` name it. The first
 * submission is stored in the topic's records under the id; from then on
 * the result shows instead. The default slot sits under the question, the
 * `result` slot under the explanation.
 */
const props = defineProps<{ id: string; prediction: TopicPrediction }>();
const { content, records } = useTopic();
const id = computed(() => props.id);
const prediction = computed(() => props.prediction);
const saved = computed(() => records.records.predictions[id.value]);
const option = ref(-1);
const selected = ref<number[]>([]);
const typed = ref<number | null>(null);
const point = ref<string>();
/** Place (1-based) per option for a ranking; 0 = not placed yet. */
const places = ref<number[]>(
  prediction.value.kind === "ranking"
    ? prediction.value.options.map(() => 0)
    : [],
);
const rankingComplete = computed(() => {
  const n = places.value.length;
  return (
    n > 0 &&
    places.value.every((p) => p >= 1 && p <= n) &&
    new Set(places.value).size === n
  );
});
/** Option indices in rank order, from the places typed. */
const rankingOrder = computed(() =>
  [...places.value.keys()].sort((a, b) => places.value[a] - places.value[b]),
);
const sets = ref<number[][]>(
  prediction.value.kind === "atom-set"
    ? prediction.value.molecules.map(() => [])
    : [],
);
const kind = computed(() => prediction.value.kind ?? "choice");
const canSubmit = computed(() => {
  switch (kind.value) {
    case "choice":
      return option.value >= 0;
    case "atom-set":
      return (
        sets.value.every((set) => set.length > 0) &&
        (prediction.value.kind !== "atom-set" ||
          !prediction.value.options ||
          option.value >= 0)
      );
    case "arrows":
      return (
        selected.value.length === 2 &&
        (prediction.value.kind !== "arrows" ||
          !prediction.value.options ||
          option.value >= 0)
      );
    case "number":
      return typed.value !== null && Number.isFinite(typed.value);
    case "design":
      return selected.value.length > 0 && option.value >= 0;
    case "image-points":
      return (
        point.value !== undefined &&
        (prediction.value.kind !== "image-points" ||
          !prediction.value.options ||
          option.value >= 0)
      );
    case "ranking":
      return rankingComplete.value;
    default: {
      const [min, max] = selectionRange(prediction.value);
      return selected.value.length >= min && selected.value.length <= max;
    }
  }
});
function pickArrowAtom(value: number[]) {
  // Source first, then target; a third pick starts over.
  selected.value = value.length > 2 ? value.slice(-1) : value;
}
function submit() {
  if (saved.value !== undefined) return;
  const answer: PredictionAnswer =
    kind.value === "choice"
      ? { option: option.value }
      : kind.value === "atom-set"
        ? {
            sets: sets.value.map((set) => [...set]),
            ...(prediction.value.kind === "atom-set" && prediction.value.options
              ? { choice: option.value }
              : {}),
          }
        : kind.value === "arrows"
          ? {
              from: selected.value[0],
              to: selected.value[1],
              ...(prediction.value.kind === "arrows" && prediction.value.options
                ? { choice: option.value }
                : {}),
            }
          : kind.value === "number"
            ? { value: typed.value ?? 0 }
            : kind.value === "image-points"
              ? {
                  point: point.value ?? "",
                  ...(prediction.value.kind === "image-points" &&
                  prediction.value.options
                    ? { choice: option.value }
                    : {}),
                }
              : kind.value === "design"
                ? { atoms: [...selected.value], option: option.value }
                : kind.value === "ranking"
                  ? { ranking: rankingOrder.value }
                  : { selected: [...selected.value] };
  records.records.predictions[id.value] = answer;
}
const correct = computed(
  () =>
    saved.value !== undefined &&
    predictionCorrect(prediction.value, saved.value),
);
const chosen = computed(() => {
  const p = prediction.value;
  const s = saved.value;
  if (!s) return undefined;
  if ((isChoice(p) || p.kind === "design") && "option" in s)
    return p.options[s.option];
  if (
    (p.kind === "arrows" ||
      p.kind === "atom-set" ||
      p.kind === "image-points") &&
    p.options &&
    "choice" in s &&
    s.choice !== undefined
  )
    return p.options[s.choice];
  return undefined;
});
const pickedAtoms = computed(() =>
  saved.value && "atoms" in saved.value ? saved.value.atoms : [],
);
const designAtomsOk = computed(
  () =>
    prediction.value.kind === "design" &&
    designAtomsRight(prediction.value, pickedAtoms.value),
);
const pickedPoint = computed(() =>
  saved.value && "point" in saved.value ? saved.value.point : undefined,
);
const pointLabel = (id: string | undefined) =>
  prediction.value.kind === "image-points"
    ? (prediction.value.points.find((item) => item.id === id)?.label ?? "")
    : "";
const savedRanking = computed(() =>
  saved.value && "ranking" in saved.value ? saved.value.ranking : [],
);
/** For multi-pick structure predictions: how many picks fall in the answer. */
const hits = computed(() => {
  const p = prediction.value;
  if ((p.kind !== "atoms" && p.kind !== "bonds") || !picked.value.length)
    return undefined;
  if (selectionRange(p)[1] === 1) return undefined;
  return picked.value.filter((i) => p.answer.includes(i)).length;
});
const pickMany = (value: number[]) => {
  const max = selectionRange(prediction.value)[1];
  selected.value = value.length > max ? value.slice(-max) : value;
};
const atomList = (atoms: readonly number[]) =>
  atoms.length ? [...atoms].sort((a, b) => a - b).join("、") : "无";
const picked = computed(() =>
  saved.value && "selected" in saved.value ? saved.value.selected : [],
);
const pickedSets = computed(() =>
  saved.value && "sets" in saved.value ? saved.value.sets : [],
);
const pickedArrow = computed(() =>
  saved.value && "from" in saved.value ? saved.value : undefined,
);
const typedValue = computed(() =>
  saved.value && "value" in saved.value ? saved.value.value : undefined,
);
/** What a lab model says about the reader's number, for `readout` predictions. */
const readout = computed(() => {
  const p = prediction.value;
  if (p.kind !== "number" || !p.readout || typedValue.value === undefined)
    return undefined;
  const model = labModels[p.readout.model];
  if (!model) throw new Error(`Unknown lab model: ${p.readout.model}`);
  try {
    const values = Object.fromEntries(
      modelInputs(model).map((input) => [input.id, input.default]),
    );
    values[p.readout.input] = typedValue.value;
    return { result: model.run(values), error: "" };
  } catch (reason) {
    return {
      result: null,
      error: reason instanceof Error ? reason.message : "无法计算",
    };
  }
});
const verdict = computed(() => {
  const p = prediction.value;
  if (p.kind === "number" && p.answer === undefined) return "已记录你的估计";
  return correct.value ? "判断正确" : "回看选择依据";
});
const excerpts = computed(() =>
  [
    ...new Set([
      ...(prediction.value.excerpt ? [prediction.value.excerpt] : []),
      ...(prediction.value.evidence ?? []),
    ]),
  ].map((id) => content.excerptById(id)),
);
const hints: Record<string, string> = {
  atoms: "点选一个原子后提交；再次点击可取消。",
  bonds: "点选一个键后提交；再次点击可取消。",
  "atoms-many": "点选原子后提交；再次点击可取消。",
  "bonds-many": "点选键后提交；再次点击可取消。",
  "atom-set": "在每个结构上点选全部符合的原子后提交；再次点击可取消。",
  design: "点选要改动的全部原子，再选方案，一起提交。",
  "image-points": "在图上点一个位点后提交。",
  ranking: "给每个候选填一个不重复的名次（1 为最优）。",
  arrows: "先点电子来源的原子，再点去向的原子；第三次点击重新开始。",
};
</script>

<template>
  <section
    v-if="saved !== undefined"
    class="callout callout--evidence"
    aria-label="预测结果"
    :data-testid="`prediction-${id}`"
  >
    <ExerciseSource :source="prediction.source" />
    <h3>{{ verdict }}</h3>
    <p>{{ prediction.question }}</p>
    <p v-if="chosen !== undefined">你的预测：{{ chosen }}</p>
    <template v-if="isChoice(prediction)">
      <p>正确答案：{{ prediction.options[prediction.answer] }}</p>
      <ol v-if="prediction.optionExplanations" class="option-explanations">
        <li
          v-for="(explanation, index) in prediction.optionExplanations"
          :key="index"
          :data-correct="
            index === prediction.answer ||
            (prediction.alsoCorrect ?? []).includes(index)
          "
          :data-chosen="'option' in saved && saved.option === index"
        >
          <p>
            {{ prediction.options[index] }}
            <span
              v-if="
                index === prediction.answer ||
                (prediction.alsoCorrect ?? []).includes(index)
              "
              class="option-mark"
              >（正确项）</span
            >
            <span
              v-if="'option' in saved && saved.option === index"
              class="option-mark"
              >（你的选择）</span
            >
          </p>
          <p>{{ explanation }}</p>
        </li>
      </ol>
    </template>
    <p v-if="hits !== undefined">
      命中 {{ hits }} / {{ picked.length }}（你选了
      {{ prediction.kind === "bonds" ? "键" : "原子" }}
      {{ atomList(picked) }}）
    </p>
    <template v-if="prediction.kind === 'number' && typedValue !== undefined">
      <p>
        你的估计：{{ typedValue }}
        {{ prediction.input.unit ?? "" }}
        <template v-if="prediction.answer !== undefined"
          >；参考值 {{ prediction.answer
          }}{{ prediction.tolerance ? `（±${prediction.tolerance}）` : "" }}
          {{ prediction.input.unit ?? "" }}</template
        >
      </p>
      <template v-if="readout">
        <p v-if="readout.error" role="alert">{{ readout.error }}</p>
        <template v-else-if="readout.result">
          <p v-if="readout.result.summary" role="status">
            {{ readout.result.summary }}
          </p>
          <dl v-if="readout.result.readouts?.length" class="readouts">
            <template v-for="item in readout.result.readouts" :key="item.label">
              <dt>{{ item.label }}</dt>
              <dd class="num">{{ item.value }}</dd>
            </template>
          </dl>
        </template>
      </template>
    </template>
    <p v-if="pickedArrow && prediction.kind === 'arrows'">
      你画的箭头：原子 {{ pickedArrow.from }} → 原子
      {{ pickedArrow.to }}；图中为正确的箭头，原子
      {{ prediction.answer.from }} → 原子 {{ prediction.answer.to }}。
    </p>
    <p v-if="prediction.kind === 'atoms' || prediction.kind === 'bonds'">
      正确答案：{{ prediction.kind === "atoms" ? "原子" : "键" }}
      {{ atomList(prediction.answer) }}
    </p>
    <MoleculeView
      v-if="prediction.kind === 'atoms' || prediction.kind === 'bonds'"
      :name="prediction.molecule.name"
      :smiles="prediction.molecule.smiles"
      :selected="picked"
      :selected-kind="prediction.kind"
      :highlight-atoms="prediction.kind === 'atoms' ? prediction.answer : []"
      :highlight-bonds="prediction.kind === 'bonds' ? prediction.answer : []"
      :labels="prediction.labels"
    />
    <template v-else-if="prediction.kind === 'atom-set'">
      <template
        v-for="(molecule, i) in prediction.molecules"
        :key="molecule.name"
      >
        <MoleculeView
          :name="molecule.name"
          :smiles="molecule.smiles"
          :selected="pickedSets[i] ?? []"
          :highlight-atoms="molecule.answer"
          :labels="prediction.labels"
        />
        <p>
          {{ molecule.name }}：你选择了原子
          {{ atomList(pickedSets[i] ?? []) }}；核对后的答案是原子
          {{ atomList(molecule.answer) }}。
        </p>
      </template>
    </template>
    <MoleculeView
      v-else-if="prediction.kind === 'arrows'"
      :name="prediction.molecule.name"
      :smiles="prediction.molecule.smiles"
      :selected="pickedArrow ? [pickedArrow.from, pickedArrow.to] : []"
      :arrows="[
        {
          from: { atom: prediction.answer.from },
          to: { atom: prediction.answer.to },
          electrons: 2,
        },
      ]"
      :labels="prediction.labels"
    />
    <template v-if="prediction.kind === 'image-points'">
      <ImagePoints
        :image="prediction.image"
        :points="prediction.points"
        :picked="pickedPoint"
        :answer="prediction.answer"
        disabled
      />
      <p>
        你选的位点：{{ pointLabel(pickedPoint) }}；正确位点：{{
          prediction.answer.map(pointLabel).join("、")
        }}
      </p>
    </template>
    <template v-if="prediction.kind === 'design'">
      <MoleculeView
        :name="prediction.molecule.name"
        :smiles="prediction.molecule.smiles"
        :selected="pickedAtoms"
        :highlight-atoms="prediction.groups.flat()"
        :labels="prediction.labels"
      />
      <p>
        结构：{{ designAtomsOk ? "选对了位置" : "位置还要再看" }}（你选了原子
        {{ atomList(pickedAtoms) }}）<template v-if="prediction.atomExplanation"
          >。{{ prediction.atomExplanation }}</template
        >
      </p>
    </template>
    <ol v-else-if="prediction.kind === 'ranking'" class="ranking">
      <li v-for="i in savedRanking" :key="i">
        {{ prediction.options[i] }}
        <template v-if="i === prediction.answer">（参考答案的第一名）</template>
      </li>
    </ol>
    <p>{{ prediction.explanation }}</p>
    <SourceExcerpt
      v-for="excerpt in excerpts"
      :key="excerpt.id"
      :excerpt="excerpt"
      :sources="content.sources"
    />
    <slot name="result" />
    <p v-if="prediction.reset">
      <button
        class="button button--quiet"
        type="button"
        @click="delete records.records.predictions[id]"
      >
        重新判断
      </button>
    </p>
  </section>
  <section v-else :data-testid="`prediction-${id}`">
    <ExerciseSource :source="prediction.source" />
    <PredictionExercise
      :prompt="prediction.question"
      :can-submit="canSubmit"
      @submit="submit"
    >
      <template #default="{ submitted }">
        <p v-if="prediction.context">{{ prediction.context }}</p>
        <slot />
        <MoleculeView
          v-if="prediction.kind === 'atoms' || prediction.kind === 'bonds'"
          :name="prediction.molecule.name"
          :smiles="prediction.molecule.smiles"
          :selected="selected"
          :selectable="prediction.kind"
          :disabled="submitted"
          @update:selected="pickMany"
        />
        <template v-else-if="prediction.kind === 'atom-set'">
          <MoleculeView
            v-for="(molecule, i) in prediction.molecules"
            :key="molecule.name"
            v-model:selected="sets[i]"
            :name="molecule.name"
            :smiles="molecule.smiles"
            selectable="atoms"
            :disabled="submitted"
          />
        </template>
        <MoleculeView
          v-else-if="prediction.kind === 'arrows'"
          :name="prediction.molecule.name"
          :smiles="prediction.molecule.smiles"
          :selected="selected"
          selectable="atoms"
          :disabled="submitted"
          @update:selected="pickArrowAtom"
        />
        <template v-if="prediction.kind !== 'atom-set'">
          <MoleculeView
            v-for="molecule in prediction.molecules ?? []"
            :key="molecule.name"
            :name="molecule.name"
            :smiles="molecule.smiles"
          />
        </template>
        <ImagePoints
          v-if="prediction.kind === 'image-points'"
          :image="prediction.image"
          :points="prediction.points"
          :picked="point"
          :disabled="submitted"
          @pick="(id) => (point = point === id ? undefined : id)"
        />
        <MoleculeView
          v-if="prediction.kind === 'design'"
          v-model:selected="selected"
          :name="prediction.molecule.name"
          :smiles="prediction.molecule.smiles"
          selectable="atoms"
          :disabled="submitted"
        />
        <fieldset v-if="prediction.kind === 'ranking'" :disabled="submitted">
          <legend>你的排序</legend>
          <label v-for="(item, i) in prediction.options" :key="item"
            >{{ item
            }}<input
              v-model.number="places[i]"
              type="number"
              min="1"
              :max="prediction.options.length"
              step="1"
              :aria-label="`${item} 的名次`"
          /></label>
        </fieldset>
        <label v-if="prediction.kind === 'number'" class="field"
          >{{ prediction.input.label
          }}<template v-if="prediction.input.unit">
            （{{ prediction.input.unit }}）</template
          ><input
            v-model.number="typed"
            type="number"
            :min="prediction.input.min"
            :max="prediction.input.max"
            :step="prediction.input.step ?? 'any'"
            :disabled="submitted"
        /></label>
        <p v-if="kind in hints" class="figure-caption">
          {{
            (kind === "atoms" || kind === "bonds") &&
            selectionRange(prediction)[1] > 1
              ? `${hints[`${kind}-many`]}（${selectionRange(prediction)[0]} 到 ${selectionRange(prediction)[1]} 个）`
              : hints[kind]
          }}
        </p>
        <fieldset
          v-if="
            isChoice(prediction) ||
            prediction.kind === 'design' ||
            ((prediction.kind === 'arrows' ||
              prediction.kind === 'atom-set' ||
              prediction.kind === 'image-points') &&
              prediction.options)
          "
          :disabled="submitted"
        >
          <legend>你的预测</legend>
          <label v-for="(answer, index) in prediction.options" :key="answer">
            <input
              v-model="option"
              type="radio"
              :name="`prediction-${id}`"
              :value="index"
            />
            {{ answer }}
          </label>
        </fieldset>
      </template>
    </PredictionExercise>
  </section>
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
.readouts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-2) var(--space-4);
  font-family: var(--font-sans);
}
.readouts dd {
  margin: 0;
}
</style>
