import type {
  TextChoiceExercise,
  ExerciseAnswer,
  ExerciseEntry,
  MatrixAnswer,
  TopicExercise,
} from "./content.ts";
import {
  isObject,
  type RecordField,
  type TopicRecordsBase,
} from "../../contracts/records.ts";

export function isTextChoice(
  exercise: TopicExercise,
): exercise is TextChoiceExercise {
  return exercise.type === "choice" && exercise.kind === undefined;
}

export function choiceIsCorrect(
  question: { answer: number; alsoCorrect?: readonly number[] },
  option: number,
) {
  return (
    option === question.answer ||
    question.alsoCorrect?.includes(option) === true
  );
}

export function choiceQuestions(
  quiz: readonly { id: string; options: readonly string[] }[],
  entries: readonly ExerciseEntry[],
) {
  return [
    ...quiz,
    ...entries.flatMap(({ exercise }) =>
      exercise.type !== "matrix" &&
      exercise.type !== "quiz" &&
      isTextChoice(exercise)
        ? [exercise]
        : [],
    ),
  ];
}

const sameSet = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length &&
  [...a].sort().every((v, i) => v === [...b].sort()[i]);

/** Every group has at least one picked atom and no picked atom lies outside the groups. */
export function designAtomsRight(
  exercise: { groups: readonly (readonly number[])[] },
  atoms: readonly number[],
) {
  return (
    exercise.groups.every((group) => group.some((i) => atoms.includes(i))) &&
    atoms.every((i) => exercise.groups.some((group) => group.includes(i)))
  );
}

export function exerciseCorrect(
  exercise: TopicExercise,
  answer: ExerciseAnswer,
): boolean {
  if (isTextChoice(exercise))
    return "option" in answer && choiceIsCorrect(exercise, answer.option);
  if (exercise.kind === "atom-set")
    return (
      "sets" in answer &&
      answer.sets.length === exercise.molecules.length &&
      (exercise.gradeAtoms === false ||
        exercise.molecules.every((molecule, i) =>
          sameSet(molecule.answer, answer.sets[i]),
        )) &&
      (exercise.options === undefined ||
        answer.choice === exercise.optionAnswer)
    );
  if (exercise.kind === "design")
    return (
      "atoms" in answer &&
      answer.option === exercise.answer &&
      designAtomsRight(exercise, answer.atoms)
    );
  if (exercise.kind === "image-points")
    return (
      "point" in answer &&
      exercise.answer.includes(answer.point) &&
      (exercise.options === undefined ||
        answer.choice === exercise.optionAnswer)
    );
  if (exercise.type === "ranking")
    return "ranking" in answer && answer.ranking[0] === exercise.answer;
  if (exercise.type === "number")
    return (
      "value" in answer &&
      exercise.answer !== undefined &&
      Math.abs(answer.value - exercise.answer) <= (exercise.tolerance ?? 0)
    );
  if (exercise.kind === "arrows")
    return (
      "from" in answer &&
      answer.from === exercise.answer.from &&
      answer.to === exercise.answer.to &&
      (exercise.options === undefined ||
        answer.choice === exercise.optionAnswer)
    );
  if (!("selected" in answer)) return false;
  const picks = answer.selected;
  const [min, max] = selectionRange(exercise);
  if (picks.length < min || picks.length > max) return false;
  if (exercise.match === "subset" || max === 1)
    return picks.every((i) => exercise.answer.includes(i));
  return sameSet(picks, exercise.answer);
}

/** A saved answer to a graded exercise that is wrong; a number readout without an answer is never wrong. */
export function exerciseMistaken(
  exercise: TopicExercise,
  answer: ExerciseAnswer | undefined,
) {
  return (
    answer !== undefined &&
    !(exercise.type === "number" && exercise.answer === undefined) &&
    !exerciseCorrect(exercise, answer)
  );
}

/** How many picks a structure exercise takes: `[min, max]`, one by default. */
export function selectionRange(exercise: TopicExercise): [number, number] {
  if (exercise.kind !== "atoms" && exercise.kind !== "bonds") return [1, 1];
  const min = exercise.minSelections ?? 1;
  return [min, exercise.maxSelections ?? min];
}

export interface ExerciseRecords {
  exercises: Record<string, ExerciseAnswer>;
  matrices: Record<string, MatrixAnswer>;
}

export function answerOf(
  exercise: TopicExercise,
  records: Pick<TopicRecordsBase, "answers"> &
    Pick<ExerciseRecords, "exercises">,
): ExerciseAnswer | undefined {
  if (!isTextChoice(exercise)) return records.exercises[exercise.id];
  const option = records.answers[exercise.id];
  return option === undefined ? undefined : { option };
}

/** A matrix waits for its required cells, a quiz gate for every referenced question. */
export function exerciseAnswered(
  { exercise, id }: ExerciseEntry,
  records: Pick<TopicRecordsBase, "answers" | "diagnostic"> & ExerciseRecords,
) {
  if (exercise.type === "quiz") {
    const bank = exercise.diagnostic ? records.diagnostic : records.answers;
    return exercise.questions.every((question) => bank[question] !== undefined);
  }
  if (exercise.type === "matrix") {
    const answer = records.matrices[id];
    return answer !== undefined && exercise.model.isComplete(answer.cells);
  }
  return answerOf(exercise, records) !== undefined;
}

