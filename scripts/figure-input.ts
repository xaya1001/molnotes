import {
  validateMarkushFigure,
  type MarkushFigureData,
} from "../shared/chemical-library/markush.ts";
import {
  validateConformationSpec,
  type ConformationSpec,
} from "../shared/chemical-templates/conformation.ts";
import { isObject } from "../shared/json.ts";
import {
  optionalFigureAbbreviations,
  validateAbbreviations,
  type AbbreviationName,
  type MoleculeAbbreviation,
} from "../shared/molecule-abbreviations.ts";
import type { ArrowKind, Point } from "../shared/chemical-library/types.ts";

type Key = string | number;
export interface PushInput {
  id?: Key;
  from: string;
  to: string;
  electrons?: 1 | 2;
  side?: "left" | "right" | 1 | -1;
  bend?: number;
  forming?: boolean;
}
export interface StructureInput extends Omit<
  Partial<ConformationSpec>,
  "flip"
> {
  ring_h?: boolean;
  smiles?: string;
  text?: Key;
  label?: Key;
  name?: Key;
  rot?: number;
  flip?: boolean | "h" | "v";
  align?: boolean | Key;
  coordgen?: boolean;
  drawing?: "flat" | "perspective";
  abbreviate?: boolean;
  abbreviations?: (
    | MoleculeAbbreviation
    | { name: AbbreviationName; atom: number; expand: true }
  )[];
  numbers?: boolean;
  notes?: Record<string, Key>;
  arrows?: PushInput[];
  focus?: { primary?: Key[]; supporting?: Key[] };
  enclose?: {
    id?: Key;
    atoms?: number[];
    bonds?: number[][];
    shape?: "auto" | "circle" | "rect" | "outline";
  }[];
  scale?: number;
  bracket?: boolean | "ts";
  mark?: string;
  yield?: string;
  note?: Key;
}
export type Show = "box" | "text" | "plus" | "none";
type Sources = { source: Key; locator?: Key; note?: Key }[];
type MarkushInput = MarkushFigureData & {
  kind: "markush";
  title?: Key;
  sources?: Sources;
  footnote?: Key;
  bond?: number;
  width?: number;
};

export type SchemeCompound = StructureInput & {
  ref?: string;
  use?: string;
  variant?: string;
};
type StateAnnotations = {
  labels?: {
    id: Key;
    at: string;
    kind: "lonePair" | "radical" | "charge" | "partialCharge" | "text";
    text?: Key;
    offset?: Point;
  }[];
  arrows?: PushInput[];
  focus?: StructureInput["focus"];
  enclose?: StructureInput["enclose"];
  partialBonds?: { from: string; to: string; order?: number }[];
  transitionState?: boolean;
  tone?: "comparison";
};
export type SchemeState = StateAnnotations & {
  title?: Key;
  compounds?: Record<string, string | SchemeCompound>;
  text?: Key;
};
export type SchemeParticipant = {
  state: string;
  placement?: string;
  id?: string;
  show?: Show;
  equivalents?: number;
  yield?: string;
  ratio?: string;
  fraction?: number;
};
export type SchemeEndpoint = string | SchemeParticipant;
export type SchemeArrow = {
  title?: Key;
  sources?: Sources;
  above?: Key;
  below?: Key;
  others?: Show;
  turn?: "down" | "elbow" | "wrap";
  side?: "left" | "right";
  reverse?: boolean;
  changes?: boolean | "on" | "off" | { add?: number[]; remove?: number[] };
  enclose?: Record<string, NonNullable<StructureInput["enclose"]>>;
  tags?: string[];
  reagentPosition?: "above-arrow" | "below-arrow";
  from: SchemeEndpoint | SchemeEndpoint[];
  to: SchemeEndpoint | SchemeEndpoint[];
  kind: ArrowKind;
  role: "reaction" | "elementary" | "display";
  map?: Record<string, Key>;
  via?: SchemeGraph & {
    bind?: { from?: Record<string, string>; to?: Record<string, string> };
  };
  in?: Key;
  out?: Key;
};
export type SchemeGraph = {
  states: Record<string, SchemeState>;
  arrows: Record<string, SchemeArrow>;
  groups?: Record<
    string,
    StateAnnotations & {
      title?: Key;
      subtitle?: Key;
      items: string[];
      edges?: string[];
    }
  >;
  layout?: {
    cols?: number;
    anchor?: string;
    wrap?: "serpentine";
    radius?: number;
    branch?: number;
  };
  views?: Record<
    string,
    { items: string[]; arrows?: string[]; titles?: boolean }
  >;
  yields?: {
    arrows: string[];
    product: string;
    yield: string;
    sources?: Sources;
    note?: Key;
  }[];
};
export type SchemeInput = SchemeGraph & {
  kind: "scheme";
  id?: string;
  title?: Key;
  bond?: number;
  width?: number;
  sources?: Sources;
  footnote?: Key;
  coordgen?: boolean;
  ring_h?: boolean;
  forming?: boolean;
  abbreviate?: AbbreviationName[];
  mark?: string;
  changes?: boolean | "on" | "off";
};

