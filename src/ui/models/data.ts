/** Topic datasets used by the lab catalogue, checked by each model at publication. */
import type { DataTableInput } from "../data/values.ts";
export interface AtpData {
  variants: string[];
  inhibitors: string[];
  inhibitorLabels: Record<string, string>;
  kd: Record<string, Record<string, { value: number; sd: number }>>;
  km: Record<string, { value: number; sd: number }>;
  atpSteps: number[];
  comparisonAtp: number[];
  defaultStep: number;
  roles: { reference: string; numerator: string; denominator: string };
  parameterCaption: string;
  comparisonCaption: string;
  referenceWarning: string;
  parameterColumns: string[];
  comparisonColumns: string[];
}
export interface PanelData {
  caption: string;
  endpoints: { value: string; label: string; columns: string[] }[];
  ratio: { numerator: number; denominator: number };
  rows: ({ name: string } & Record<string, string | number[]>)[];
}
export interface EliminationData {
  presets: {
    name: string;
    label: string;
    halfLife: number;
    source: string | number;
  }[];
}
export interface RadicalAlkane {
  id: string;
  name: string;
  counts: Partial<Record<string, number>>;
  products: Partial<Record<string, string>>;
}
export interface RadicalShare {
  op: string;
  value: number;
}
export interface RadicalMeasurement {
  alkane: string;
  halogen: string;
  page: string;
  condition: string;
  note: string;
  shares: Partial<Record<string, RadicalShare>>;
}
export interface RadicalData {
  sourceLabel: string;
  alkanes: RadicalAlkane[];
  halogens: {
    id: string;
    label: string;
    source: string;
    offered: Record<string, { kind: string; value?: number; alkane?: string }>;
  }[];
  measured: RadicalMeasurement[];
  defaults: { estimateAlkane: string; offeredAlkane: string; halogen: string };
}
export interface ChairData {
  referenceLabel: string;
  referenceTemperature: number;
  defaultDeltaG: number;
  rows: {
    substituent: string;
    deltaG: number;
    k: number;
    percent: number;
    lowerBound?: boolean;
  }[];
}
export interface PkaReading {
  value: number;
  source: string;
}
export interface PkaEntry {
  id: string;
  label: string;
  name?: string;
  acid?: string;
  values: Partial<Record<string, PkaReading[]>>;
}
export interface PkaData {
  donors: PkaEntry[];
  bases: PkaEntry[];
  defaults: Record<string, string>;
}
export interface HammettData {
  referencePka: number;
  substituents: {
    id: string;
    name: string;
    pkaPara: number;
    pkaMeta: number;
    sigmaPara: number;
    sigmaMeta: number;
  }[];
  reactions: { id: string; name: string; rho: number }[];
  defaults: {
    subId: string;
    reaction: string;
    sigmaPosition: string;
    ratePosition: string;
  };
}
export interface RouteData {
  inputLabel: string;
  routes: {
    title: string;
    claimedText: string;
    claimed: number;
    steps: { name: string; note: string; yield: number; assumed?: boolean }[];
  }[];
  mass: {
    title: string;
    claimed: number;
    startFormula: string;
    productFormula: string;
    startGrams: number;
    startMol: number;
    productGrams: number;
  };
}
export interface AtpSelectivityData {
  variants: { name: string; kd: number; km: number }[];
  comparison: { numerator: string; denominator: string };
  caption: string;
  columns: string[];
}

export interface CorrelationData extends DataTableInput {
  correlation: {
    defaultX: string;
    defaultY: string;
    cohort: { keys: string[]; description: string };
  };
}
