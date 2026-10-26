// The block catalogue as the runtime reads it. scripts/topic-blocks.mjs is
// the definition and checks every topic's content.json against it; these
// types mirror it so the renderer and the pages read checked data.
import type {
  MechanismFrame,
  MoleculeData,
  SynthesisRoute,
} from "../chemistry/types";
import type { DataTableInput } from "../data/values";
import type { FlowInput } from "../diagrams/flow";
import type { TimelineInput } from "../diagrams/model";
import type { MatrixInput } from "../matrix/model";
import type { StructureSetInput } from "../structure/model";
import type { TopicPrediction } from "./content";

interface BlockBase {
  /** Names the block; a prediction's records are kept under it (the chapter id when absent). */
  id?: string;
}

/** A field that holds its value, or names an entry of the topic's `data`. */
export type DataRef<T> = T | string;

export interface HeadingBlock extends BlockBase {
  type: "heading";
  text: string;
  level?: 2 | 3;
}
export interface ParagraphBlock extends BlockBase {
  type: "paragraph";
  text: string;
}
export interface CalloutBlock extends BlockBase {
  type: "callout";
  text: string;
  tone?: "note" | "caution" | "evidence";
  link?: { to: string; text: string };
}
export interface ListBlock extends BlockBase {
  type: "list";
  items: string[];
  ordered?: boolean;
}
export interface FormulaBlock extends BlockBase {
  type: "formula";
  tex: string;
  caption?: string;
}
export interface MoleculeBlock extends BlockBase, MoleculeData {
  type: "molecule";
  highlightAtoms?: number[];
  highlightBonds?: number[];
  labels?: Record<number, string>;
  caption?: string;
}
/** Two molecules side by side, each picked from `items`, with a switch for their highlighted atoms. */
export interface MoleculeCompareBlock extends BlockBase {
  type: "molecule-compare";
  items: DataRef<
    (MoleculeData & { highlightAtoms?: number[]; caption?: string })[]
  >;
  left?: string;
  right?: string;
  /** Label of the highlight switch, e.g. "标出锚定环". */
  highlightLabel?: string;
}
export interface MoleculesBlock extends BlockBase {
  type: "molecules";
  items: DataRef<MoleculeData[]>;
  caption?: string;
}
export interface PropertiesBlock extends BlockBase, MoleculeData {
  type: "properties";
}
export interface SubstituentsBlock extends BlockBase {
  type: "substituents";
  site: string;
  variants: DataRef<MoleculeData[]>;
}
export interface RouteBlock extends BlockBase {
  type: "route";
  routes: DataRef<SynthesisRoute[]>;
}
export interface MechanismBlock extends BlockBase {
  type: "mechanism";
  title?: string;
  frames: DataRef<MechanismFrame[]>;
}
/** A table cell: text, or a linked value. */
export type TableCell = string | { text: string; href: string };
export interface TableBlock extends BlockBase {
  type: "table";
  caption: string;
  columns: string[];
  rows: DataRef<TableCell[][]>;
  note?: string;
  /** The first cell of each row is a row header. */
  rowHeader?: boolean;
}
export interface SpectrumPeak {
  id: string;
  ppm: number;
  hydrogens: number;
  multiplicity: string;
  j?: string;
  atoms: number[];
  assignment: string;
}
/** A peak list the reader picks through; assignments and atom highlights wait for `assignAfter`. */
export interface SpectrumBlock extends BlockBase {
  type: "spectrum";
  molecule: MoleculeData;
  peaks: DataRef<SpectrumPeak[]>;
  caption?: string;
  assignAfter?: string[];
}
export interface DataTableBlock extends BlockBase {
  type: "data-table";
  table: DataRef<DataTableInput>;
  title: string;
  label: string;
  noun?: string;
  idLabel?: string;
  missing?: string;
  defaultX?: string;
  defaultY?: string;
}
export interface StructureLabBlock extends BlockBase {
  type: "structure-lab";
  set: DataRef<StructureSetInput>;
  ids?: string[];
}
export interface ExcerptBlock extends BlockBase {
  type: "excerpt";
  excerpt: string;
}
export interface FigureBlock extends BlockBase {
  type: "figure";
  src: string;
  alt: string;
  caption: string;
}
export interface ChartBlock extends BlockBase {
  type: "chart";
  points: DataRef<{ x: number; y: number }[]>;
  xLabel: string;
  yLabel: string;
  xDomain?: [number, number];
  yDomain?: [number, number];
  caption?: string;
}
export interface TimelineBlock extends BlockBase {
  type: "timeline";
  timeline: DataRef<TimelineInput>;
  caption?: string;
}
export interface FlowBlock extends BlockBase {
  type: "flow";
  flow: DataRef<FlowInput>;
  caption?: string;
}
/** The reader chooses one of the topic's learning paths; previous and next then follow it. */
export interface PathPickerBlock extends BlockBase {
  type: "path-picker";
  title?: string;
}
/** The entry self-test summed up by chapter: answered count, and per chapter whether it can be skipped. */
export interface DiagnosticSummaryBlock extends BlockBase {
  type: "diagnostic-summary";
  title?: string;
}
export interface SceneFrame {
  title: string;
  text: string;
  image?: { src: string; alt: string };
}
export interface SceneBlock extends BlockBase {
  type: "scene";
  label: string;
  title?: string;
  frames: DataRef<SceneFrame[]>;
}
export interface ProblemBlock extends BlockBase {
  type: "problem";
  id: string;
  lang: "en" | "zh";
  label?: string;
  source?: string;
  task?: string;
  prompt?: string | string[];
  parts?: string[];
  answer: { text: string | string[]; origin: "book" | "ai"; basis: string };
  evidence?: string[];
}
export type PredictionBlock = BlockBase &
  TopicPrediction & { type: "prediction" };
