// The loader module (and both RDKit assets) is fetched only by a mounted consumer.
export interface MoleculeHandle {
  get_substruct_match(query: MoleculeHandle): string;
  get_num_atoms(): number;
  get_num_bonds(): number;
  get_svg_with_highlights(options: string): string;
  get_descriptors(): string;
  get_json(): string;
  delete(): void;
}
export interface ChemistryToolkit {
  get_mol(smiles: string): MoleculeHandle | null;
  get_qmol(smarts: string): MoleculeHandle | null;
}
export async function loadChemistry(): Promise<ChemistryToolkit> {
  return (await import("./runtime")).loadToolkit();
}
export function molecule(toolkit: ChemistryToolkit, smiles: string) {
  const mol = toolkit.get_mol(smiles);
  if (!mol) throw new Error("无法解析 SMILES");
  return mol;
}
export function properties(toolkit: ChemistryToolkit, smiles: string) {
  const mol = molecule(toolkit, smiles);
  try {
    const values = JSON.parse(mol.get_descriptors());
    const keys = [
      "amw",
      "CrippenClogP",
      "tpsa",
      "NumHBD",
      "NumHBA",
      "NumRotatableBonds",
    ] as const;
    for (const key of keys) {
      if (typeof values[key] !== "number" || !Number.isFinite(values[key]))
        throw new Error(`RDKit 性质缺失：${key}`);
    }
    return {
      mw: Number(values.amw),
      logP: Number(values.CrippenClogP),
      tpsa: Number(values.tpsa),
      donors: Number(values.NumHBD),
      acceptors: Number(values.NumHBA),
      rotatable: Number(values.NumRotatableBonds),
    };
  } finally {
    mol.delete();
  }
}
