import type { ChemicalToolkit as MainModule } from "../chemical-toolkit.ts";
import { mappedDummies, substituteProduct } from "../reaction-chemistry.ts";
import { openMolecule, unmappedMolecule } from "./chemistry.ts";
import type { Compound, Library } from "./types.ts";
/** Expand mapped R sites using explicitly allowed compound references. */
export function instantiateTemplate(
  toolkit: MainModule,
  template: Compound,
  selections: Record<string, string>,
  library: Library,
) {
  const mol = openMolecule(toolkit, template.smiles);
  try {
    const maps = mappedDummies(mol);
    const substituents: Record<string, string> = {};
    const sites = template.template ?? [];
    if (Object.keys(selections).length !== sites.length)
      throw new Error(`${template.id}: select every template site`);
    for (const site of sites) {
      const selected = selections[site.atom];
      if (!site.allowed.includes(selected))
        throw new Error(
          `${template.id}: substituent not allowed at ${site.atom}`,
        );
      const compound = library[selected];
      if (compound?.kind !== "compound")
        throw new Error(`${template.id}: missing substituent ${selected}`);
      if (!compound.attachment)
        throw new Error(
          `${template.id}: substituent requires an explicit attachment`,
        );
      const map = maps.find((m) => template.atomIds[m.atom] === site.atom)?.map;
      if (!map) throw new Error(`${template.id}: R site requires an atom map`);
      substituents[String(map)] = compound.smiles;
    }
    const result = openMolecule(
      toolkit,
      substituteProduct(toolkit, template.smiles, substituents),
    );
    try {
      const clean = unmappedMolecule(toolkit, result);
      try {
        return clean.get_smiles();
      } finally {
        clean.delete();
      }
    } finally {
      result.delete();
    }
  } finally {
    mol.delete();
  }
}
