import { inducedProximityModels } from "./induced-proximity.ts";
import { organicChemistryModels } from "./organic-chemistry.ts";
import { biochemicalKineticsModels } from "./biochemical-kinetics.ts";
import { medicinalChemistryModels } from "./medicinal-chemistry.ts";
// The models a `lab` block can run, by name. A model declares its inputs
// (what the reader can set, with the ranges the topic's figures stay valid
// for) and a pure `run` that turns the values into what the lab shows: a
// summary line, readouts, or series to plot. A model throws a reader-facing
// message for an input combination it cannot answer. The content check
// (shared/topic-blocks.ts) and the runtime share one catalogue.

import { lab, type LabModel, type LabEntry } from "./model.ts";
export { modelInputs } from "./model.ts";
export type {
  LabInput,
  LabResult,
  LabValues,
  LabModel,
  DataLabModel,
  BoundLab,
  LabEntry,
} from "./model.ts";

const plateCapacity: LabModel = {
  inputs: [
    {
      id: "capacity",
      label: "板容量",
      kind: "select",
      options: [24, 48, 96].map((n) => ({ value: n, label: `${n} 孔` })),
      default: 48,
    },
    {
      id: "acids",
      label: "酸构建块数",
      kind: "number",
      min: 1,
      max: 12,
      step: 1,
      default: 6,
    },
    {
      id: "amines",
      label: "胺构建块数",
      kind: "number",
      min: 1,
      max: 12,
      step: 1,
      default: 8,
    },
    {
      id: "controls",
      label: "过程对照孔数",
      kind: "number",
      min: 0,
      max: 96,
      step: 1,
      default: 4,
    },
  ],
  // Capacity bookkeeping only: one target per reaction well; controls reserve wells.
  run({ capacity, acids, amines, controls }) {
    if (typeof capacity !== "number" || ![24, 48, 96].includes(capacity))
      throw new Error("请选择 24、48 或 96 孔");
    if (
      typeof acids !== "number" ||
      typeof amines !== "number" ||
      typeof controls !== "number" ||
      ![acids, amines, controls].every(Number.isInteger) ||
      acids < 1 ||
      amines < 1 ||
      acids > 12 ||
      amines > 12 ||
      controls < 0 ||
      controls > capacity
    )
      throw new Error("构建块数量须为 1–12 的整数，对照孔须在板容量内");
    const targets = acids * amines;
    const available = capacity - controls;
    const batches = available ? Math.ceil(targets / available) : null;
    const verdict =
      targets <= available
        ? "一板可容纳。"
        : batches
          ? `需至少 ${batches} 板（每板保留同样对照）。`
          : "没有剩余目标孔，请减少对照或重新安排。";
    return { summary: `${targets} 个目标；可用 ${available} 孔。${verdict}` };
  },
};

export const labModels: Record<string, LabEntry> = {
  ...inducedProximityModels,
  ...organicChemistryModels,
  ...biochemicalKineticsModels,
  "plate-capacity": lab(plateCapacity),
  ...medicinalChemistryModels,
};
