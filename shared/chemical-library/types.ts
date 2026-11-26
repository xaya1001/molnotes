import type { MarkushFigureData } from "./markush.ts";
import type { MoleculeAbbreviation } from "../molecule-abbreviations.ts";
import type { ConformationSpec } from "../chemical-templates/conformation.ts";

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
  style?: { bond?: number; width?: number };
  sourceFile?: string;
  sourceKey?: string;
  owner?: string;
  footnote?: string;
  id: string;
  title: string;
  sources: Evidence[];
}
export interface CompoundLayout {
  /** The author's explicit choice for abbreviating complete small reagents. */
  reagentAbbreviate?: boolean;
  /** Input for indexed molecule controls, preserving authored atom/bond order and depiction. */
  inputSmiles?: string;
  /** Additional ordinary H atoms, keyed by stable atom ID and attached to a base atom. */
  explicitHydrogens?: Record<string, string>;
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
  /** Whether native drawing adds ring stereocentre hydrogen wedges. */
  ringHydrogens?: boolean;
  methylLabels?: string[];
  chargeAngles?: Record<string, number>;
  compact?: { atom: string; text: string; anchor: "first" | "last" };
  abbreviationAtoms?: string[];
  abbreviations?: MoleculeAbbreviation[];
  repeatUnits?: { atoms: string[]; label: string; compact?: boolean }[];
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
  /** Compound or graph-free conformation entry. */
  compound: string;
  variant?: string;
  at: Point;
  rotate?: number;
  mirror?: boolean;
  caption?: { number: string; name?: string; yield?: string; note?: string };
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
    tone?: "comparison" | "yield";
    align?: "start" | "middle" | "end";
  }[];
  captionBoxes?: {
    at: Point;
    width: number;
    height: number;
    border?: boolean;
  }[];
  partialBonds?: { atoms: [AtomRef, AtomRef]; order: number }[];
}
export interface Participant {
  other?: boolean;
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
export type GraphParticipant = {
  state: string;
  placement?: string;
  show?: "box" | "text" | "plus" | "none";
  appearance?: Participant;
};
export type GraphState = {
  title?: string;
  text?: string;
  compounds?: Record<string, { ref: string; variant?: string }>;
  scene?: Scene;
};
export interface ArrowPath {
  from: Point;
  to: Point;
  textWidth: number;
  points?: Point[];
  kind?: ArrowKind;
  side?: "left" | "right";
}
export interface ArrowPlacement {
  at: Point;
  display?: Record<string, "structure" | "reference" | "hidden">;
  placements?: Record<string, Point>;
  reagents?: string[];
  conditions?: string[];
  boxes?: string[];
  arrow?: ArrowPath;
}
export type FigureGraph = {
  states: Record<string, GraphState>;
  arrows: Record<string, GraphArrow>;
  groups?: Record<
    string,
    {
      title?: string;
      subtitle?: string;
      items: string[];
      edges?: string[];
      scene?: Scene;
    }
  >;
  layout?: {
    cols?: number;
    anchor?: string;
    wrap?: "serpentine";
    radius?: number;
    branch?: number;
    panel?: Scene;
    route?: {
      connections?: { id: string; points: Point[] }[];
      plusAt?: Point[];
      width: number;
      height: number;
    };
  };
  yields?: {
    arrows: string[];
    product: string;
    yield: string;
    sources?: Evidence[];
    note?: string;
  }[];
};
export type GraphArrow = {
  from: GraphParticipant[];
  to: GraphParticipant[];
  kind: ArrowKind;
  role: "reaction" | "elementary" | "display";
  title?: string;
  above?: string[];
  below?: string[];
  sources?: Evidence[];
  tags?: string[];
  in?: string;
  out?: string;
  map?: { from: AtomRef; to: AtomRef }[];
  settings?: {
    others?: GraphParticipant["show"];
    turn?: "down" | "elbow" | "wrap";
    side?: "left" | "right";
    reverse?: boolean;
  };
  via?: FigureGraph & {
    bind?: { from?: Record<string, string>; to?: Record<string, string> };
  };
  drawing?: {
    scene: Scene;
    arrow: ArrowPath;
    reagents: string[];
    conditions: string[];
    plusAt?: Point[];
    showPlus?: boolean;
    reagentPosition?: "above-arrow" | "below-arrow";
  };
  placement?: ArrowPlacement;
};
export interface Figure extends EntryBase {
  kind: "figure";
  graph: FigureGraph;
  views: Record<
    string,
    { items: string[]; arrows?: string[]; titles?: boolean }
  >;
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
export interface LibraryMarkush extends EntryBase, MarkushFigureData {
  kind: "markush";
}
export interface Conformation extends EntryBase, ConformationSpec {
  kind: "conformation";
}
export type LibraryEntry =
  Compound | Figure | LibraryImage | LibraryMarkush | Conformation;
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
