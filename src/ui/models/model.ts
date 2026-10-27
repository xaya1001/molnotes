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
export type LabValues = Record<string, number | string>;
/** A model with fixed controls and no external dataset. */
export interface LabModel {
  inputs: LabInput[];
  run(values: LabValues, data?: unknown): LabResult;
}
/** Data is narrowed by the model's existing content validator before it is bound. */
export interface DataLabModel<Data> {
  inputs: LabInput[] | ((data: Data) => LabInput[]);
  validateData(data: unknown): asserts data is Data;
  run(values: LabValues, data: Data): LabResult;
}
export interface BoundLab {
  inputs: LabInput[];
  run(values: LabValues): LabResult;
}
export type LabEntry = (data?: unknown) => BoundLab;
export function lab(model: LabModel): LabEntry;
export function lab<Data>(model: DataLabModel<Data>): LabEntry;
export function lab<Data>(model: LabModel | DataLabModel<Data>): LabEntry {
  return (data) => {
    if (!("validateData" in model))
      return { inputs: model.inputs, run: (values) => model.run(values, data) };
    const validate: (value: unknown) => asserts value is Data =
      model.validateData.bind(model);
    validate(data);
    return {
      inputs:
        typeof model.inputs === "function" ? model.inputs(data) : model.inputs,
      run: (values) => model.run(values, data),
    };
  };
}
/** Resolve controls after checking and binding the model's content data. */
export function modelInputs(model: LabEntry, data?: unknown): LabInput[] {
  return model(data).inputs;
}
