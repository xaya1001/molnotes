export type SavedDrawings = Record<
  string,
  { asset: string; width: number; height: number; minimumScale: number }
>;
import type { MarkushFigureData } from "./markush.ts";
import type { MoleculeAbbreviation } from "../molecule-abbreviations.ts";
import type { ConformationSpec } from "../chemical-templates/conformation.ts";
import type { ProcessData } from "../process.ts";

export type Point = { x: number; y: number };
export type Evidence = { source: string; locator: string; note?: string };
export type AtomRef = { molecule: string; atom: string };
export type FocusGroup = {
  atoms?: AtomRef[];
  bonds?: [AtomRef, AtomRef][];
  arrows?: string[];
};
export type Focus = { primary?: FocusGroup; supporting?: FocusGroup[] };
export type ArrowKind =
  "forward" | "equilibrium" | "resonance" | "retro" | "none";
export interface EntryBase {
  sourceFile?: string;
  sourceKey?: string;
  owner?: string;
  overview?: string;
  footnote?: string;
  drawings?: SavedDrawings;
  id: string;
  title: string;
  sources: Evidence[];
}
export interface CompoundLayout {
  /** Input for indexed molecule controls, preserving authored atom/bond order and depiction. */
  inputSmiles?: string;
  /** Mapped molblock with explicit Kekulé bonds; atom order matches atomIds. */
  molblock?: string;
  /** Coordinates in bond units, positive y downward. Keys are persistent atom IDs. */
  coords: Record<string, Point>;
  scaffold?: {
    id: string;
    drawing: "flat" | "perspective";
    bonds: [string, string][];
    depths?: Record<string, number>;
    depthWidth?: [number, number];
    overpasses?: [[string, string], [string, string]][];
  };
  pins?: Record<string, Point>;
  /** Counterions sit near the charge centre by default; keep preserves authored separation. */
  ionPairs?: "near" | "keep";
  labels?: Record<string, Point>;
  stereoAnnotations?: boolean;
  wedgeBonds?: { from: string; to: string; style: "solid" | "hashed" }[];
  hydrogens?: Record<string, Point>;
  methylLabels?: string[];
  chargeAngles?: Record<string, number>;
  compact?: { atom: string; text: string; anchor: "first" | "last" };
  abbreviationAtoms?: string[];
  abbreviations?: MoleculeAbbreviation[];
  repeatUnits?: { atoms: string[]; label: string }[];
  atomNumbers?: Record<string, number>;
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
  bracket?: boolean | "ts";
}
export type Anchor =
  | { kind: "atom"; at: AtomRef }
  | { kind: "charge"; at: AtomRef }
  | { kind: "radical"; at: AtomRef }
  | {
      kind: "bond" | "pi" | "formingBond";
      atoms: [AtomRef, AtomRef];
      fraction?: number;
      side?: -1 | 1;
    }
  | { kind: "lonePair"; label: string };
export interface ElectronArrow {
  tone?: "comparison";
  id: string;
  from: Anchor;
  to: Anchor;
  electrons: 1 | 2;
  bend?: "left" | "right";
}
export interface SceneLabel {
  id: string;
  at: AtomRef;
  offset: Point;
  kind: "lonePair" | "radical" | "charge" | "partialCharge" | "text";
  text?: string;
  angle?: number;
}
export interface Enclosure {
  id: string;
  atoms?: AtomRef[];
  bonds?: [AtomRef, AtomRef][];
  shape?: "auto" | "circle" | "rect" | "outline";
}
export interface Scene {
  width: number;
  height: number;
  molecules: Placement[];
  arrows?: ElectronArrow[];
  labels?: SceneLabel[];
  focus?: Focus;
  enclose?: Enclosure[];
  changes?: Pick<FocusGroup, "atoms" | "bonds">;
  transitionState?: boolean;
  comparison?: boolean;
  reactionArrows?: {
    id: string;
    from: Point;
    to: Point;
    kind?: ArrowKind;
    above?: string[];
    below?: string[];
    controls?: [Point, Point];
    tone?: "comparison";
  }[];
  captions?: {
    at: Point;
    text: string;
    tone?: "comparison";
    align?: "start" | "middle" | "end";
  }[];
  partialBonds?: { atoms: [AtomRef, AtomRef]; order: number }[];
}
export interface Participant {
  /** Compound key in the figure source; participant id remains stable across recompilation. */
  sourceKey?: string;
  position?: "inline" | "above-arrow" | "below-arrow" | "text" | "none";
  id: string;
  compound: string;
  equivalents?: number;
  number?: string;
  name?: string;
  yield?: string;
  ratio?: string;
  fraction?: number;
}
export interface Reaction extends EntryBase {
  kind: "reaction";
  reactants: Participant[];
  products: Participant[];
  reagents: string[];
  reagentPosition?: "above-arrow" | "below-arrow";
  conditions: string[];
  tags?: string[];
  plusAt?: Point[];
  showPlus?: boolean;
  explanation: string;
  scene: Scene;
  arrow: {
    from: Point;
    to: Point;
    textWidth: number;
    via?: Point[];
    kind?: ArrowKind;
    side?: "left" | "right";
  };
}
export interface Route extends EntryBase {
  kind: "route";
  steps: {
    id: string;
    reaction: string;
    at: Point;
    display?: Record<string, "structure" | "reference" | "hidden">;
    placements?: Record<string, Point>;
    reagents?: string[];
    conditions?: string[];
    boxes?: string[];
    arrow?: Reaction["arrow"];
  }[];
  connections?: { id: string; points: Point[] }[];
  plusAt?: Point[];
  edges: { from: string; to: string; product: string; reactant: string }[];
  width: number;
  height: number;
}
export interface Mechanism extends EntryBase {
  kind: "mechanism";
  category: "reaction" | "resonance" | "comparison" | "examples";
  frames: {
    id: string;
    title: string;
    scene: Scene;
    explanation: string;
    arrow?: ArrowKind;
    above?: string[];
    below?: string[];
    drawings?: SavedDrawings;
  }[];
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
export interface LibraryProcess extends EntryBase, ProcessData {
  kind: "process";
}
export interface LibraryMarkush extends EntryBase, MarkushFigureData {
  kind: "markush";
}
export interface Conformation extends EntryBase, ConformationSpec {
  kind: "conformation";
}
export type LibraryEntry =
  | Compound
  | Reaction
  | Route
  | Mechanism
  | LibraryImage
  | LibraryProcess
  | LibraryMarkush
  | Conformation;
export type Library = Record<string, LibraryEntry>;
export interface FigureReference {
  ref: string;
  variant?: string;
  frame?: string;
  numbers?: Record<string, string>;
  focus?: Focus;
  caption?: string;
  /** Context-specific accessible description for a reused image. */
  alt?: string;
  /** Preserve the reading context of an ordinary image or note illustration. */
  presentation?: "figure" | "note";
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
  renders?: Record<string, LibraryFigureRender>;
  previews?: Record<string, string>;
  audit?: { orphans: string[]; duplicates: string[][] };
  entries: Library;
  uses: Record<string, { path: string; title: string }[]>;
}

export interface LibraryFigureRender {
  asset: string;
  width: number;
  height: number;
  minimumScale: number;
  diagnostics: Diagnostic[];
}