/** Guess every required cell, then see the grid; answered once every required cell is. */
export interface MatrixBlock extends BlockBase {
  type: "matrix";
  matrix: DataRef<MatrixInput>;
  question: string;
  label: string;
  caption: string;
  rowHeader: string;
  heading?: string;
  instruction?: string;
  quoteLang?: string;
}
export interface LabBlock extends BlockBase {
  type: "lab";
  model: string;
  label: string;
  title?: string;
  intro?: string;
  defaults?: Record<string, number | string>;
  /** Key of a `data` entry handed to the model as its second argument. */
  data?: string;
  /** A button that shows the model result's `revealed` part; any input change hides it again. */
  reveal?: { label: string };
  /** Buttons that set several inputs at once, e.g. a textbook's slow and fast cases. */
  presets?: { label: string; values: Record<string, number | string> }[];
  /** A 恢复默认 button that puts every input back to its default. */
  reset?: boolean;
}
/** Named alternatives, one shown at a time, each a sequence of static blocks. */
export interface TabsBlock extends BlockBase {
  type: "tabs";
  label: string;
  /** Initially selected item ID; omitted selects the first item. */
  default?: string;
  items: { id: string; label: string; blocks: TopicBlock[] }[];
}
export interface QuizBlock extends BlockBase {
  type: "quiz";
  questions: string[];
  /** Entry self-test questions (from `placement`, or `quiz`), recorded under `diagnostic`. */
  diagnostic?: boolean;
}
/** The reading guide of the whole topic (`content.reading`) or of this chapter (`chapter.reading`). */
export interface ReadingBlock extends BlockBase {
  type: "reading";
  scope: "topic" | "chapter";
  title?: string;
}

export type PatentBlock =
  | { type: "source-pages"; source: string }
  | { type: "synthesis-network"; network: string }
  | { type: "record-collection"; collection: string }
  | { type: "claims"; set: string }
  | { type: "sar-cases"; cases: string; collection: string };

export type TopicBlock =
  | (BlockBase & PatentBlock)
  | HeadingBlock
  | ParagraphBlock
  | CalloutBlock
  | ListBlock
  | FormulaBlock
  | MoleculeBlock
  | MoleculesBlock
  | MoleculeCompareBlock
  | PropertiesBlock
  | SubstituentsBlock
  | RouteBlock
  | MechanismBlock
  | TableBlock
  | SpectrumBlock
  | DataTableBlock
  | StructureLabBlock
  | ExcerptBlock
  | FigureBlock
  | ChartBlock
  | TimelineBlock
  | FlowBlock
  | DiagnosticSummaryBlock
  | PathPickerBlock
  | TabsBlock
  | SceneBlock
  | ProblemBlock
  | PredictionBlock
  | MatrixBlock
  | LabBlock
  | QuizBlock
  | ReadingBlock;
