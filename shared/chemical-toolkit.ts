/** The molecular operations shared by reader chemistry and publication tools. */
export interface ChemicalMolecule {
  copy(): ChemicalMolecule | null;
  delete(): void;
  is_valid(): boolean;
  has_coords(): number;
  get_num_atoms(heavyOnly?: boolean): number;
  get_json(): string;
  get_smiles(details?: string): string;
  get_cxsmiles(details?: string): string;
  get_smarts(details?: string): string;
  get_molblock(details?: string): string;
  get_v3Kmolblock(details?: string): string;
  get_v2Kmolblock(details?: string): string;
  get_svg_with_highlights(details: string): string;
  get_substruct_match(query: ChemicalMolecule, details?: string): string;
  get_substruct_matches(query: ChemicalMolecule, details?: string): string;
  set_new_coords(useCoordGen?: boolean): boolean;
  normalize_depiction(canonicalize?: number, scaleFactor?: number): number;
  straighten_depiction(minimizeRotation?: boolean): void;
  generate_aligned_coords(reference: ChemicalMolecule, details: string): string;
  add_hs_in_place(): boolean;
  remove_hs_in_place(details?: string): boolean;
}
export interface ChemicalMolList {
  append(mol: ChemicalMolecule): number;
  at(index: number): ChemicalMolecule | null;
  size(): number;
  delete(): void;
}
export interface ChemicalProducts {
  get(index: number): ChemicalMolList | undefined;
  size(): number;
  delete(): void;
}
export interface ChemicalReaction {
  run_reactants(
    reactants: ChemicalMolList,
    maxProducts: number,
  ): ChemicalProducts;
  delete(): void;
}
export interface ChemicalToolkit {
  get_mol(input: string, details?: string): ChemicalMolecule | null;
  get_qmol(input: string): ChemicalMolecule | null;
  get_rxn(input: string): ChemicalReaction | null;
  MolList: new () => ChemicalMolList;
  get_mcs_as_smarts(mols: ChemicalMolList, details?: string): string;
  get_mcs_as_json(mols: ChemicalMolList, details?: string): string;
  version(): string;
}
