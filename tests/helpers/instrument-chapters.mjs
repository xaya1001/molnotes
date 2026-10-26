// Keep the published sample and its record IDs intact. Only browser setup adds
// focused chapters so each interaction test mounts the blocks it exercises.
export function withInstrumentChapters(content) {
  const original = content.chapters.find(({ id }) => id === "instruments");
  const groups = {
    tabs: (block) => block.type === "tabs",
    datasets: (block) =>
      ["first-order-elimination", "assay-panel-ratio"].includes(block.model),
    readouts: (block) => block.model === "route-ledger",
    atp: (block) =>
      ["atp-competition", "atp-selectivity"].includes(block.model),
    correlation: (block) =>
      block.model === "assay-correlation" ||
      (block.type === "data-table" && block.label === "配对数据"),
    overlays: (block) =>
      ["ternary-equilibrium", "degradation-recovery"].includes(block.model),
    chair: (block) => block.model === "saturated-chair",
    radical: (block) =>
      ["radical-selectivity", "radical-distribution"].includes(block.model),
    pka: (block) =>
      ["enolates-pka-dmso", "enolates-pka-water"].includes(block.model),
    hammett: (block) =>
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