const index = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
/** `index`, and below the molecule's count when it states one. */
const below = (count: number | undefined) => (value: unknown) =>
  index(value) && (count === undefined || value < count);

/** The chosen learning path: one of the topic's path ids, the first by default. */
export function pathField(
  paths: readonly { id: string }[],
): RecordField<string> {
  return {
    empty: () => paths[0].id,
    parse(value) {
      if (value === undefined) return paths[0].id;
      if (typeof value !== "string" || !paths.some((p) => p.id === value))
        throw new Error("学习路径记录无效");
      return value;
    },
  };
}

/** Each matrix stores its answered cells, including incomplete attempts. */
export function matrixField(
  entries: readonly ExerciseEntry[],
): RecordField<ExerciseRecords["matrices"]> {
  const matrices = new Map(
    entries.flatMap(({ id, exercise }) =>
      exercise.type === "matrix" ? [[id, exercise.model] as const] : [],
    ),
  );
  return {
    empty: () => ({}),
    parse(value) {
      if (value === undefined) return {};
      if (!isObject(value)) throw new Error("矩阵记录格式错误");
      const next: ExerciseRecords["matrices"] = {};
      for (const [id, entry] of Object.entries(value)) {
        const model = matrices.get(id);
        if (!model || !isObject(entry) || !isObject(entry.cells))
          throw new Error("矩阵记录格式错误");
        const cells: Record<string, number> = {};
        for (const [cell, pick] of Object.entries(entry.cells)) {
          if (
            !model.required.includes(cell) ||
            !index(pick) ||
            pick >= model.choices.length
          )
            throw new Error("矩阵选项无效");
          cells[cell] = pick;
        }
        next[id] = { cells };
      }
      return next;
    },
  };
}

/** The structured submissions of inline exercises. Text choices use answers. */
export function exerciseField(
  entries: readonly { id: string; exercise: ExerciseEntry["exercise"] }[],
): RecordField<ExerciseRecords["exercises"]> {
  const exercises = new Map(entries.map(({ id, exercise }) => [id, exercise]));
  return {
    empty: () => ({}),
    parse(value) {
      if (value === undefined) return {};
      if (!isObject(value)) throw new Error("练习记录格式错误");
      const next: ExerciseRecords["exercises"] = {};
      for (const [id, entry] of Object.entries(value)) {
        const exercise = exercises.get(id);
        if (
          !exercise ||
          exercise.type === "quiz" ||
          exercise.type === "matrix" ||
          isTextChoice(exercise) ||
          !isObject(entry)
        )
          throw new Error("练习记录格式错误");
        if (exercise.kind === "atom-set") {
          const { sets } = entry;
          if (
            !Array.isArray(sets) ||
            sets.length !== exercise.molecules.length ||
            !sets.every(
              (set, i) =>
                Array.isArray(set) &&
                set.length > 0 &&
                set.every(below(exercise.molecules[i].atoms)),
            )
          )
            throw new Error("练习选项无效");
          const kept = { sets: sets.map((set: number[]) => [...set]) };
          if (exercise.options) {
            const { choice } = entry;
            if (!index(choice) || choice >= exercise.options.length)
              throw new Error("练习选项无效");
            next[id] = { ...kept, choice };
          } else next[id] = kept;
        } else if (exercise.kind === "design") {
          const { atoms, option } = entry;
          if (
            !Array.isArray(atoms) ||
            atoms.length === 0 ||
            !atoms.every(below(exercise.molecule.atoms)) ||
            !index(option) ||
            option >= exercise.options.length
          )
            throw new Error("练习选项无效");
          next[id] = { atoms: [...atoms], option };
        } else if (exercise.kind === "image-points") {
          const { point, choice } = entry;
          if (
            typeof point !== "string" ||
            !exercise.points.some((item) => item.id === point)
          )
            throw new Error("练习选项无效");
          if (exercise.options) {
            if (!index(choice) || choice >= exercise.options.length)
              throw new Error("练习选项无效");
            next[id] = { point, choice };
          } else next[id] = { point };
        } else if (exercise.type === "ranking") {
          const { ranking } = entry;
          const n = exercise.options.length;
          if (
            !Array.isArray(ranking) ||
            ranking.length !== n ||
            !ranking.every(index) ||
            new Set(ranking).size !== n ||
            ranking.some((i) => i >= n)
          )
            throw new Error("练习选项无效");
          next[id] = { ranking: [...ranking] };
        } else if (exercise.type === "number") {
          const { value: number } = entry;
          if (typeof number !== "number" || !Number.isFinite(number))
            throw new Error("练习选项无效");
          next[id] = { value: number };
        } else if (exercise.kind === "arrows") {
          const { from, to, choice } = entry;
          if (!index(from) || !index(to) || from === to)
            throw new Error("练习选项无效");
          if (exercise.options) {
            if (!index(choice) || choice >= exercise.options.length)
              throw new Error("练习选项无效");
            next[id] = { from, to, choice };
          } else next[id] = { from, to };
        } else {
          const { selected } = entry;
          const [min, max] = selectionRange(exercise);
          if (
            !Array.isArray(selected) ||
            selected.length < min ||
            selected.length > max ||
            !selected.every(below(exercise.molecule[exercise.kind])) ||
            new Set(selected).size !== selected.length
          )
            throw new Error("练习选项无效");
          next[id] = { selected: [...selected] };
        }
      }
      return next;
    },
  };
}
