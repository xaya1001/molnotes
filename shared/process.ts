import { isFiniteNumber, isInteger, isList, isObject } from "./json.ts";

export interface ProcessStep {
  title: string;
  /** Short label above a transfer or blocked connection. */
  label?: string;
  text: string;
  state: string;
  kind: "transfer" | "local" | "blocked" | "exit";
  from: number;
  to: number;
  /** Node quantities after the step; null leaves the previous value in place. */
  amounts?: (number | null)[];
  /** A departure from the system, alone or following this step's action. */
  loss?: { node: number; label: string; amount?: number };
}
export interface ProcessData {
  title: string;
  label: string;
  nodes: { name: string; detail?: string }[];
  total?: { amount: number; unit: string; label: string };
  scenarios: { name: string; steps: ProcessStep[] }[];
}
export const formatAmount = (value: number) => String(Number(value.toFixed(2)));

/** Validate authored data at the content boundary, retaining its chapter/block location. */
export function validateProcess(
  value: unknown,
  where: string,
): asserts value is ProcessData {
  function check(ok: unknown, field: string): asserts ok {
    if (!ok) throw new Error(`${where} ${field}`);
  }
  function text(v: unknown, field: string) {
    check(typeof v === "string" && v.trim(), `${field} must be text`);
  }
  check(isObject(value), "process must be an object");
  text(value.title, "title");
  text(value.label, "label");
  const nodes = value.nodes;
  check(isList(nodes) && nodes.length > 0, "nodes must be nonempty");
  nodes.forEach((node, i) => {
    check(isObject(node), `node ${i + 1} must be an object`);
    text(node.name, `node ${i + 1} name`);
    if (node.detail !== undefined) text(node.detail, `node ${i + 1} detail`);
  });
  const total = value.total;
  let totalAmount: number | undefined;
  if (total !== undefined) {
    check(isObject(total), "total must be an object");
    check(
      isFiniteNumber(total.amount) && total.amount > 0,
      "total amount must be positive",
    );
    totalAmount = total.amount;
    text(total.unit, "total unit");
    text(total.label, "total label");
  }
  const scenarios = value.scenarios;
  check(
    isList(scenarios) && scenarios.length >= 1 && scenarios.length <= 2,
    "scenarios must contain one or two scenes",
  );
  scenarios.forEach((scenario, i) => {
    const at = `scenario ${i + 1}`;
    check(isObject(scenario), `${at} must be an object`);
    text(scenario.name, `${at} name`);
    check(
      isList(scenario.steps) && scenario.steps.length > 0,
      `${at} needs steps`,
    );
    let departed = 0;
    scenario.steps.forEach((step, j) => {
      const s = `${at} step ${j + 1}`;
      check(isObject(step), `${s} must be an object`);
      for (const field of ["title", "text", "state"])
        text(step[field], `${s} ${field}`);
      if (step.label !== undefined) text(step.label, `${s} label`);
      check(
        ["transfer", "local", "blocked", "exit"].includes(String(step.kind)),
        `${s} has unknown relation kind`,
      );
      for (const field of ["from", "to"]) {
        const index = step[field];
        check(
          isInteger(index) && index >= 0 && index < nodes.length,
          `${s} ${field} references an unknown node`,
        );
      }
      if (step.kind === "local" || step.kind === "exit")
        check(
          step.from === step.to,
          `${s} ${step.kind} must start and end at the same node`,
        );
      else
        check(step.from !== step.to, `${s} ${step.kind} needs different nodes`);
      if (total !== undefined || step.amounts !== undefined) {
        check(
          isList(step.amounts) &&
            step.amounts.length === nodes.length &&
            step.amounts.every(
              (n) => n === null || (isFiniteNumber(n) && n >= 0),
            ),
          `${s} amounts must list one nonnegative quantity or null per node`,
        );
      }
      if (step.kind === "exit")
        check(step.loss !== undefined, `${s} exit needs a loss`);
      if (step.loss !== undefined) {
        const loss = step.loss;
        check(isObject(loss), `${s} loss must be an object`);
        check(
          isInteger(loss.node) && loss.node >= 0 && loss.node < nodes.length,
          `${s} loss references an unknown node`,
        );
        text(loss.label, `${s} loss label`);
        if (total !== undefined || loss.amount !== undefined) {
          check(
            isFiniteNumber(loss.amount) && loss.amount >= 0,
            `${s} loss amount must be nonnegative`,
          );
          departed += loss.amount;
          if (totalAmount !== undefined)
            check(departed <= totalAmount, `${s} losses exceed total amount`);
        }
      }
    });
  });
}
