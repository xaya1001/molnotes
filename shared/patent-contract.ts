import { validateMarkush } from "./patent-markush.ts";
import {
  validateFigureReference,
  validateImageReference,
} from "./chemical-library/contract.ts";
import type { FigureReference } from "./chemical-library/types.ts";
import {
  isFiniteNumber,
  isInteger,
  isList,
  isObject,
  isSafeInteger,
  type JsonObject,
} from "./json.ts";
import {
  validateResearchData,
  type CheckedCollection,
} from "./patent-research.ts";
/** Data checked by the topic block contract at publication and mount. */
export type RecordId = string | number;
export interface PageRef {
  source?: string;
  page: number;
  end?: number;
  rect?: number[];
  asset?: string | FigureReference;
}
export interface PageSource {
  size: [number, number];
  title: string;
  pages: number;
  image?: string;
  images?: FigureReference[];
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
  placement?: "identifier";
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
  structureFigures?: Record<string, Record<string, FigureReference>>;
  records: CollectionRecord[];
}
export interface Claim {
  notes?: string[];
  id: number;
  title: string;
  group: string;
  text: string;
  note?: string;
  refs: number[];
  children: number[];
  segments: PageRef[];
  markush?: import("./patent-markush.ts").Markush;
  examples: RecordId[];
}
export interface ClaimSet {
  source: string;
  claims: Claim[];
}
export interface SarCase {
  structureFigures?: Record<string, Record<string, FigureReference>>;
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

// Structural and referential validation shared by publishing and the browser.
function ok(test: unknown, at: string): asserts test {
  if (!test) throw new Error(at);
}
function text(v: unknown, at: string): asserts v is string {
  ok(typeof v === "string" && v.trim(), `${at}: expected text`);
}
const key = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-zA-Z0-9_-]+$/.test(v) &&
  !["__proto__", "constructor", "prototype"].includes(v);
const id = (v: unknown): v is RecordId => (isSafeInteger(v) && v > 0) || key(v);
const list = (v: unknown, at: string): unknown[] => {
  ok(isList(v), `${at}: expected array`);
  return v;
};
const entries = (v: unknown, at: string): [string, unknown][] => {
  ok(isObject(v), `${at}: expected object`);
  return Object.entries(v);
};
/** A field of a value not yet checked to be an object, read as JavaScript reads it. */
const field = (v: unknown, name: string): unknown =>
  isObject(v) ? v[name] : undefined;
const unique = (v: unknown[], at: string) =>
  ok(new Set(v.map(String)).size === v.length, `${at}: duplicate id`);
function asset(v: unknown, at?: string): asserts v is string {
  ok(
    typeof v === "string" &&
      /^\/sites\/[a-z0-9-]+\/static\/[\w/{}.\-]+$/.test(v) &&
      !v.includes(".."),
    `${at}: expected static resource path`,
  );
}
function imageAsset(value: unknown, at = "image") {
  if (typeof value === "string") asset(value, at);
  else validateImageReference(value, at);
}
const patentTypes: readonly unknown[] = [
  "source-pages",
  "record-collection",
  "claims",
  "sar-cases",
  "synthesis-network",
];
const fieldKinds: readonly unknown[] = [
  "text",
  "number",
  "grade",
  "tags",
  "smiles",
  "ref",
  "link",
  "body",
  "measurement",
  "assignments",
];
export type PatentBlock =
  | { type: "source-pages"; source: string }
  | { type: "synthesis-network"; network: string }
  | { type: "record-collection"; collection: string }
  | { type: "claims"; set: string }
  | { type: "sar-cases"; cases: string; collection: string };

