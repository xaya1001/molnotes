/** Indices are zero based in the supplied SMILES parse order. */
export type StructureAnchor = { atom: number } | { bond: number };
export interface ElectronArrow {
  from: StructureAnchor;
  to: StructureAnchor;
  electrons: 1 | 2;
  /** Signed curvature as a fraction of endpoint distance. */
  bend?: number;
}
export interface MoleculeData {
  name: string;
  smiles: string;
  /** Atom and bond counts of the SMILES, when a prediction bounds its indices by them. */
  atoms?: number;
  bonds?: number;
}
export interface ReactionStep {
  title: string;
  reactants: MoleculeData[];
  products: MoleculeData[];
  reagents: string;
  conditions: string;
  yield?: string;
  explanation: string;
}
export interface SynthesisRoute {
  id: string;
  title: string;
  steps: ReactionStep[];
}
export interface MechanismFrame extends MoleculeData {
  explanation: string;
  arrows: ElectronArrow[];
}
