import type {
  ChoicePrediction,
  PredictionAnswer,
  PredictionEntry,
  TopicPrediction,
} from "./content.ts";
import { isObject, type RecordField } from "../../contracts/records.ts";

export function isChoice(
  prediction: TopicPrediction,
): prediction is ChoicePrediction {
  return prediction.kind === undefined || prediction.kind === "choice";
}

const sameSet = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length &&
  [...a].sort().every((v, i) => v === [...b].sort()[i]);

/** Every group has at least one picked atom and no picked atom lies outside the groups. */
export function designAtomsRight(
  prediction: { groups: readonly (readonly number[])[] },
  atoms: readonly number[],
) {
  return (
    prediction.groups.every((group) => group.some((i) => atoms.includes(i))) &&
    atoms.every((i) => prediction.groups.some((group) => group.includes(i)))
  );
}

export function predictionCorrect(
  prediction: TopicPrediction,
  answer: PredictionAnswer,
): boolean {
  if (isChoice(prediction))
    return (
      "option" in answer &&
      (answer.option === prediction.answer ||
        (prediction.alsoCorrect ?? []).includes(answer.option))
    );
  if (prediction.kind === "atom-set")
    return (
      "sets" in answer &&
      answer.sets.length === prediction.molecules.length &&
      (prediction.gradeAtoms === false ||
        prediction.molecules.every((molecule, i) =>
          sameSet(molecule.answer, answer.sets[i]),
        )) &&
      (prediction.options === undefined ||
        answer.choice === prediction.optionAnswer)
    );
  if (prediction.kind === "design")
    return (
      "atoms" in answer &&
      answer.option === prediction.answer &&
      designAtomsRight(prediction, answer.atoms)
    );
  if (prediction.kind === "image-points")
    return (
      "point" in answer &&
      prediction.answer.includes(answer.point) &&
      (prediction.options === undefined ||
        answer.choice === prediction.optionAnswer)
    );
  if (prediction.kind === "ranking")
    return "ranking" in answer && answer.ranking[0] === prediction.answer;
  if (prediction.kind === "number")
    return (
      "value" in answer &&
      prediction.answer !== undefined &&
      Math.abs(answer.value - prediction.answer) <= (prediction.tolerance ?? 0)
    );
  if (prediction.kind === "arrows")
    return (
      "from" in answer &&
      answer.from === prediction.answer.from &&
      answer.to === prediction.answer.to &&
      (prediction.options === undefined ||
        answer.choice === prediction.optionAnswer)
    );
  if (!("selected" in answer)) return false;
  const picks = answer.selected;
  const [min, max] = selectionRange(prediction);
  if (picks.length < min || picks.length > max) return false;
  if (prediction.match === "subset" || max === 1)
    return picks.every((i) => prediction.answer.includes(i));
  return sameSet(picks, prediction.answer);
}

/** A saved answer to a graded prediction that is wrong; a number readout without an answer is never wrong. */
export function predictionMistaken(
  prediction: TopicPrediction,
  answer: PredictionAnswer | undefined,
) {
  return (
    answer !== undefined &&
    !(prediction.kind === "number" && prediction.answer === undefined) &&
    !predictionCorrect(prediction, answer)
  );
}

/** How many picks a structure prediction takes: `[min, max]`, one by default. */
export function selectionRange(prediction: TopicPrediction): [number, number] {
  if (prediction.kind !== "atoms" && prediction.kind !== "bonds") return [1, 1];
  const min = prediction.minSelections ?? 1;
  return [min, prediction.maxSelections ?? min];
}

/** The records a gate reads: predictions, and the quiz answers a quiz gate waits for. */
export interface GateRecords {
  predictions: Readonly<Record<string, PredictionAnswer>>;
  answers: Readonly<Record<string, number>>;
  diagnostic: Readonly<Record<string, number>>;
}

