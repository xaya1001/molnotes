import type { MainModule, Mol } from "@rdkit/rdkit";
// The loader module (and both RDKit assets) is fetched only by a mounted consumer.
export type MoleculeHandle = Mol;
export type ChemistryToolkit = Pick<
  MainModule,
  "get_mol" | "get_qmol" | "MolList" | "get_mcs_as_smarts"
>;
export async function loadChemistry(): Promise<ChemistryToolkit> {
  return (await import("./runtime.ts")).loadToolkit();
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
