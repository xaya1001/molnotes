<script setup lang="ts">
import ExerciseSource from "./ExerciseSource.vue";
import ChapterText from "./ChapterText.vue";
import ChoiceOptions from "./ChoiceOptions.vue";
import ChoiceExplanations from "./ChoiceExplanations.vue";
import { computed, ref } from "vue";
import MoleculeView from "../MoleculeView.vue";
import ImagePoints from "./ImagePoints.vue";
import { labModels, modelInputs } from "../models/catalog.ts";
import ExerciseForm from "../ExerciseForm.vue";
import SourceExcerpt from "../SourceExcerpt.vue";
import type { ExerciseAnswer, TopicExercise } from "./content.ts";
import { useTopic } from "./context.ts";
import {
  designAtomsRight,
  isTextChoice,
  answerOf,
  exerciseCorrect,
  selectionRange,
} from "./exercise.ts";

/** An inline exercise restores its result from the saved answer. */
const props = defineProps<{ exercise: TopicExercise }>();
const { content, records } = useTopic();
const id = computed(() => props.exercise.id);
const exercise = computed(() => props.exercise);
const saved = computed(() => answerOf(exercise.value, records.records));
const option = ref(-1);
const selected = ref<number[]>([]);
const typed = ref<number | null>(null);
const point = ref<string>();
/** Place (1-based) per option for a ranking; 0 = not placed yet. */
const places = ref<number[]>(
  exercise.value.type === "ranking" ? exercise.value.options.map(() => 0) : [],
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
  exercise.value.kind === "atom-set"
    ? exercise.value.molecules.map(() => [])
    : [],
);
const kind = computed(() => exercise.value.kind ?? exercise.value.type);
const canSubmit = computed(() => {
  switch (kind.value) {
    case "choice":
      return option.value >= 0;
    case "atom-set":
      return (
        sets.value.every((set) => set.length > 0) &&
        (exercise.value.kind !== "atom-set" ||
          !exercise.value.options ||
          option.value >= 0)
      );
    case "arrows":
      return (
        selected.value.length === 2 &&
        (exercise.value.kind !== "arrows" ||
          !exercise.value.options ||
          option.value >= 0)
      );
    case "number":
      return typed.value !== null && Number.isFinite(typed.value);
    case "design":
      return selected.value.length > 0 && option.value >= 0;
    case "image-points":
      return (
        point.value !== undefined &&
        (exercise.value.kind !== "image-points" ||
          !exercise.value.options ||
          option.value >= 0)
      );
    case "ranking":
      return rankingComplete.value;
    default: {
      const [min, max] = selectionRange(exercise.value);
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
  if (isTextChoice(exercise.value)) {
    records.records.answers[id.value] = option.value;
    return;
  }
  const answer: ExerciseAnswer =
    kind.value === "atom-set"
      ? {
          sets: sets.value.map((set) => [...set]),
          ...(exercise.value.kind === "atom-set" && exercise.value.options
            ? { choice: option.value }
            : {}),
        }
      : kind.value === "arrows"
        ? {
            from: selected.value[0],
            to: selected.value[1],
            ...(exercise.value.kind === "arrows" && exercise.value.options
              ? { choice: option.value }
              : {}),
          }
        : kind.value === "number"
          ? { value: typed.value ?? 0 }
          : kind.value === "image-points"
            ? {
                point: point.value ?? "",
                ...(exercise.value.kind === "image-points" &&
                exercise.value.options
                  ? { choice: option.value }
                  : {}),
              }
            : kind.value === "design"
              ? { atoms: [...selected.value], option: option.value }
              : kind.value === "ranking"
                ? { ranking: rankingOrder.value }
                : { selected: [...selected.value] };
  records.records.exercises[id.value] = answer;
}
function reset() {
  if (isTextChoice(exercise.value)) delete records.records.answers[id.value];
  else delete records.records.exercises[id.value];
}
const correct = computed(
  () =>
    saved.value !== undefined && exerciseCorrect(exercise.value, saved.value),
);
const choice = computed(() => {
  const item = exercise.value;
  if (isTextChoice(item) || item.kind === "design") return item;
  if (
    (item.kind === "arrows" ||
      item.kind === "atom-set" ||
      item.kind === "image-points") &&
    item.options &&
    item.optionAnswer !== undefined
  )
    return { ...item, options: item.options, answer: item.optionAnswer };
  return undefined;
});
const chosen = computed(() => {
  const p = exercise.value;
  const s = saved.value;
  if (!s) return undefined;
  if ((isTextChoice(p) || p.kind === "design") && "option" in s)
    return { text: p.options[s.option], index: s.option };
  if (
    (p.kind === "arrows" ||
      p.kind === "atom-set" ||
      p.kind === "image-points") &&
    p.options &&
    "choice" in s &&
    s.choice !== undefined
  )
    return { text: p.options[s.choice], index: s.choice };
  return undefined;
});
const pickedAtoms = computed(() =>
  saved.value && "atoms" in saved.value ? saved.value.atoms : [],
);
const designAtomsOk = computed(
  () =>
    exercise.value.kind === "design" &&
    designAtomsRight(exercise.value, pickedAtoms.value),
);
const pickedPoint = computed(() =>
  saved.value && "point" in saved.value ? saved.value.point : undefined,
);
const pointLabel = (id: string | undefined) =>
  exercise.value.kind === "image-points"
    ? (exercise.value.points.find((item) => item.id === id)?.label ?? "")
    : "";
const savedRanking = computed(() =>
  saved.value && "ranking" in saved.value ? saved.value.ranking : [],
);
/** For multi-pick structure exercises: how many picks fall in the answer. */
const hits = computed(() => {
  const p = exercise.value;
  if ((p.kind !== "atoms" && p.kind !== "bonds") || !picked.value.length)
    return undefined;
  if (selectionRange(p)[1] === 1) return undefined;
  return picked.value.filter((i) => p.answer.includes(i)).length;
});
const pickMany = (value: number[]) => {
  const max = selectionRange(exercise.value)[1];
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
/** What a lab model says about the reader's number, for `readout` exercises. */
const readout = computed(() => {
  const p = exercise.value;
  if (p.type !== "number" || !p.readout || typedValue.value === undefined)
    return undefined;
  const model = labModels[p.readout.model];
  if (!model) throw new Error(`Unknown lab model: ${p.readout.model}`);
  try {
    const values = Object.fromEntries(
      modelInputs(model).map((input) => [input.id, input.default]),
    );
    values[p.readout.input] = typedValue.value;
    return { result: model().run(values), error: "" };
  } catch (reason) {
    return {
      result: null,
      error: reason instanceof Error ? reason.message : "无法计算",
    };
  }
});
const verdict = computed(() => {
  const p = exercise.value;
  if (p.type === "number" && p.answer === undefined) return "已记录你的估计";
  return correct.value ? "判断正确" : "回看选择依据";
});
const excerpts = computed(() =>
  [
    ...new Set([
      ...(exercise.value.excerpt ? [exercise.value.excerpt] : []),
      ...(exercise.value.evidence ?? []),
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
    aria-label="练习结果"
    :data-testid="`exercise-${id}`"
  >
    <ExerciseSource :source="exercise.source" />
    <h3>{{ verdict }}</h3>
    <p>
      <ChapterText :parts="exercise.prose?.question ?? [exercise.question]" />
    </p>
    <p v-if="chosen?.text !== undefined">
      你的选择：<ChapterText
        :parts="exercise.prose?.options?.[chosen.index] ?? [chosen.text]"
      />
    </p>
    <template v-if="choice">
      <p>
        正确答案：<ChapterText
          :parts="
            choice.prose?.options?.[choice.answer] ?? [
              choice.options[choice.answer],
            ]
          "
        />
      </p>
      <ChoiceExplanations
        v-if="choice.optionExplanations"
        :options="choice.options"
        :explanations="choice.optionExplanations"
        :prose="choice.prose"
        :answer="choice.answer"
        :also-correct="'alsoCorrect' in choice ? choice.alsoCorrect : undefined"
        :selected="chosen?.index"
      />
    </template>
    <p v-if="hits !== undefined">
      命中 {{ hits }} / {{ picked.length }}（你选了
      {{ exercise.kind === "bonds" ? "键" : "原子" }}
      {{ atomList(picked) }}）
    </p>
    <template v-if="exercise.type === 'number' && typedValue !== undefined">
      <p>
        你的估计：{{ typedValue }}
        {{ exercise.input.unit ?? "" }}
        <template v-if="exercise.answer !== undefined"
          >；参考值 {{ exercise.answer
          }}{{ exercise.tolerance ? `（±${exercise.tolerance}）` : "" }}
          {{ exercise.input.unit ?? "" }}</template
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
    <p v-if="pickedArrow && exercise.kind === 'arrows'">
      你画的箭头：原子 {{ pickedArrow.from }} → 原子
      {{ pickedArrow.to }}；图中为正确的箭头，原子 {{ exercise.answer.from }} →
      原子 {{ exercise.answer.to }}。
    </p>
    <p v-if="exercise.kind === 'atoms' || exercise.kind === 'bonds'">
      正确答案：{{ exercise.kind === "atoms" ? "原子" : "键" }}
      {{ atomList(exercise.answer) }}
    </p>
    <MoleculeView
      v-if="exercise.kind === 'atoms' || exercise.kind === 'bonds'"
      :name="exercise.molecule.name"
      :smiles="exercise.molecule.smiles"
      :abbreviations="exercise.molecule.abbreviations"
      :selected="picked"
      :selected-kind="exercise.kind"
      :highlight-atoms="exercise.kind === 'atoms' ? exercise.answer : []"
      :highlight-bonds="exercise.kind === 'bonds' ? exercise.answer : []"
      :labels="exercise.labels"
    />
    <template v-else-if="exercise.kind === 'atom-set'">
      <template
        v-for="(molecule, i) in exercise.molecules"
        :key="molecule.name"
      >
        <MoleculeView
          :name="molecule.name"
          :smiles="molecule.smiles"
          :abbreviations="molecule.abbreviations"
          :selected="pickedSets[i] ?? []"
          :highlight-atoms="molecule.answer"
          :labels="exercise.labels"
        />
        <p>
          {{ molecule.name }}：你选择了原子
          {{ atomList(pickedSets[i] ?? []) }}；核对后的答案是原子
          {{ atomList(molecule.answer) }}。
        </p>
      </template>
    </template>
    <MoleculeView
      v-else-if="exercise.kind === 'arrows'"
      :name="exercise.molecule.name"
      :smiles="exercise.molecule.smiles"
      :abbreviations="exercise.molecule.abbreviations"
      :selected="pickedArrow ? [pickedArrow.from, pickedArrow.to] : []"
      :arrows="[
        {
          from: { atom: exercise.answer.from },
          to: { atom: exercise.answer.to },
          electrons: 2,
        },
      ]"
      :labels="exercise.labels"
    />
    <template v-if="exercise.kind === 'image-points'">
      <ImagePoints
        :image="exercise.image"
        :points="exercise.points"
        :picked="pickedPoint"
        :answer="exercise.answer"
        disabled
      />
      <p>
        你选的位点：{{ pointLabel(pickedPoint) }}；正确位点：{{
          exercise.answer.map(pointLabel).join("、")
        }}
      </p>
    </template>
    <template v-if="exercise.kind === 'design'">
      <MoleculeView
        :name="exercise.molecule.name"
        :smiles="exercise.molecule.smiles"
        :abbreviations="exercise.molecule.abbreviations"
        :selected="pickedAtoms"
        :highlight-atoms="exercise.groups.flat()"
        :labels="exercise.labels"
      />
      <p>
        结构：{{ designAtomsOk ? "选对了位置" : "位置还要再看" }}（你选了原子
        {{ atomList(pickedAtoms) }}）<template v-if="exercise.atomExplanation"
          >。{{ exercise.atomExplanation }}</template
        >
      </p>
    </template>
    <ol v-else-if="exercise.type === 'ranking'" class="ranking">
      <li v-for="i in savedRanking" :key="i">
        <ChapterText
          :parts="exercise.prose?.options?.[i] ?? [exercise.options[i]]"
        />
        <template v-if="i === exercise.answer">（参考答案的第一名）</template>
      </li>
    </ol>
    <p>
      <ChapterText
        :parts="exercise.prose?.explanation ?? [exercise.explanation]"
      />
    </p>
    <SourceExcerpt
      v-for="excerpt in excerpts"
      :key="excerpt.id"
      :excerpt="excerpt"
      :sources="content.sources"
    />
    <slot name="result" />
    <p v-if="exercise.reset">
      <button class="button button--quiet" type="button" @click="reset">
        重新判断
      </button>
    </p>
  </section>
  <section v-else :data-testid="`exercise-${id}`">
    <ExerciseSource :source="exercise.source" />
    <ExerciseForm
      :prompt="exercise.question"
      :can-submit="canSubmit"
      @submit="submit"
    >
      <template #prompt>
        <ChapterText :parts="exercise.prose?.question ?? [exercise.question]" />
      </template>
      <template #default="{ submitted }">
        <p v-if="exercise.context">{{ exercise.context }}</p>
        <slot />
        <MoleculeView
          v-if="exercise.kind === 'atoms' || exercise.kind === 'bonds'"
          :name="exercise.molecule.name"
          :smiles="exercise.molecule.smiles"
          :abbreviations="exercise.molecule.abbreviations"
          :selected="selected"
          :selectable="exercise.kind"
          :disabled="submitted"
          @update:selected="pickMany"
        />
        <template v-else-if="exercise.kind === 'atom-set'">
          <MoleculeView
            v-for="(molecule, i) in exercise.molecules"
            :key="molecule.name"
            v-model:selected="sets[i]"
            :name="molecule.name"
            :smiles="molecule.smiles"
            :abbreviations="molecule.abbreviations"
            selectable="atoms"
            :disabled="submitted"
          />
        </template>
        <MoleculeView
          v-else-if="exercise.kind === 'arrows'"
          :name="exercise.molecule.name"
          :smiles="exercise.molecule.smiles"
          :abbreviations="exercise.molecule.abbreviations"
          :selected="selected"
          selectable="atoms"
          :disabled="submitted"
          @update:selected="pickArrowAtom"
        />
        <template v-if="exercise.kind !== 'atom-set'">
          <MoleculeView
            v-for="molecule in exercise.molecules ?? []"
            :key="molecule.name"
            :name="molecule.name"
            :smiles="molecule.smiles"
            :abbreviations="molecule.abbreviations"
          />
        </template>
        <ImagePoints
          v-if="exercise.kind === 'image-points'"
          :image="exercise.image"
          :points="exercise.points"
          :picked="point"
          :disabled="submitted"
          @pick="(id) => (point = point === id ? undefined : id)"
        />
        <MoleculeView
          v-if="exercise.kind === 'design'"
          v-model:selected="selected"
          :name="exercise.molecule.name"
          :smiles="exercise.molecule.smiles"
          :abbreviations="exercise.molecule.abbreviations"
          selectable="atoms"
          :disabled="submitted"
        />
        <fieldset v-if="exercise.type === 'ranking'" :disabled="submitted">
          <legend>你的排序</legend>
          <label v-for="(item, i) in exercise.options" :key="item"
            ><ChapterText
              :parts="exercise.prose?.options?.[i] ?? [item]" /><input
              v-model.number="places[i]"
              type="number"
              min="1"
              :max="exercise.options.length"
              step="1"
              :aria-label="`${item} 的名次`"
          /></label>
        </fieldset>
        <label v-if="exercise.type === 'number'" class="field"
          >{{ exercise.input.label
          }}<template v-if="exercise.input.unit">
            （{{ exercise.input.unit }}）</template
          ><input
            v-model.number="typed"
            type="number"
            :min="exercise.input.min"
            :max="exercise.input.max"
            :step="exercise.input.step ?? 'any'"
            :disabled="submitted"
        /></label>
        <p v-if="kind in hints" class="figure-caption">
          {{
            (kind === "atoms" || kind === "bonds") &&
            selectionRange(exercise)[1] > 1
              ? `${hints[`${kind}-many`]}（${selectionRange(exercise)[0]} 到 ${selectionRange(exercise)[1]} 个）`
              : hints[kind]
          }}
        </p>
        <ChoiceOptions
          v-if="choice"
          :id="id"
          :options="choice.options"
          :prose="choice.prose?.options"
          :selected="option"
          :disabled="submitted"
          @pick="option = $event"
        />
      </template>
    </ExerciseForm>
  </section>
</template>

<style scoped>
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
