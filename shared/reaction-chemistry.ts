import { layoutProblems } from "./molecule-layout.ts";
import type { MainModule, Mol } from "@rdkit/rdkit";
import { abbreviationSmarts } from "./molecule-abbreviations.ts";
import type { SubstrateScope, SynthesisRoute } from "./reaction-scheme.ts";

export type SchemeToolkit = Pick<
  MainModule,
  "get_mol" | "get_qmol" | "MolList" | "get_mcs_as_smarts"
>;
function parse(toolkit: Pick<MainModule, "get_mol">, smiles: string) {
  const mol = toolkit.get_mol(smiles);
  if (!mol) throw new Error("Invalid SMILES");
  return mol;
}
export function mappedDummies(mol: Pick<Mol, "get_v3Kmolblock">) {
  const atoms = mol
    .get_v3Kmolblock()
    .split("M  V30 BEGIN ATOM\n")[1]
    .split("M  V30 END ATOM")[0];
  return atoms
    .trim()
    .split("\n")
    .flatMap((line) => {
      const fields = line.trim().split(/\s+/);
      return fields[3] === "R" || fields[3] === "*"
        ? [{ atom: Number(fields[2]) - 1, map: Number(fields[7]) }]
        : [];
    });
}
/** Coordinates keyed by content's compound number, without changing authored SMILES or atom order. */
export function alignScheme(toolkit: SchemeToolkit, route: SynthesisRoute) {
  const smiles: Record<string, string> = {};
  const warnings: string[] = [];
  const saved = new Map<string, Mol>();
  let reference: Mol | undefined;
  const largest = (mols: Mol[]) =>
    mols.reduce((a, b) => (a.get_num_atoms() >= b.get_num_atoms() ? a : b));
  const core = route.core ? toolkit.get_qmol(route.core) : null;
  try {
    if (route.core && !core)
      warnings.push(`${route.id}: invalid alignment core`);
    for (const [index, step] of route.steps.entries()) {
      for (const compound of [...step.reactants, ...step.products]) {
        if (saved.has(compound.number)) continue;
        let mol = parse(toolkit, compound.smiles);
        saved.set(compound.number, mol);
        if (!mol.has_coords()) mol.set_new_coords();
        if (!reference) {
          reference = mol;
          continue;
        }
        const defaultLayout = mol.get_v3Kmolblock();
        let smarts: string | undefined;
        const list = new toolkit.MolList();
        try {
          list.append(reference);
          list.append(mol);
          smarts =
            route.core ??
            toolkit.get_mcs_as_smarts(
              list,
              JSON.stringify({
                Timeout: 1,
                RingMatchesRingOnly: true,
                CompleteRingsOnly: true,
              }),
            );
          const query = toolkit.get_qmol(smarts);
          try {
            if (!query || query.get_num_atoms() < 2)
              throw new Error("no shared core");
            const before = JSON.parse(reference.get_substruct_match(query));
            const after = JSON.parse(mol.get_substruct_match(query));
            if (!before.atoms?.length || !after.atoms?.length)
              throw new Error("core not present");
            const result = JSON.parse(
              mol.generate_aligned_coords(
                reference,
                JSON.stringify({
                  referenceSmarts: smarts,
                  acceptFailure: false,
                  alignOnly: false,
                }),
              ),
            );
            if (!result.atoms?.length) throw new Error("alignment failed");
            if (layoutProblems(toolkit, mol.get_v3Kmolblock()).length)
              throw new Error("aligned drawing has overlaps");
          } finally {
            query?.delete();
          }
        } catch {
          mol.delete();
          mol = parse(toolkit, defaultLayout);
          // Preserve the default graph geometry, keeping its shared core's
          // orientation where a rigid alignment gives a clean drawing.
          if (smarts) {
            try {
              mol.generate_aligned_coords(
                reference,
                JSON.stringify({
                  referenceSmarts: smarts,
                  acceptFailure: false,
                  alignOnly: true,
                }),
              );
              if (layoutProblems(toolkit, mol.get_v3Kmolblock()).length) {
                mol.delete();
                mol = parse(toolkit, defaultLayout);
              }
            } catch {
              mol.delete();
              mol = parse(toolkit, defaultLayout);
            }
          }
          saved.set(compound.number, mol);
          warnings.push(
            `${route.id} step ${index + 1}, compound ${compound.number}: core alignment failed or overlapped; using default layout`,
          );
        } finally {
          list.delete();
        }
      }
      reference = largest(step.products.map((m) => saved.get(m.number)!));
    }
    // get_cxsmiles canonicalizes atom order. Export a molblock instead, retaining
    // the authored parse order used by abbreviations and atom selections.
    for (const [number, mol] of saved) smiles[number] = mol.get_v3Kmolblock();
  } finally {
    for (const mol of saved.values()) mol.delete();
    core?.delete();
  }
  return { smiles, warnings };
}

