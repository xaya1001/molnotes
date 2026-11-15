import type { MoleculeAbbreviation } from "../../../shared/molecule-abbreviations.ts";
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
