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
    const mechanism =
      entry.kind === "mechanism"
        ? entry
        : entry.kind === "reaction"
          ? entry.mechanism
          : undefined;
    const scenes = [
      ...(entry.kind === "reaction"
        ? [{ id: "scene", scene: entry.scene }]
        : []),
      ...(mechanism?.frames ?? []),
    ];
    for (const frame of scenes) {
      for (const arrow of frame.scene.arrows ?? []) {
        if (arrow.from.kind !== "charge") continue;
        const ref = arrow.from.at;
        const placement = frame.scene.molecules.find(
          (p) => p.id === ref.molecule,
        )!;
        const compound = entries[placement.compound];
        if (compound.kind !== "compound") continue;
        if (atomCharges(compound.id)[compound.atomIds.indexOf(ref.atom)] > 0)
          diagnostics.push({
            code: "POSITIVE_CHARGE_SOURCE",
            severity: "warning",
            object: entry.id,
            elements: [frame.id, arrow.id],
            message: "Electron arrow starts at a positive charge",
          });
      }
    }
    if (mechanism) {
      for (let i = 1; i < mechanism.frames.length; i++) {
        const previous = mechanism.frames[i - 1],
          current = mechanism.frames[i];
        const before = total(previous.scene),
          after = total(current.scene);
        if (before !== after)
          diagnostics.push({
            code: "FRAME_CHARGE_CHANGE",
            severity: "warning",
            object: entry.id,
            elements: [previous.id, current.id],
            message: `Total formal charge changes from ${before} to ${after}`,
            actual: after,
            required: before,
          });
      }
    }
  }
  return diagnostics;
}
