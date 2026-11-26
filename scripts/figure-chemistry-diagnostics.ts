import {
  drawnArrows,
  graphPanels,
} from "../shared/chemical-library/figure-layout.ts";
import type { FigureGraph } from "../shared/chemical-library/types.ts";
import type { ChemicalToolkit } from "../shared/chemical-toolkit.ts";
import type {
  Diagnostic,
  Library,
  Scene,
} from "../shared/chemical-library/types.ts";
import { graphOf } from "../shared/chemical-library/chemistry.ts";

/** Report charge changes and positive-charge electron sources without changing saved figures. */
export function figureChargeDiagnostics(
  entries: Library,
  toolkit: ChemicalToolkit,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const charges = new Map<string, number[]>();
  const atomCharges = (id: string) => {
    if (!charges.has(id)) {
      const compound = entries[id];
      if (compound.kind !== "compound") return [];
      const mol = toolkit.get_mol(compound.smiles);
      if (!mol) throw new Error(`${id}: invalid molecule`);
      try {
        charges.set(
          id,
          graphOf(mol).atoms.map((a) => a.chg ?? 0),
        );
      } finally {
        mol.delete();
      }
    }
    return charges.get(id)!;
  };
  const total = (scene: Scene) =>
    scene.molecules.reduce(
      (sum, p) => sum + atomCharges(p.compound).reduce((a, b) => a + b, 0),
      0,
    );
  for (const entry of Object.values(entries)) {
    if (entry.kind !== "figure") continue;
    const figureId = entry.id;
    function inspect(graph: FigureGraph, prefix = "") {
      const panels = graphPanels(graph);
      const scenes = [
        ...panels,
        ...drawnArrows(graph).map(([id, arrow]) => ({
          id,
          scene: arrow.drawing.scene,
        })),
        ...(graph.layout?.panel
          ? [{ id: "overview", scene: graph.layout.panel }]
          : []),
      ];
      for (const { id, scene } of scenes)
        for (const arrow of scene.arrows ?? []) {
          if (arrow.from.kind !== "charge") continue;
          const ref = arrow.from.at;
          const placement = scene.molecules.find((p) => p.id === ref.molecule)!;
          const compound = entries[placement.compound];
          if (compound.kind !== "compound") continue;
          if (atomCharges(compound.id)[compound.atomIds.indexOf(ref.atom)] > 0)
            diagnostics.push({
              code: "POSITIVE_CHARGE_SOURCE",
              severity: "warning",
              object: figureId,
              elements: [prefix + id, arrow.id],
              message: "Electron arrow starts at a positive charge",
            });
        }
      for (const [id, arrow] of Object.entries(graph.arrows)) {
        if (arrow.via) inspect(arrow.via, prefix + id + "/");
        if (
          arrow.role !== "elementary" ||
          arrow.kind === "none" ||
          arrow.from.length !== 1 ||
          arrow.to.length !== 1
        )
          continue;
        const from = panels.find(({ id }) => id === arrow.from[0].state);
        const to = panels.find(({ id }) => id === arrow.to[0].state);
        if (!from || !to) continue;
        const before = total(from.scene),
          after = total(to.scene);
        if (before !== after)
          diagnostics.push({
            code: "FRAME_CHARGE_CHANGE",
            severity: "warning",
            object: figureId,
            elements: [prefix + from.id, prefix + to.id],
            message: `Total formal charge changes from ${before} to ${after}`,
            actual: after,
            required: before,
          });
      }
    }
    inspect(entry.graph);
  }
  return diagnostics;
}