/** True once the reader has answered the prediction; a matrix needs every required cell, a quiz gate every question. */
export function predictionAnswered(
  entry: PredictionEntry,
  records: GateRecords,
) {
  if (entry.prediction.kind === "quiz") {
    const bank = entry.prediction.diagnostic
      ? records.diagnostic
      : records.answers;
    return entry.prediction.questions.every((id) => bank[id] !== undefined);
  }
  const answer = records.predictions[entry.id];
  if (answer === undefined) return false;
  if (entry.prediction.kind === "matrix")
    return "cells" in answer && entry.prediction.model.isComplete(answer.cells);
  return true;
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

/** Records in `predictions`: one answer per prediction id, matching that prediction. */
export function predictionField(
  predictions: readonly PredictionEntry[],
): RecordField<Record<string, PredictionAnswer>> {
  return {
    empty: () => ({}),
    parse(value) {
      if (value === undefined) return {};
      if (!isObject(value)) throw new Error("预测记录格式错误");
      const next: Record<string, PredictionAnswer> = {};
      for (const [id, entry] of Object.entries(value)) {
        const prediction = predictions.find(
          (item) => item.id === id,
        )?.prediction;
        if (!prediction || !isObject(entry) || prediction.kind === "quiz")
          throw new Error("预测记录格式错误");
        if (prediction.kind === "matrix") {
          const { cells } = entry;
          if (!isObject(cells)) throw new Error("预测记录格式错误");
          const { model } = prediction;
          const kept: Record<string, number> = {};
          for (const [cell, pick] of Object.entries(cells)) {
            if (
              !model.required.includes(cell) ||
              !index(pick) ||
              pick >= model.choices.length
            )
              throw new Error("预测选项无效");
            kept[cell] = pick;
          }
          next[id] = { cells: kept };
        } else if (isChoice(prediction)) {
          const { option } = entry;
          if (!index(option) || option >= prediction.options.length)
            throw new Error("预测选项无效");
          next[id] = { option };
        } else if (prediction.kind === "atom-set") {
          const { sets } = entry;
          if (
            !Array.isArray(sets) ||
            sets.length !== prediction.molecules.length ||
            !sets.every(
              (set, i) =>
                Array.isArray(set) &&
                set.length > 0 &&
                set.every(below(prediction.molecules[i].atoms)),
            )
          )
            throw new Error("预测选项无效");
          const kept = { sets: sets.map((set: number[]) => [...set]) };
          if (prediction.options) {
            const { choice } = entry;
            if (!index(choice) || choice >= prediction.options.length)
              throw new Error("预测选项无效");
            next[id] = { ...kept, choice };
          } else next[id] = kept;
        } else if (prediction.kind === "design") {
          const { atoms, option } = entry;
          if (
            !Array.isArray(atoms) ||
            atoms.length === 0 ||
            !atoms.every(below(prediction.molecule.atoms)) ||
            !index(option) ||
            option >= prediction.options.length
          )
            throw new Error("预测选项无效");
          next[id] = { atoms: [...atoms], option };
        } else if (prediction.kind === "image-points") {
          const { point, choice } = entry;
          if (
            typeof point !== "string" ||
            !prediction.points.some((item) => item.id === point)
          )
            throw new Error("预测选项无效");
          if (prediction.options) {
            if (!index(choice) || choice >= prediction.options.length)
              throw new Error("预测选项无效");
            next[id] = { point, choice };
          } else next[id] = { point };
        } else if (prediction.kind === "ranking") {
          const { ranking } = entry;
          const n = prediction.options.length;
          if (
            !Array.isArray(ranking) ||
            ranking.length !== n ||
            !ranking.every(index) ||
            new Set(ranking).size !== n ||
            ranking.some((i) => i >= n)
          )
            throw new Error("预测选项无效");
          next[id] = { ranking: [...ranking] };
        } else if (prediction.kind === "number") {
          const { value: number } = entry;
          if (typeof number !== "number" || !Number.isFinite(number))
            throw new Error("预测选项无效");
          next[id] = { value: number };
        } else if (prediction.kind === "arrows") {
          const { from, to, choice } = entry;
          if (!index(from) || !index(to) || from === to)
            throw new Error("预测选项无效");
          if (prediction.options) {
            if (!index(choice) || choice >= prediction.options.length)
              throw new Error("预测选项无效");
            next[id] = { from, to, choice };
          } else next[id] = { from, to };
        } else {
          const { selected } = entry;
          const [min, max] = selectionRange(prediction);
          if (
            !Array.isArray(selected) ||
            selected.length < min ||
            selected.length > max ||
            !selected.every(below(prediction.molecule[prediction.kind])) ||
            new Set(selected).size !== selected.length
          )
            throw new Error("预测选项无效");
          next[id] = { selected: [...selected] };
        }
      }
      return next;
    },
  };
}
