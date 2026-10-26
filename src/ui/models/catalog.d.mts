export type LabInput =
  | {
      id: string;
      label: string;
      kind: "number";
      /** A slider instead of a number field. */
      control?: "range";
      min: number;
      max: number;
      step?: number;
      unit?: string;
      default: number;
    }
  | {
      id: string;
      label: string;
      kind: "select";
      options: { value: string | number; label: string }[];
      default: string | number;
    };
export interface LabResult {
  /** Shown only after the reader presses the block's `reveal` button. */
  revealed?: Omit<LabResult, "revealed">;
  summary?: string;
  readouts?: { label: string; value: string }[];
  charts?: {
    title?: string;
    xLabel: string;
    yLabel: string;
    /** One line, or `series` for several lines and scattered readings. */
    points?: { x: number; y: number }[];
    series?: {
      name: string;
      points: { x: number; y: number }[];
      scatter?: boolean;
    }[];
    xDomain?: [number, number];
    yDomain?: [number, number];
  }[];
  tables?: {
    caption: string;
    columns: string[];
    rows: string[][];
    note?: string;
  }[];
}
export interface LabModel {
  inputs: LabInput[] | ((data: unknown) => LabInput[]);
  validateData?(data: unknown): void;
  /** Throws a reader-facing message for inputs it cannot answer. */
  run(values: Record<string, number | string>, data?: unknown): LabResult;
}
/** The models a `lab` block can run, by name. */
export const labModels: Record<string, LabModel>;

export function modelInputs(model: LabModel, data?: unknown): LabInput[];