type Rule = (v: unknown, path: string) => void;
function fail(p: string, message: string): never {
  throw new Error(`${p}: ${message}`);
}
const text: Rule = (v, p) => {
  if (typeof v !== "string" && (typeof v !== "number" || !Number.isFinite(v)))
    fail(p, "expected text or number");
};
const string: Rule = (v, p) => {
  if (typeof v !== "string") fail(p, "expected string");
};
const number: Rule = (v, p) => {
  if (typeof v !== "number" || !Number.isFinite(v))
    fail(p, "expected finite number");
};
const positiveNumber: Rule = (v, p) => {
  number(v, p);
  if (Number(v) <= 0) fail(p, "expected positive number");
};
const bool: Rule = (v, p) => {
  if (typeof v !== "boolean") fail(p, "expected boolean");
};
const choice =
  (...vs: unknown[]): Rule =>
  (v, p) => {
    if (!vs.includes(v)) fail(p, `expected ${vs.join(" | ")}`);
  };
const list =
  (rule: Rule): Rule =>
  (v, p) => {
    if (!Array.isArray(v)) fail(p, "expected list");
    else v.forEach((x, i) => rule(x, `${p}[${i}]`));
  };
const map =
  (rule: Rule): Rule =>
  (v, p) => {
    if (!isObject(v)) fail(p, "expected mapping");
    else Object.entries(v).forEach(([k, x]) => rule(x, `${p}.${k}`));
  };
const either =
  (...rules: Rule[]): Rule =>
  (v, p) => {
    for (const rule of rules) {
      try {
        rule(v, p);
        return;
      } catch {}
    }
    fail(p, "invalid value");
  };
