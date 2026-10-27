// Keep the published sample and its record IDs intact. Only browser setup adds
// focused chapters so each interaction test mounts the blocks it exercises.
import type { Unchecked } from "../../shared/unchecked.ts";
export function withInstrumentChapters(content: Unchecked) {
  const original = content.chapters.find(
    ({ id }: { id: string }) => id === "instruments",
  );
  const groups = {
    tabs: (block: Unchecked) => block.type === "tabs",
    datasets: (block: Unchecked) =>
      ["first-order-elimination", "assay-panel-ratio"].includes(block.model),
    readouts: (block: Unchecked) => block.model === "route-ledger",
    atp: (block: Unchecked) =>
      ["atp-competition", "atp-selectivity"].includes(block.model),
    correlation: (block: Unchecked) =>
      block.model === "assay-correlation" ||
      (block.type === "data-table" && block.label === "配对数据"),
    overlays: (block: Unchecked) =>
      ["ternary-equilibrium", "degradation-recovery"].includes(block.model),
    chair: (block: Unchecked) => block.model === "saturated-chair",
    radical: (block: Unchecked) =>
      ["radical-selectivity", "radical-distribution"].includes(block.model),
    pka: (block: Unchecked) =>
      ["enolates-pka-dmso", "enolates-pka-water"].includes(block.model),
    hammett: (block: Unchecked) =>
      ["strategy-hammett-sigma", "strategy-hammett-rate"].includes(block.model),
  };
  const chapters = Object.entries(groups).map(([id, includes], index) => ({
    ...original,
    id,
    title: id,
    number: index + 2,
    blocks: original.blocks.filter(includes),
  }));
  return {
    ...content,
    chapters: [...content.chapters, ...chapters],
    parts: [
      ...content.parts,
      { title: "聚焦交互", chapters: chapters.map(({ id }) => id) },
    ],
  };
}
