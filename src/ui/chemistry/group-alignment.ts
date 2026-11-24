import { shallowRef, watch } from "vue";
import { computeDefaultCoords } from "../../../shared/chemical-toolkit.ts";
import { loadChemistry, molecule, type MoleculeHandle } from "./rdkit.ts";
import {
  graphOf,
  hasLinearDepiction,
  linearCentres,
} from "../../../shared/chemical-library/chemistry.ts";

export function useGroupAlignment(smiles: () => readonly string[]) {
  const template = shallowRef<MoleculeHandle>();
  const ready = shallowRef(false);
  watch(
    () => JSON.stringify(smiles()),
    async (_, __, onCleanup) => {
      ready.value = false;
      template.value = undefined;
      let active = true;
      let core: MoleculeHandle | null = null;
      onCleanup(() => {
        active = false;
        core?.delete();
      });
      const inputs = smiles();
      if (inputs.length > 1) {
        try {
          const toolkit = await loadChemistry();
          if (!active) return;
          const list = new toolkit.MolList();
          const molecules: MoleculeHandle[] = [];
          try {
            for (const input of inputs) {
              const mol = molecule(toolkit, input);
              molecules.push(mol);
              list.append(mol);
            }
            const minimum =
              Math.min(...molecules.map((mol) => mol.get_num_atoms())) / 2;
            const linearCentre = molecules.some(
              (mol) => linearCentres(graphOf(mol)).length,
            );
            core = toolkit.get_mcs_as_mol(
              list,
              JSON.stringify({
                AtomCompare: "Any",
                BondCompare: linearCentre ? "Order" : "Any",
                RingMatchesRingOnly: true,
                CompleteRingsOnly: true,
              }),
            );
            if (core && core.get_num_atoms() >= minimum) {
              computeDefaultCoords(core);
              template.value = core;
            }
          } finally {
            list.delete();
            for (const mol of molecules) mol.delete();
          }
        } catch {
          // The individual views expose invalid inputs and chemistry load errors.
        }
      }
      if (active) ready.value = true;
    },
    { immediate: true },
  );
  return { template, ready };
}

export function alignMolecule(mol: MoleculeHandle, template?: MoleculeHandle) {
  if (graphOf(mol).conformers?.length) return;
  if (template) {
    mol.generate_aligned_coords(
      template,
      JSON.stringify({ acceptFailure: true }),
    );
    if (hasLinearDepiction(graphOf(mol))) return;
  }
  computeDefaultCoords(mol);
}
