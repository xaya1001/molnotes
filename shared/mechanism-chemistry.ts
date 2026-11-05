import type { ChemistryToolkit } from "../src/ui/chemistry/rdkit.ts";
import { abbreviatedGroups } from "./molecule-abbreviations.ts";
import { anchorMaps, type MechanismFrame } from "./mechanism.ts";

/** Validate map identities against the original graph, before any depiction folding. */
export function validateMechanismChemistry(
  toolkit: ChemistryToolkit,
  frames: readonly MechanismFrame[],
  where: string,
) {
  const elements = new Map<number, number>();
  for (const [index, frame] of frames.entries()) {
    const at = `${where} frame ${index + 1}`;
    const bonds = new Set<string>(),
      charges = new Map<number, number>(),
      hidden = new Set<number>();
    for (const m of frame.molecules) {
      const mol = toolkit.get_mol(m.smiles);
      try {
        if (!mol || !mol.is_valid())
          throw new Error(`${at}: invalid SMILES in ${m.id}`);
        if (mol.get_num_atoms() !== m.atomMap.length)
          throw new Error(`${at}: ${m.id} atomMap count differs from SMILES`);
        const graph: {
          defaults: { atom: { z: number; chg: number } };
          molecules: {
            atoms: { z?: number; chg?: number }[];
            bonds: { atoms: [number, number] }[];
          }[];
        } = JSON.parse(mol.get_json());
        const data = graph.molecules[0];
        data.atoms.forEach((a, i) => {
          const id = m.atomMap[i],
            element = a.z ?? graph.defaults.atom.z;
          if (elements.has(id) && elements.get(id) !== element)
            throw new Error(`${at}: atom map ${id} changes element`);
          elements.set(id, element);
          charges.set(id, a.chg ?? graph.defaults.atom.chg ?? 0);
        });
        data.bonds.forEach((b) =>
          bonds.add(bondKey(b.atoms.map((i) => m.atomMap[i]))),
        );
        for (const g of abbreviatedGroups(toolkit, mol, m.abbreviations, at))
          g.atoms.forEach((i) => hidden.add(m.atomMap[i]));
      } finally {
        mol?.delete();
      }
    }
    for (const arrow of frame.arrows)
      for (const end of [arrow.from, arrow.to]) {
        if (anchorMaps(end).some((id) => hidden.has(id)))
          throw new Error(`${at}: arrow references an abbreviated atom`);
        if ("bond" in end && !bonds.has(bondKey(end.bond)))
          throw new Error(`${at}: unknown bond ${end.bond.join("-")}`);
        if ("charge" in end && (charges.get(end.charge) ?? 0) >= 0)
          throw new Error(`${at}: arrow charge source must be negative`);
        if ("forming" in end && bonds.has(bondKey(end.forming)))
          throw new Error(`${at}: forming position already has a bond`);
      }
  }
}
export const bondKey = (atoms: readonly number[]) =>
  [...atoms].sort((a, b) => a - b).join("-");
