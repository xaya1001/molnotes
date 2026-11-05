import type { MoleculeAbbreviation } from "../molecule-abbreviations.ts";

export type Point = { x: number; y: number };
export type Evidence = { source: string; locator: string; note?: string };
export type AtomRef = { molecule: string; atom: string };
export type FocusGroup = {
  atoms?: AtomRef[];
  bonds?: [AtomRef, AtomRef][];
  arrows?: string[];
};
export type Focus = { primary?: FocusGroup; supporting?: FocusGroup[] };
export interface EntryBase {
  id: string;
  title: string;
  sources: Evidence[];
}
export interface CompoundLayout {
  /** Coordinates in bond units, positive y downward. Keys are persistent atom IDs. */
  coords: Record<string, Point>;
  pins?: Record<string, Point>;
  labels?: Record<string, Point>;
  stereoAnnotations?: boolean;
  abbreviations?: MoleculeAbbreviation[];
}
export interface Compound extends EntryBase {
  kind: "compound";
  smiles: string;
  /** Persistent a<map> IDs in authored traversal order, checked against the mapped SMILES. */
  atomIds: string[];
  /** Canonical isomeric graph signature at layout creation. */
  graph: string;
  layout: CompoundLayout;
  variants?: Record<string, CompoundLayout>;
  aliases?: string[];
  form?: string;
  /** A terminal dummy atom marking a substituent's explicit attachment. */
  attachment?: string;
  template?: {
    atom: string;
    label: string;
    allowed: string[];
    description: string;
  }[];
}
export interface Placement {
  id: string;
  compound: string;
  variant?: string;
  at: Point;
  rotate?: number;
  mirror?: boolean;
}
export type Anchor =
  | { kind: "atom"; at: AtomRef }
  | { kind: "charge"; at: AtomRef }
  | {
      kind: "bond" | "formingBond";
      atoms: [AtomRef, AtomRef];
      fraction?: number;
    }
  | { kind: "lonePair"; label: string };
export interface ElectronArrow {
  id: string;
  from: Anchor;
  to: Anchor;
  electrons: 1 | 2;
  curve: {
    exitAngle: number;
    entryAngle: number;
    reach: [number, number];
    control1?: Point;
    control2?: Point;
  };
}
export interface SceneLabel {
  id: string;
  at: AtomRef;
  offset: Point;
  kind: "lonePair" | "charge" | "partialCharge" | "text";
  text?: string;
}
export interface Scene {
  width: number;
  height: number;
  molecules: Placement[];
  arrows?: ElectronArrow[];
  labels?: SceneLabel[];
  focus?: Focus;
  transitionState?: boolean;
  partialBonds?: { atoms: [AtomRef, AtomRef]; order: number }[];
}
export interface Participant {
  id: string;
  compound: string;
  equivalents?: number;
  yield?: number;
  fraction?: number;
}
export interface Reaction extends EntryBase {
  kind: "reaction";
  reactants: Participant[];
  products: Participant[];
  reagents: string[];
  conditions: string[];
  tags?: string[];
  plusAt?: Point[];
  explanation: string;
  scene: Scene;
  arrow: { from: Point; to: Point; textWidth: number };
}
export interface Route extends EntryBase {
  kind: "route";
  steps: { id: string; reaction: string; at: Point }[];
  edges: { from: string; to: string; product: string; reactant: string }[];
  width: number;
  height: number;
  /** Explicit path used for the displayed cumulative yield. */
  yieldPath: string[];
  /** A jointly reported yield replaces individual yields for exactly these steps. */
  combinedYields?: { steps: string[]; value: number }[];
}
export interface Mechanism extends EntryBase {
  kind: "mechanism";
  category: "reaction" | "resonance" | "comparison" | "examples";
  frames: { id: string; title: string; scene: Scene; explanation: string }[];
  maps?: { from: AtomRef; to: AtomRef; fromFrame: string; toFrame: string }[];
}
export interface LibraryImage extends EntryBase {
  kind: "image";
  asset: string;
  mime: string;
  width: number;
  height: number;
  purpose: string;
  rights: string;
  alt: string;
  author?: string;
  prompt?: string;
  derivedFrom?: string[];
  crop?: { x: number; y: number; width: number; height: number };
}
export type LibraryEntry =
  Compound | Reaction | Route | Mechanism | LibraryImage;
export type Library = Record<string, LibraryEntry>;
export interface FigureReference {
  ref: string;
  variant?: string;
  frame?: string;
  numbers?: Record<string, string>;
  focus?: Focus;
  caption?: string;
}
export interface Diagnostic {
  code: string;
  severity: "error" | "warning";
  object: string;
  elements: string[];
  message: string;
  at?: Point;
  actual?: number;
  required?: number;
  field?: string;
}
export interface LibrarySnapshot {
  previews?: Record<string, string>;
  audit?: { orphans: string[]; duplicates: string[][] };
  entries: Library;
  uses: Record<string, { path: string; title: string }[]>;
}
