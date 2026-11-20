import type { ChemicalToolkit } from "../chemical-toolkit.ts";
import { reagentAbbreviations } from "../molecule-abbreviations.ts";
import type { ChemicalGraph } from "./chemistry.ts";
import type { Compound } from "./types.ts";

type Reagent = (typeof reagentAbbreviations)[number];
const tables = new WeakMap<ChemicalToolkit, Map<string, Reagent>>();
function canonical(toolkit: ChemicalToolkit, smiles: string) {
  const mol = toolkit.get_mol(smiles.replace(/:\d+(?=\])/g, ""));
  if (!mol) throw new Error("Invalid reagent structure");
  try {
    return mol.get_smiles();
  } finally {
    mol.delete();
  }
}
export function reagentGroups(
  toolkit: ChemicalToolkit,
  compound: Compound,
  graph: ChemicalGraph,
  protectedAtoms: Set<string>,
) {
  let table = tables.get(toolkit);
  if (!table) {
    table = new Map(
      reagentAbbreviations.map((item) => [
        canonical(toolkit, item.smiles),
        item,
      ]),
    );
    tables.set(toolkit, table);
  }
  const remaining = new Set(graph.atoms.map((_, i) => i));
  const components: number[][] = [];
  while (remaining.size) {
    const first = remaining.values().next().value!;
    remaining.delete(first);
    const atoms = [first];
    for (let i = 0; i < atoms.length; i++)
      for (const bond of graph.bonds)
        if (bond.atoms.includes(atoms[i])) {
          const next = bond.atoms.find((n) => n !== atoms[i])!;
          if (remaining.delete(next)) atoms.push(next);
        }
    components.push(atoms.sort((a, b) => a - b));
  }
  return compound.smiles.split(".").flatMap((fragment, i) => {
    const reagent = table!.get(canonical(toolkit, fragment));
    const atoms = components[i];
    if (!reagent?.label || !atoms) return [];
    const candidates = atoms.filter(
      (a) => (graph.atoms[a].z ?? 6) === reagent.atom,
    );
    const root =
      candidates.find((a) => graph.atoms[a].chg) ??
      candidates.find((a) => graph.atoms[a].impHs) ??
      candidates[0];
    if (
      root === undefined ||
      atoms.some((a) => a !== root && protectedAtoms.has(compound.atomIds[a]))
    )
      return [];
    const bonds = graph.bonds.flatMap((bond, j) =>
      bond.atoms.every((a) => atoms.includes(a)) ? [j] : [],
    );
    return [{ label: reagent.label, root, atoms, bonds }];
  });
}