const figureAbbreviations: Rule = (value, where) => {
  validateAbbreviations(value, where);
  for (const selection of value ?? []) {
    if (
      typeof selection === "object" &&
      "expand" in selection &&
      selection.expand !== true
    )
      fail(where, "expand must be true");
  }
};
const styles = new Set(["charges", "dots"]);
const deferred = new Set(["mark", "notes", "bend"]);
export function validateFigureInput(source: unknown): {
  input: MarkushInput | SchemeInput;
  warnings: string[];
} {
  if (!isObject(source)) fail("figure", "expected YAML mapping");
  const warnings: string[] = [];
  const object =
    (fields: Record<string, Rule>, required: string[] = []): Rule =>
    (v, p) => {
      if (!isObject(v)) fail(p, "expected mapping");
      else {
        for (const [k, x] of Object.entries(v)) {
          if (styles.has(k))
            fail(`${p}.${k}`, "website style field is not accepted");
          if (!fields[k]) fail(`${p}.${k}`, "unknown field");
          fields[k](x, `${p}.${k}`);
          if (deferred.has(k)) warnings.push(`${p}.${k}`);
        }
        for (const k of required)
          if (v[k] === undefined) fail(`${p}.${k}`, "required");
      }
    };
  const arrowKind = choice(
    "forward",
    "equilibrium",
    "resonance",
    "retro",
    "none",
  );
  const show = choice("box", "text", "plus", "none");
  const arrows = list(
    object(
      {
        id: text,
        from: string,
        to: string,
        electrons: choice(1, 2),
        forming: bool,
        side: choice("left", "right", 1, -1),
        bend: number,
      },
      ["from", "to"],
    ),
  );
  const focus = object({ primary: list(text), supporting: list(text) });
  const enclose = list(
    object({
      id: text,
      atoms: list(number),
      bonds: list((v, p) => {
        list(number)(v, p);
        if (!Array.isArray(v) || v.length !== 2) fail(p, "expected atom pair");
      }),
      shape: choice("auto", "circle", "rect", "outline"),
    }),
  );
  const structure = {
    smiles: string,
    text,
    label: text,
    name: text,
    rot: number,
    flip: choice(true, false, "h", "v"),
    align: either(bool, text),
    coordgen: bool,
    drawing: choice("flat", "perspective"),
    ring_h: bool,
    abbreviate: bool,
    abbreviations: figureAbbreviations,
    numbers: bool,
    notes: map(text),
    arrows,
    focus,
    enclose,
    scale: (v: unknown, p: string) => {
      number(v, p);
      if (Number(v) <= 0) fail(p, "expected positive scale");
    },
    bracket: choice(true, false, "ts"),
    mark: string,
    yield: string,
    note: text,
  };
  const quantity =
    (maximum = Infinity): Rule =>
    (v, p) => {
      number(v, p);
      if (Number(v) < 0 || Number(v) > maximum)
        fail(p, "quantity out of range");
    };
  const sources = list(
    object({ source: text, locator: text, note: text }, ["source"]),
  );

  if (source.kind === "markush") {
    validateMarkushFigure(source, "figure");
    object(
      {
        bond: positiveNumber,
        width: positiveNumber,
        scale: positiveNumber,
        kind: choice("markush"),
        title: text,
        sources,
        footnote: text,
        core: string,
        groups: () => {},
        view: choice("formula", "map", "overlay"),
        name: string,
        note: string,
        unmodeled: string,
        patents: map(string),
        gaps: () => {},
        gaps_title: string,
        rot: number,
        flip: choice("h", "v"),
      },
      ["core", "groups"],
    )(source, "figure");
    return { input: source as unknown as MarkushInput, warnings };
  }
  const structureRule: Rule = (v, p) => {
    if (isObject(v) && "template" in v) {
      const common = ["label", "name", "yield", "note", "text"];
      validateConformationSpec(v, p, common);
      for (const key of common)
        if (v[key] !== undefined) text(v[key], `${p}.${key}`);
    } else object(structure)(v, p);
  };
  const labels = list(
    object(
      {
        id: text,
        at: string,
        kind: choice("lonePair", "radical", "charge", "partialCharge", "text"),
        text,
        offset: object({ x: number, y: number }, ["x", "y"]),
      },
      ["id", "at", "kind"],
    ),
  );
  const annotations = {
    labels,
    arrows,
    focus,
    enclose,
    tone: choice("comparison"),
    transitionState: bool,
    partialBonds: list(
      object({ from: string, to: string, order: positiveNumber }, [
        "from",
        "to",
      ]),
    ),
  };
  const compound: Rule = (v, p) => {
    if (typeof v === "string") return;
    if (isObject(v) && "template" in v) return structureRule(v, p);
    object({ ...structure, ref: string, use: string, variant: string })(v, p);
    if (
      !isObject(v) ||
      [v.smiles, v.ref, v.use].filter((item) => item !== undefined).length !== 1
    )
      fail(p, "requires one of smiles, ref or use");
  };
  const item: Rule = (v, p) => {
    if (typeof v === "string") return;
    object(
      {
        state: string,
        placement: string,
        id: string,
        show,
        equivalents: quantity(),
        yield: string,
        ratio: string,
        fraction: quantity(1),
      },
      ["state"],
    )(v, p);
  };
  const end: Rule = (v, p) => {
    if (!Array.isArray(v)) return item(v, p);
    if (!v.length) fail(p, "requires an endpoint");
    list(item)(v, p);
  };
  const fields = {
    states: map((v, p) => {
      object({
        ...annotations,
        title: text,
        text,
        compounds: map(compound),
      })(v, p);
      if (
        isObject(v) &&
        v.text === undefined &&
        (!isObject(v.compounds) || !Object.keys(v.compounds).length)
      )
        fail(p, "requires compounds or text");
    }),
    arrows: map((v, p) =>
      object(
        {
          from: end,
          to: end,
          kind: arrowKind,
          role: choice("reaction", "elementary", "display"),
          title: text,
          sources,
          above: text,
          below: text,
          others: show,
          turn: choice("down", "elbow", "wrap"),
          side: choice("left", "right"),
          reverse: bool,
          changes: either(
            choice(true, false, "on", "off"),
            object({ add: list(number), remove: list(number) }),
          ),
          enclose: map(enclose),
          tags: list(string),
          reagentPosition: choice("above-arrow", "below-arrow"),
          map: map(either(number, string)),
          in: text,
          out: text,
          via: (v, p) => {
            object(
              {
                ...fields,
                bind: object({ from: map(string), to: map(string) }),
              },
              ["states", "arrows"],
            )(v, p);
          },
        },
        ["from", "to", "kind", "role"],
      )(v, p),
    ),
    groups: map(
      object(
        {
          ...annotations,
          title: text,
          subtitle: text,
          items: list(string),
          edges: list(string),
        },
        ["items"],
      ),
    ),
    layout: object({
      cols: (v, p) => {
        positiveNumber(v, p);
        if (!Number.isInteger(v)) fail(p, "expected integer");
      },
      anchor: string,
      wrap: choice("serpentine"),
      radius: positiveNumber,
      branch: positiveNumber,
    }),
    views: map(
      object({ items: list(string), arrows: list(string), titles: bool }, [
        "items",
      ]),
    ),
    yields: list(
      object(
        {
          arrows: list(string),
          product: string,
          yield: string,
          sources,
          note: text,
        },
        ["arrows", "product", "yield"],
      ),
    ),
  } satisfies Record<string, Rule>;
  object(
    {
      ...fields,
      kind: choice("scheme"),
      id: (v, p) => {
        if (typeof v !== "string" || !/^(rxn|rte|mec)_[a-z0-9_-]+$/.test(v))
          fail(p, "invalid figure ID");
      },
      title: text,
      bond: positiveNumber,
      width: positiveNumber,
      sources,
      footnote: text,
      coordgen: bool,
      ring_h: bool,
      forming: bool,
      abbreviate: list(choice(...optionalFigureAbbreviations)),
      mark: string,
      changes: choice(true, false, "on", "off"),
    },
    ["states", "arrows"],
  )(source, "figure");
  return {
    input: source as unknown as SchemeInput,
    warnings: warnings.length
      ? [`已保存、渲染待实现: ${warnings.join(", ")}`]
      : [],
  };
}
