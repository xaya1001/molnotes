import {
  matchMarkush,
  markushCoverage,
} from "../../../shared/patent-markush-chemistry.ts";
import type { Markush } from "../../../shared/patent-markush.ts";
import {
  loadChemistry,
  type ChemistryToolkit,
  type MoleculeHandle,
} from "../chemistry/rdkit.ts";
export async function substructureMatches(
  query: string,
  rows: { id: string | number; smiles: string }[],
) {
  const toolkit = await loadChemistry();
  let pattern: MoleculeHandle | null = null;
  try {
    try {
      pattern = toolkit.get_qmol(query);
    } catch {
      throw new Error("无法解析结构，请输入有效的 SMILES 或 SMARTS。");
    }
    if (!pattern)
      throw new Error("无法解析结构，请输入有效的 SMILES 或 SMARTS。");
    return matchRows(toolkit, pattern, rows);
  } finally {
    pattern?.delete();
  }
}
function matchRows(
  toolkit: ChemistryToolkit,
  pattern: MoleculeHandle,
  rows: { id: string | number; smiles: string }[],
) {
  const matches = new Set<string>();
  for (const row of rows) {
    if (!row.smiles) continue;
    const mol = toolkit.get_mol(row.smiles);
    try {
      if (mol && mol.get_substruct_match(pattern) !== "{}")
        matches.add(String(row.id));
    } finally {
      mol?.delete();
    }
  }
  return matches;
}
export async function checkScopes(
  smiles: string,
  scopes: { id: number; markush?: Markush }[],
) {
  const toolkit = await loadChemistry();
  try {
    return Object.fromEntries(
      scopes.map((scope) => [
        scope.id,
        matchMarkush(toolkit, smiles, scope.markush),
      ]),
    );
  } catch {
    throw new Error("无法解析 SMILES，请检查原子、键和括号。");
  }
}
export async function scopeCoverage(
  model: Markush,
  rows: { id: string | number; smiles: string }[],
) {
  return markushCoverage(await loadChemistry(), model, rows);
}