type NestedBlock = { type: string; items?: unknown };
const isTabs = (
  block: NestedBlock,
): block is NestedBlock & {
  items: readonly { blocks: readonly NestedBlock[] }[];
} => block.type === "tabs";
/** The patent blocks of checked content, those inside tabs included. */
export function patentBlocks(content: {
  chapters?: readonly { blocks: readonly NestedBlock[] }[];
}): PatentBlock[] {
  const walk = (blocks: readonly NestedBlock[]): NestedBlock[] =>
    blocks.flatMap((block) => [
      block,
      ...(isTabs(block)
        ? block.items.flatMap((item) => walk(item.blocks))
        : []),
    ]);
  return (content.chapters ?? [])
    .flatMap((c) => walk(c.blocks))
    .filter((b): b is NestedBlock & PatentBlock =>
      patentTypes.includes(b.type),
    );
}
/** The patent blocks of content JSON whose blocks are not checked yet. */
function uncheckedPatentBlocks(chapters: readonly unknown[]): JsonObject[] {
  const walk = (blocks: unknown): JsonObject[] =>
    (isList(blocks) ? blocks : []).flatMap((block) =>
      isObject(block)
        ? [
            block,
            ...(block.type === "tabs" && isList(block.items)
              ? block.items.flatMap((item) => walk(field(item, "blocks")))
              : []),
          ]
        : [],
    );
  return chapters
    .flatMap((c) => walk(field(c, "blocks")))
    .filter((b) => patentTypes.includes(b.type));
}
export function validatePatentData(
  content: { chapters: readonly unknown[]; data?: JsonObject },
  where: string,
): void {
  const blocks = uncheckedPatentBlocks(content.chapters);
  if (!blocks.length) return;
  const data = content.data ?? {};
  const keyed = (value: unknown, kind: string): JsonObject => {
    ok(isObject(value), `${where} data.${kind}: expected object`);
    for (const name of Object.keys(value))
      ok(key(name), `${where}: invalid ${kind} key`);
    return value;
  };
  const sources = keyed(data.sources ?? {}, "sources"),
    collections = keyed(data.collections ?? {}, "collections"),
    sets = keyed(data.claims ?? {}, "claims"),
    cases = keyed(data.sarCases ?? {}, "sarCases"),
    synthesis = keyed(data.synthesis ?? {}, "synthesis");
  for (const b of blocks) {
    const [map, name] =
      b.type === "source-pages"
        ? [sources, b.source]
        : b.type === "record-collection"
          ? [collections, b.collection]
          : b.type === "claims"
            ? [sets, b.set]
            : b.type === "synthesis-network"
              ? [synthesis, b.network]
              : [cases, b.cases];
    ok(Object.hasOwn(map, String(name)), `${where}: unknown ${b.type} ${name}`);
    if (b.type === "sar-cases")
      ok(
        Object.hasOwn(collections, String(b.collection)),
        `${where}: unknown collection ${b.collection}`,
      );
  }
  const defaultSource = blocks.find((b) => b.type === "source-pages")?.source;
  // The sources a page reference can name, filled by the source checks below
  // before any reference is checked.
  const pageSources = new Map<string, Pick<PageSource, "pages" | "size">>();
  const ref = (v: unknown, source?: unknown, at?: string) => {
    ok(isObject(v), `${at}: expected page reference`);
    const src = pageSources.get(String(v.source ?? source ?? defaultSource));
    ok(
      src && isInteger(v.page) && v.page >= 1 && v.page <= src.pages,
      `${at}: unknown source or page outside pages`,
    );
    if (v.end !== undefined)
      ok(
        isInteger(v.end) && v.end >= v.page && v.end <= src.pages,
        `${at}: invalid end page`,
      );
    if (v.rect !== undefined)
      ok(
        isList(v.rect) &&
          v.rect.length === 4 &&
          v.rect.every(isFiniteNumber) &&
          v.rect[0] >= 0 &&
          v.rect[1] >= 0 &&
          v.rect[2] >= v.rect[0] &&
          v.rect[3] >= v.rect[1] &&
          v.rect[2] <= src.size[0] &&
          v.rect[3] <= src.size[1],
        `${at}: invalid rectangle`,
      );
    if (v.asset !== undefined) imageAsset(v.asset, at);
  };
  for (const [name, s] of Object.entries(sources)) {
    ok(isObject(s), `${name}: expected text`);
    text(s.title, name);
    ok(
      isList(s.size) &&
        s.size.length === 2 &&
        s.size.every((n): n is number => isFiniteNumber(n) && n > 0),
      `${name}: size must contain positive width and height in PDF points`,
    );
    ok(isInteger(s.pages) && s.pages > 0, `${name}: invalid pages`);
    if (s.images !== undefined) {
      ok(
        isList(s.images) && s.images.length === s.pages,
        `${name}: one image reference per page required`,
      );
      s.images.forEach((image, i) =>
        validateImageReference(image, `${name}: image ${i + 1}`),
      );
      ok(s.image === undefined, `${name}: choose images or image pattern`);
    } else {
      asset(s.image, name);
      ok(s.image.includes("{page}"), `${name}: image needs {page}`);
    }
    asset(s.text, name);
    for (const [p, n] of entries(s.paragraphs, name))
      ok(
        /^\d+$/.test(p) && isInteger(n) && n >= 1 && n <= s.pages,
        `${name}: invalid paragraph page`,
      );
    pageSources.set(name, { pages: s.pages, size: [s.size[0], s.size[1]] });
  }
  const claimIds = Object.values(sets).flatMap((s) =>
    list(field(s, "claims"), where).map((c) => field(c, "id")),
  );
  unique(claimIds, `${where}: claims`);
  const targetIds = (name: string) => {
    if (name === "claims") return claimIds;
    const records = field(collections[name], "records");
    return isList(records) ? records.map((r) => field(r, "id")) : undefined;
  };
  const refs = (values: unknown, name: string, at: string) => {
    const ids = targetIds(name);
    ok(
      ids && list(values, at).every((v) => ids.includes(v)),
      `${at}: unknown reference in ${name}`,
    );
  };
  const routes: unknown[] = [];
  const checkedCollections = new Map<string, CheckedCollection>();
  for (const [name, c] of Object.entries(collections)) {
    ok(isObject(c), `${name}: expected text`);
    text(c.title, name);
    ok(
      typeof c.route === "string" &&
        /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(c.route),
      `${name}: invalid route`,
    );
    routes.push(c.route);
    const fields = list(c.fields, name);
    unique(
      fields.map((f) => field(f, "key")),
      name,
    );
    const scales = c.scales ?? {};
    for (const [k, s] of entries(scales, name)) {
      ok(isObject(s), `${k}: expected text`);
      text(s.blank, k);
      text(s.dash, k);
      const bins = list(s.bins, k);
      unique(
        bins.map((b) => field(b, "value")),
        k,
      );
      for (const b of bins) {
        ok(isObject(b), `${k}: expected text`);
        text(b.value, k);
        text(b.label, k);
        ok(
          ![
            "",
            "--",
            "missing",
            "reported",
            "blank",
            "dash",
            "unlisted",
          ].includes(b.value),
          `${k}: reserved grade`,
        );
      }
    }
    if (c.pins !== undefined)
      ok(
        isObject(c.pins) && isInteger(c.pins.max) && c.pins.max > 0,
        `${name}: invalid pins.max`,
      );
    if (c.export !== undefined)
      ok(typeof c.export === "boolean", `${name}: invalid export`);
    const checkedFields: JsonObject[] = [];
    for (const f of fields) {
      ok(
        isObject(f) &&
          key(f.key) &&
          !["id", "source", "refs", "notes"].includes(f.key),
        `${name}: invalid field key`,
      );
      text(f.label, name);
      ok(fieldKinds.includes(f.kind), `${name}: invalid field kind`);
      if (f.placement !== undefined)
        ok(
          f.placement === "identifier" && f.kind === "text",
          `${name}: identifier placement requires text`,
        );
      if (f.kind === "grade")
        ok(field(scales, String(f.scale)), `${name}: unknown scale`);
      if (f.ref) ref(f.ref, undefined, name);
      for (const flag of ["filter", "sort"])
        if (f[flag] !== undefined)
          ok(typeof f[flag] === "boolean", `${name}: invalid ${flag}`);
      checkedFields.push(f);
    }
    const records = list(c.records, name);
    unique(
      records.map((r) => field(r, "id")),
      name,
    );
    structureFigures(c.structureFigures, records, checkedFields, name);
    const checkedRecords: JsonObject[] = [];
    for (const r of records) {
      const at = `${where}: ${name}/${field(r, "id")}`;
      ok(isObject(r) && id(r.id), `${at}: invalid id`);
      checkedRecords.push(r);
      ok(Object.hasOwn(sources, String(r.source)), `${at}: unknown source`);
      for (const f of checkedFields) {
        const v = r[String(f.key)];
        if (v === undefined) continue;
        if (f.kind === "text" || f.kind === "smiles" || f.kind === "link") {
          ok(typeof v === "string", `${at}.${f.key}: expected string`);
          if (f.kind === "link")
            ok(
              v.startsWith("/") && !v.startsWith("//"),
              `${at}: expected internal link`,
            );
        }
        if (f.kind === "number")
          ok(isFiniteNumber(v), `${at}: expected number`);
        if (f.kind === "tags")
          ok(
            isList(v) && v.every((t) => typeof t === "string"),
            `${at}: expected tags`,
          );
        if (f.kind === "grade") {
          const bins = field(field(scales, String(f.scale)), "bins");
          ok(
            v === "" ||
              v === "--" ||
              (isList(bins) && bins.some((b) => field(b, "value") === v)),
            `${at}: unknown grade`,
          );
        }
        if (f.kind === "ref") ref(v, r.source, at);
        if (f.kind === "body") {
          ok(isObject(v), `${at}: expected body`);
          asset(v.url, at);
          text(v.key, at);
        }
      }
      for (const [target, values] of entries(r.refs ?? {}, at))
        refs(values, target, at);
      for (const n of list(r.notes ?? [], at)) {
        ok(isObject(n), `${at}: expected text`);
        text(n.text, at);
        if (n.field)
          ok(
            checkedFields.some((f) => f.key === n.field),
            `${at}: unknown note field`,
          );
        if (n.ref) ref(n.ref, r.source, at);
      }
    }
    checkedCollections.set(name, {
      assays: c.assays,
      fields: checkedFields,
      records: checkedRecords,
    });
  }
  validateResearchData(
    { collections: checkedCollections, claimIds, sarCases: cases, synthesis },
    ref,
    where,
  );
  unique(routes, where);
  for (const [name, set] of Object.entries(sets)) {
    ok(isObject(set), `${name}: unknown source`);
    ok(Object.hasOwn(sources, String(set.source)), `${name}: unknown source`);
    for (const c of list(set.claims, where)) {
      const at = `${where}: claim ${field(c, "id")}`;
      ok(isObject(c) && isSafeInteger(c.id) && c.id > 0, `${at}: invalid id`);
      for (const k of ["title", "group", "text"]) text(c[k], at);
      refs(c.refs, "claims", at);
      refs(c.children, "claims", at);
      refs(c.examples, "examples", at);
      for (const segment of list(c.segments, at)) {
        ref(segment, set.source, at);
        imageAsset(field(segment, "asset"), at);
      }
      if (c.markush !== undefined) validateMarkush(c.markush, at);
      if (c.notes !== undefined)
        for (const note of list(c.notes, at)) text(note, at);
    }
  }
  function structureFigures(
    figures: unknown,
    records: unknown[],
    fields: JsonObject[],
    name: string,
  ) {
    if (figures !== undefined)
      for (const [recordId, drawings] of entries(figures, name)) {
        ok(
          records.some((r) => String(field(r, "id")) === recordId),
          `${name}: unknown structure record`,
        );
        for (const [fieldKey, drawing] of entries(drawings, name)) {
          ok(
            fields.some((f) => f.key === fieldKey && f.kind === "smiles"),
            `${name}: unknown structure field`,
          );
          validateFigureReference(drawing, name);
          ok(
            drawing.ref.startsWith("cmp_"),
            `${name}: expected compound reference`,
          );
        }
      }
  }
  const allCases: unknown[] = [];
  for (const b of blocks.filter((b) => b.type === "sar-cases"))
    for (const c of list(cases[String(b.cases)], where)) {
      allCases.push(field(c, "id"));
      ok(isObject(c) && key(c.id), `${where}: invalid case id`);
      for (const k of ["title", "area", "change", "finding", "limit"])
        text(c[k], where);
      refs(c.ids, String(b.collection), where);
      refs(c.claims, "claims", where);
      const collection = checkedCollections.get(String(b.collection))!;
      structureFigures(
        c.structureFigures,
        collection.records.filter((r) => list(c.ids, where).includes(r.id)),
        collection.fields,
        where,
      );
    }
  unique(allCases, `${where}: SAR cases`);
}
/** Concrete routes also used by publication's internal-link checker. */
export function patentRoutePaths(content: {
  chapters?: readonly { blocks: readonly NestedBlock[] }[];
  data?: PatentData;
}): string[] {
  const data = content.data ?? {},
    paths = new Set<string>();
  for (const b of patentBlocks(content)) {
    if (b.type === "source-pages") {
      paths.add("/search");
      for (
        let n = 1;
        n <= Math.max(...Object.values(data.sources!).map((s) => s.pages));
        n++
      )
        paths.add(`/sources/pages/${n}`);
    }
    if (b.type === "record-collection") {
      const c = data.collections![b.collection];
      paths.add(`/${c.route}`);
      paths.add(`/${c.route}/compare`);
      for (const r of c.records) paths.add(`/${c.route}/${r.id}`);
    }
    if (b.type === "synthesis-network") paths.add(`/synthesis/${b.network}`);
    if (b.type === "claims") {
      paths.add("/claims");
      paths.add("/claims/compare");
      for (const c of data.claims![b.set].claims) paths.add(`/claims/${c.id}`);
    }
    if (b.type === "sar-cases") {
      paths.add("/sar");
      for (const c of data.sarCases![b.cases]) paths.add(`/sar/${c.id}`);
    }
  }
  return [...paths];
}
