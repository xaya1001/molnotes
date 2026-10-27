import type Fixture from "../fixtures/content/sites/instruments/content.json";
type Block = (typeof Fixture)["chapters"][number]["blocks"][number];
// Keep the published sample and its record IDs intact. Only browser setup adds
// focused chapters so each interaction test mounts the blocks it exercises.
export function withInstrumentChapters(content: typeof Fixture) {
  const original = content.chapters.find(
    ({ id }: { id: string }) => id === "instruments",
  )!;
  const groups = {
    tabs: (block: Block) => block.type === "tabs",
    datasets: (block: Block) =>
      ["first-order-elimination", "assay-panel-ratio"].includes(
        block.model ?? "",
      ),
    readouts: (block: Block) => block.model === "route-ledger",
    atp: (block: Block) =>
      ["atp-competition", "atp-selectivity"].includes(block.model ?? ""),
    correlation: (block: Block) =>
      block.model === "assay-correlation" ||
      (block.type === "data-table" && block.label === "配对数据"),
    overlays: (block: Block) =>
      ["ternary-equilibrium", "degradation-recovery"].includes(
        block.model ?? "",
      ),
    chair: (block: Block) => block.model === "saturated-chair",
    radical: (block: Block) =>
      ["radical-selectivity", "radical-distribution"].includes(
        block.model ?? "",
      ),
    pka: (block: Block) =>
      ["enolates-pka-dmso", "enolates-pka-water"].includes(block.model ?? ""),
    hammett: (block: Block) =>
      ["strategy-hammett-sigma", "strategy-hammett-rate"].includes(
        block.model ?? "",
      ),
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
