import type {
  ChemistryToolkit,
  MoleculeHandle,
} from "../src/ui/chemistry/rdkit.ts";

// The first query atom is the attachment outside the group. A match must have
// exactly that one external bond, so a larger substituent cannot be truncated.
export const abbreviationSmarts = {
  Boc: "*C(=O)OC(C)(C)C",
  Cbz: "*C(=O)OCc1ccccc1",
  Fmoc: "*C(=O)OCC1c2ccccc2-c2ccccc21",
  Ts: "*S(=O)(=O)c1ccc(C)cc1",
  Ms: "*S(=O)(=O)C",
  Tf: "*S(=O)(=O)C(F)(F)F",
  OTMS: "*O[Si](C)(C)C",
  TMS: "*[Si](C)(C)C",
  TBS: "*[Si](C)(C)C(C)(C)C",
  TIPS: "*[Si](C(C)C)(C(C)C)C(C)C",
  Bn: "*Cc1ccccc1",
  PMB: "*Cc1ccc(OC)cc1",
  Ac: "*C(=O)C",
  Bz: "*C(=O)c1ccccc1",
  Piv: "*C(=O)C(C)(C)C",
  Ph: "*c1ccccc1",
  "CO₂Me": "*C(=O)OC",
  "CO₂Et": "*C(=O)OCC",
  "CO₂tBu": "*C(=O)OC(C)(C)C",
  OMe: "*OC",
  OEt: "*OCC",
  "CF₃": "*C(F)(F)F",
} as const;
export type MoleculeAbbreviation = keyof typeof abbreviationSmarts;

export function validateAbbreviations(
  value: unknown,
  where: string,
): asserts value is MoleculeAbbreviation[] | undefined {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.some(
      (name) =>
        typeof name !== "string" || !Object.hasOwn(abbreviationSmarts, name),
    )
  )
    throw new Error(`${where}: abbreviations must list shared whitelist names`);
}

export interface AbbreviatedGroup {
  name: MoleculeAbbreviation;
  attachment: number;
  bond: number;
  /** All original atom indices, including the atom replaced by the label. */
  atoms: number[];
  /** Original bond indices internal to the group. */
  bonds: number[];
}

/** Resolve once against the original graph; drawing and publication use the same matches. */
export function abbreviatedGroups(
  toolkit: ChemistryToolkit,
  mol: MoleculeHandle,
  names: readonly MoleculeAbbreviation[] = [],
  where = "molecule",
): AbbreviatedGroup[] {
  validateAbbreviations(names, where);
  if (!names.length) return [];
  const graph: { molecules: { bonds: { atoms: [number, number] }[] }[] } =
    JSON.parse(mol.get_json());
  const edges = graph.molecules[0].bonds;
  const candidates: AbbreviatedGroup[] = [];
  for (const name of new Set(names)) {
    const query = toolkit.get_qmol(abbreviationSmarts[name]);
    if (!query) throw new Error(`Invalid abbreviation query: ${name}`);
    try {
      const matches: { atoms: number[] }[] = JSON.parse(
        mol.get_substruct_matches(query),
      );
      for (const match of Array.isArray(matches) ? matches : []) {
        const atoms = match.atoms.slice(1);
        const set = new Set(atoms);
        const internal: number[] = [],
          external: number[] = [];
        edges.forEach(({ atoms: [a, b] }, i) => {
          if (set.has(a) && set.has(b)) internal.push(i);
          else if (set.has(a) !== set.has(b)) external.push(i);
        });
        if (external.length !== 1) continue;
        const bond = edges[external[0]].atoms;
        if (!bond.includes(match.atoms[0]) || !bond.includes(atoms[0]))
          continue;
        candidates.push({
          name,
          attachment: match.atoms[0],
          bond: external[0],
          atoms,
          bonds: internal,
        });
      }
    } finally {
      query.delete();
    }
  }
  // A declared larger group owns its atoms before any nested substituent.
  candidates.sort((a, b) => b.atoms.length - a.atoms.length);
  const folded = new Set<number>(),
    groups: AbbreviatedGroup[] = [];
  for (const group of candidates) {
    if (group.atoms.some((i) => folded.has(i))) continue;
    group.atoms.forEach((i) => folded.add(i));
    groups.push(group);
  }
  for (const name of new Set(names))
    if (!groups.some((group) => group.name === name))
      throw new Error(
        `${where}: abbreviation ${name} has no non-overlapping terminal group in SMILES`,
      );
  return groups;
}

/** Reject references to collapsed atoms, and to bonds with a collapsed endpoint. */
export function validateAbbreviatedReferences(
  mol: MoleculeHandle,
  groups: readonly AbbreviatedGroup[],
  context: Record<string, unknown>,
  where: string,
) {
  if (!groups.length) return;
  const folded = new Set(groups.flatMap((group) => group.atoms));
  const graph: { molecules: { bonds: { atoms: number[] }[] }[] } = JSON.parse(
    mol.get_json(),
  );
  const bonds = graph.molecules[0].bonds;
  const check = (value: unknown, kind: "atoms" | "bonds", path: string) => {
    if (!Array.isArray(value)) return;
    for (const index of value)
      if (
        typeof index === "number" &&
        (kind === "atoms"
          ? folded.has(index)
          : bonds[index]?.atoms.some((i) => folded.has(i)))
      )
        throw new Error(
          `${where}.${path}: ${kind} index ${index} references an abbreviated atom`,
        );
  };
  check(context.highlightAtoms, "atoms", "highlightAtoms");
  check(context.highlightBonds, "bonds", "highlightBonds");
  check(context.anchorAtoms, "atoms", "anchorAtoms");
  check(context.selectable, "atoms", "selectable");
  if (context.labels && typeof context.labels === "object")
    check(Object.keys(context.labels).map(Number), "atoms", "labels");
  if (["atoms", "bonds", "atom-set"].includes(String(context.kind)))
    check(
      context.answer,
      context.kind === "bonds" ? "bonds" : "atoms",
      "answer",
    );
  if (Array.isArray(context.groups))
    context.groups.forEach((group, i) => check(group, "atoms", `groups[${i}]`));
  if (
    context.kind === "arrows" &&
    context.answer &&
    typeof context.answer === "object"
  )
    check(Object.values(context.answer), "atoms", "answer");
  if (Array.isArray(context.arrows))
    context.arrows.forEach((arrow, i) => {
      for (const side of ["from", "to"])
        if (arrow?.[side]) {
          check([arrow[side].atom], "atoms", `arrows[${i}].${side}`);
          check([arrow[side].bond], "bonds", `arrows[${i}].${side}`);
        }
    });
}
