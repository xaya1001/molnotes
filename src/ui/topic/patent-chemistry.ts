import {
  loadChemistry,
  type ChemistryToolkit,
  type MoleculeHandle,
} from "../chemistry/rdkit";
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
  scopes: { id: number; smarts?: string }[],
) {
  const toolkit = await loadChemistry();
  let mol: MoleculeHandle | null;
  try {
    mol = toolkit.get_mol(smiles);
  } catch {
    throw new Error("无法解析 SMILES，请检查原子、键和括号。");
  }
  if (!mol) throw new Error("无法解析 SMILES，请检查原子、键和括号。");
  try {
    const result: Record<
      number,
      { status: "matched" | "not-matched" | "unmodeled" }
    > = {};
    for (const scope of scopes) {
      if (!scope.smarts) {
        result[scope.id] = { status: "unmodeled" };
        continue;
      }
      const query = toolkit.get_qmol(scope.smarts);
      if (!query) throw new Error("范围定义无法解析");
      try {
        result[scope.id] = {
          status:
            mol.get_substruct_match(query) === "{}" ? "not-matched" : "matched",
        };
      } finally {
        query.delete();
      }
    }
    return result;
  } finally {
    mol.delete();
  }
}
