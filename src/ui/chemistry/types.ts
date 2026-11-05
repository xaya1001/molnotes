import type { MoleculeAbbreviation } from "../../../shared/molecule-abbreviations.ts";
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
  abbreviations?: MoleculeAbbreviation[];
  /** Atom and bond counts of the SMILES, when a prediction bounds its indices by them. */
  atoms?: number;
  bonds?: number;
}
export type {
  ReactionStep,
  SynthesisRoute,
} from "../../../shared/reaction-scheme.ts";
export type {
  MechanismFrame,
  MechanismMolecule,
  MechanismArrow,
  MechanismAnchor,
  CatalyticCycle,
} from "../../../shared/mechanism.ts";
