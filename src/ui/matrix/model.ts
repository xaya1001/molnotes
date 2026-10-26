// Pure data layer of PredictionMatrix: rows (experiments or compounds) by
// columns (candidates), one claim per cell. A cell says what the source
// measured, in which system, where (figure or table, page) and in whose words;
// a cell nobody measured says so instead of being filled in as "no". The
// reader is asked about the cells in `required`, one by one, and the answers
// are choice positions kept by the caller.

import type { RecordField } from "../../contracts/records";

/**
 * How a result looks in the grid. `untested` is a cell the source did not
 * measure; the others tint the cell with the token of that name.
 */
export type MatrixTone =
  "success" | "accent" | "danger" | "evidence" | "untested";

export interface MatrixOutcome {
  id: string;
  label: string;
  tone: MatrixTone;
  /** The radio button's wording when it differs from the cell's, e.g. "原文没测" for a cell marked "未测". */
  choiceLabel?: string;
  /** How the count line names this outcome when the label alone is too short. */
  summary?: string;
}

export interface MatrixRow {
  id: string;
  label: string;
  /** Structure shown beside the evidence of a chosen cell. */
  smiles?: string;
}

export interface MatrixColumn {
  id: string;
  label: string;
  /** Full name, shown under the heading of a chosen cell. */
  full?: string;
}

export interface MatrixEvidence {
  /** Source number or id; the page decides how it is shown (`#source` slot). */
  source: number | string;
  /** Figure or table and page, e.g. "PDF 第 2 页，Fig. 1d". */
  locator: string;
  quote?: string;
}

export interface MatrixCell {
  row: string;
  column: string;
  /** An outcome id. */
  outcome: string;
  /** What was tested, e.g. "内源蛋白"; absent for an untested cell. */
  scope?: string;
  system?: string;
  evidence: readonly MatrixEvidence[];
  caveat?: string;
  /** What the source lacks; required for an untested cell. */
  gap?: string;
}

export interface MatrixInput {
  rows: readonly MatrixRow[];
  columns: readonly MatrixColumn[];
  outcomes: readonly MatrixOutcome[];
  /** Outcome ids the reader can pick, in the order of the radio buttons. */
  choices: readonly string[];
  /** Cell ids ("row:column") the reader is asked about. */
  required: readonly string[];
  cells: readonly MatrixCell[];
}

export interface MatrixModel extends MatrixInput {
  cellById(id: string): MatrixCell;
  outcomeOf(cell: MatrixCell): MatrixOutcome;
  /** True when the choice at that position is the outcome the source reports. */
  isCorrect(id: string, choice: number): boolean;
  /** True once every required cell has an answer; only then does the grid open. */
  isComplete(answers: Readonly<Record<string, number>>): boolean;
}

export const matrixCellId = (row: string, column: string) => `${row}:${column}`;

const tones: readonly string[] = [
  "success",
  "accent",
  "danger",
  "evidence",
  "untested",
];

function unique(ids: readonly string[], what: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${what}`);
}

export function defineMatrix(input: MatrixInput): MatrixModel {
  unique(
    input.rows.map((row) => row.id),
    "row id",
  );
  unique(
    input.columns.map((column) => column.id),
    "column id",
  );
  unique(
    input.outcomes.map((outcome) => outcome.id),
    "outcome id",
  );
  for (const outcome of input.outcomes)
    if (!tones.includes(outcome.tone))
      throw new Error(`Outcome ${outcome.id}: unknown tone ${outcome.tone}`);
  const outcomeById = new Map(input.outcomes.map((o) => [o.id, o]));
  for (const choice of input.choices)
    if (!outcomeById.has(choice)) throw new Error(`Unknown choice ${choice}`);
  unique(input.choices, "choice");

  const cells = new Map<string, MatrixCell>();
  for (const cell of input.cells) {
    const id = matrixCellId(cell.row, cell.column);
    if (
      !input.rows.some((row) => row.id === cell.row) ||
      !input.columns.some((column) => column.id === cell.column)
    )
      throw new Error(`Cell ${id}: unknown row or column`);
    if (cells.has(id)) throw new Error(`Duplicate cell ${id}`);
    const outcome = outcomeById.get(cell.outcome);
    if (!outcome)
      throw new Error(`Cell ${id}: unknown outcome ${cell.outcome}`);
    for (const item of cell.evidence)
      if (!item.locator)
        throw new Error(`Cell ${id}: evidence without locator`);
    if (outcome.tone === "untested") {
      if (!cell.gap) throw new Error(`Cell ${id}: untested without a gap`);
    } else if (!cell.evidence.length) {
      throw new Error(`Cell ${id}: measured without evidence`);
    }
    cells.set(id, cell);
  }
  for (const row of input.rows)
    for (const column of input.columns)
      if (!cells.has(matrixCellId(row.id, column.id)))
        throw new Error(`Missing cell ${matrixCellId(row.id, column.id)}`);

  const canAnswerUntested = input.choices.some(
    (choice) => outcomeById.get(choice)?.tone === "untested",
  );
  unique(input.required, "required cell");
  for (const id of input.required) {
    const cell = cells.get(id);
    if (!cell) throw new Error(`Required cell ${id} does not exist`);
    const outcome = outcomeById.get(cell.outcome)!;
    if (outcome.tone === "untested" && !canAnswerUntested)
      throw new Error(`Required cell ${id}: untested, but no choice says so`);
    if (!input.choices.includes(cell.outcome))
      throw new Error(`Required cell ${id}: its outcome is not a choice`);
  }

  const cellById = (id: string) => {
    const found = cells.get(id);
    if (!found) throw new Error(`Unknown matrix cell ${id}`);
    return found;
  };
  return {
    ...input,
    cellById,
    outcomeOf: (cell) => outcomeById.get(cell.outcome)!,
    isCorrect: (id, choice) => input.choices[choice] === cellById(id).outcome,
    isComplete: (answers) =>
      input.required.every((id) => answers[id] !== undefined),
  };
}

/**
 * The reader's picks as a topic-owned record field (`createTopicRecords`
 * `extras`): cell id to the position of the pick in `choices`. A stored pick
 * for an unknown cell or position is rejected, never dropped.
 */
export function matrixAnswersField(
  model: Pick<MatrixModel, "required" | "choices">,
  label = "预测矩阵",
): RecordField<Record<string, number>> {
  return {
    empty: () => ({}),
    parse(value) {
      if (value === undefined) return {};
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error(`${label}的预测记录格式错误`);
      const next: Record<string, number> = {};
      for (const [id, pick] of Object.entries(value)) {
        if (
          !model.required.includes(id) ||
          typeof pick !== "number" ||
          !Number.isInteger(pick) ||
          pick < 0 ||
          pick >= model.choices.length
        )
          throw new Error(`${label}的预测选项无效`);
        next[id] = pick;
      }
      return next;
    },
  };
}
