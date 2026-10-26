/** Data checked by the topic block contract at publication and mount. */
export type RecordId = string | number;
export interface PageRef {
  source?: string;
  page: number;
  end?: number;
  rect?: number[];
  asset?: string;
}
export interface PageSource {
  size: [number, number];
  title: string;
  pages: number;
  image: string;
  text: string;
  paragraphs: Record<string, number>;
}
export interface RecordField {
  key: string;
  label: string;
  kind:
    | "text"
    | "number"
    | "grade"
    | "tags"
    | "smiles"
    | "ref"
    | "link"
    | "body"
    | "measurement"
    | "assignments";
  scale?: string;
  ref?: PageRef;
  filter?: boolean;
  sort?: boolean;
}
export interface GradeScale {
  bins: { value: string; label: string }[];
  blank: string;
  dash: string;
}
export interface BodyRef {
  url: string;
  key: string;
}
export type FieldValue = string | number | string[] | PageRef | BodyRef;
export interface CollectionRecord {
  id: RecordId;
  source: string;
  refs?: Record<string, RecordId[]>;
  notes?: { field?: string; text: string; ref?: PageRef }[];
  [key: string]: unknown;
}
export interface RecordCollection {
  title: string;
  route: string;
  fields: RecordField[];
  scales: Record<string, GradeScale>;
  assays?: Record<string, Assay>;
  pins?: { max: number };
  export?: boolean;
  records: CollectionRecord[];
}
export interface Claim {
  id: number;
  title: string;
  group: string;
  text: string;
  note?: string;
  refs: number[];
  children: number[];
  segments: PageRef[];
  scope?: { smarts: string; note: string };
  examples: RecordId[];
}
export interface ClaimSet {
  source: string;
  claims: Claim[];
}
export interface SarCase {
  analysis?: {
    kind: "observation" | "design-around-hypothesis" | "unresolved";
    rationale: string;
    evidence: PageRef[];
  };
  id: string;
  title: string;
  ids: RecordId[];
  area: string;
  change: string;
  finding: string;
  limit: string;
  claims: number[];
}
export interface PatentData {
  synthesis?: Record<string, SynthesisNetwork>;
  sources?: Record<string, PageSource>;
  collections?: Record<string, RecordCollection>;
  claims?: Record<string, ClaimSet>;
  sarCases?: Record<string, SarCase[]>;
}
export interface PatentRecords {
  pins: Record<string, RecordId[]>;
  recordNotes: Record<string, string>;
}
export function patentData(content: {
  data?: Record<string, unknown>;
}): PatentData {
  // The caller receives content only after validateTopicContent.
  return content.data ?? {};
}
export function sourceLink(ref: PageRef, source?: string) {
  return {
    path: `/sources/pages/${ref.page}`,
    query: { source: ref.source ?? source, rect: ref.rect?.join(",") },
  };
}
export function gradeText(value: unknown, scale: GradeScale) {
  if (value === undefined) return "未列";
  if (value === "") return scale.blank;
  if (value === "--") return scale.dash;
  return `${value} · ${scale.bins.find((bin) => bin.value === value)?.label ?? ""}`;
}

export interface Assay {
  title: string;
  target: string;
  endpoint: string;
  conditions: string;
  unit: string | null;
  unitReason?: string;
  evidence: PageRef[];
}
export type Measurement =
  | {
      assay: string;
      status: "reported";
      qualifier: "=" | "<" | "<=" | ">" | ">=" | "range";
      value: number;
      upper?: number;
      ref: PageRef;
    }
  | {
      assay: string;
      status: "unreported" | "not-tested" | "unresolved";
      reason: string;
      ref?: PageRef;
    };
export interface Assignment {
  group: string;
  basis: "author" | "agent" | "chemical-pattern";
  limit: string;
  evidence: PageRef[];
  claims: number[];
  pattern?: string;
}
export interface CompoundRef {
  collection: string;
  id: RecordId;
}
export interface Procedure {
  sourceRecord?: CompoundRef;
  reagents: string;
  conditions: string;
  evidence: PageRef[];
}
export interface SynthesisStep {
  id: string;
  title: string;
  strategy: string;
  reactants: CompoundRef[];
  products: CompoundRef[];
  evidence: PageRef[];
  procedure?: string;
  procedureNote?: string;
  overrideEvidence?: PageRef[];
  reagents?: string;
  conditions?: string;
  owner?: CompoundRef;
  limit?: string;
  isolatedMass?: {
    value: number;
    unit: "mg" | "g" | "kg";
    state: "crude" | "purified";
    product: CompoundRef;
    ref: PageRef;
  };
  yield:
    | {
        status: "reported";
        value: number;
        unit: "%";
        basis: string;
        ref: PageRef;
        product: CompoundRef;
      }
    | { status: "unreported"; reason: string };
}
export interface ResearchRoute {
  id: string;
  title: string;
  scaffold: string;
  steps: string[];
  target: CompoundRef;
  startingMaterials: CompoundRef[];
  extent: "complete" | "fragment";
  limit: string;
  evidence: PageRef[];
  reportedYield?: {
    value: number;
    unit: "%";
    basis: string;
    ref: PageRef;
    scopeStepIds: string[];
    product: CompoundRef;
  };
}
export interface ProcedureReference {
  record: CompoundRef;
  procedure: string;
  note: string;
  reagents?: string;
  conditions?: string;
  evidence: PageRef[];
  overrideEvidence?: PageRef[];
  yield: { status: "unreported"; reason: string };
}
export interface SynthesisNetwork {
  references?: ProcedureReference[];
  title: string;
  procedures?: Record<string, Procedure>;
  steps: SynthesisStep[];
  routes: ResearchRoute[];
}