function canonical(toolkit: Pick<MainModule, "get_mol">, smiles: string) {
  const mol = parse(toolkit, smiles);
  try {
    return mol.get_smiles();
  } finally {
    mol.delete();
  }
}
/** Join one terminal mapped dummy at a time. RDKit preserves the remaining graph and stereochemistry. */
export function substituteProduct(
  toolkit: MainModule,
  template: string,
  groups: Record<string, string>,
) {
  let current = parse(toolkit, template.replace(/\[\*:(\d+)\]/g, "[$1*]"));
  try {
    for (const [key, value] of Object.entries(groups)) {
      const abbreviation = Object.entries(abbreviationSmarts).find(
        ([name]) => name === value,
      )?.[1];
      const fragment =
        abbreviation ?? (value.startsWith("*") ? value : `*${value}`);
      const side = parse(toolkit, fragment);
      const reaction = toolkit.get_rxn(
        `[${key}#0:1]-[*:2].[#0:3]-[*:4]>>[*:2]-[*:4]`,
      );
      const list = new toolkit.MolList();
      try {
        const graph = JSON.parse(side.get_json()).molecules[0];
        const dummyAtoms = graph.atoms.flatMap(
          (a: { z?: number }, i: number) => (a.z === 0 ? [i] : []),
        );
        if (
          dummyAtoms.length !== 1 ||
          graph.bonds.filter((b: { atoms: number[] }) =>
            b.atoms.includes(dummyAtoms[0]),
          ).length !== 1 ||
          fragment.includes(".")
        )
          throw new Error(`R${key} needs a single terminal attachment`);
        if (!reaction) throw new Error("Invalid substitution reaction");
        list.append(current);
        list.append(side);
        const products = reaction.run_reactants(list, 2);
        try {
          if (products.size() !== 1)
            throw new Error(`R${key} substitution must produce one structure`);
          const group = products.get(0)!;
          try {
            const product = group.at(0)!;
            try {
              const next = parse(toolkit, product.get_smiles());
              current.delete();
              current = next;
            } finally {
              product.delete();
            }
          } finally {
            group.delete();
          }
        } finally {
          products.delete();
        }
      } finally {
        side.delete();
        reaction?.delete();
        list.delete();
      }
    }
    return current.get_smiles();
  } finally {
    current.delete();
  }
}
export function validateScopeProducts(
  toolkit: MainModule,
  scope: SubstrateScope,
  where: string,
) {
  const template = parse(toolkit, scope.scheme.products[0].smiles);
  try {
    const dummies = mappedDummies(template);
    const maps = dummies.map((d) => String(d.map)).sort();
    const keys = scope.groups.map((g) => g.key).sort();
    const graph = JSON.parse(template.get_json()).molecules[0];
    if (
      JSON.stringify(maps) !== JSON.stringify(keys) ||
      dummies.some(
        (d) =>
          graph.bonds.filter(
            (b: { atoms: number[]; bo?: number }) =>
              b.atoms.includes(d.atom) && (b.bo ?? 1) === 1,
          ).length !== 1,
      )
    )
      throw new Error(
        `${where}: template needs one terminal single-bond dummy per R column`,
      );
  } finally {
    template.delete();
  }
  for (const [index, row] of scope.rows.entries()) {
    try {
      const expected = substituteProduct(
        toolkit,
        scope.scheme.products[0].smiles,
        row.substituents,
      );
      if (
        canonical(toolkit, expected) !== canonical(toolkit, row.product.smiles)
      )
        throw new Error("product differs from substituted template");
    } catch (error) {
      throw new Error(
        `${where}.rows[${index}] (${row.number}): ${(error as Error).message}`,
      );
    }
  }
}
export function validateSchemeCompounds(
  toolkit: MainModule,
  route: SynthesisRoute,
  where: string,
) {
  const compounds = new Map<string, string>();
  for (const step of route.steps)
    for (const mol of [...step.reactants, ...step.products]) {
      const value = canonical(toolkit, mol.smiles);
      if (compounds.has(mol.number) && compounds.get(mol.number) !== value)
        throw new Error(
          `${where}: compound ${mol.number} names different structures`,
        );
      compounds.set(mol.number, value);
    }
}
