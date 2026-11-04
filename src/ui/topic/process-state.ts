import type { ProcessData, ProcessStep } from "../../../shared/process.ts";

export function processAmounts(
  data: ProcessData,
  steps: ProcessStep[],
  index: number,
  progress: number,
) {
  const amounts: (number | null)[] = data.nodes.map((_, i) =>
    i === 0 ? (data.total?.amount ?? null) : null,
  );
  for (const step of steps.slice(0, index + Number(progress >= 1))) {
    step.amounts?.forEach((amount, i) => {
      if (amount !== null) amounts[i] = amount;
    });
  }
  return amounts;
}
export function processLosses(
  steps: ProcessStep[],
  index: number,
  progress: number,
) {
  return steps
    .slice(0, index + Number(progress >= 1))
    .flatMap((step) => (step.loss ? [step.loss] : []));
}
