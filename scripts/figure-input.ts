import {
  validateMarkushFigure,
  type MarkushFigureData,
} from "../shared/chemical-library/markush.ts";
import { isObject } from "../shared/json.ts";
import type { ArrowKind } from "../shared/chemical-library/types.ts";

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
export interface StructureInput {
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
export interface StepInput {
  enclose?: Record<string, NonNullable<StructureInput["enclose"]>>;
  id?: Key;
  title?: Key;
  sources?: FigureInput["sources"];
  from: Key | (Key | { id: Key; show?: Show; equivalents?: number })[];
  to: Key | ProductInput | (Key | ProductInput)[];
  above?: Key;
  below?: Key;
  others?: Show;
  turn?: "down" | "elbow" | "wrap";
  side?: "left" | "right";
  reverse?: boolean;
  changes?: boolean | "on" | "off" | { add?: number[]; remove?: number[] };
  explain?: Key;
  arrow?: ArrowKind;
  tags?: string[];
  reagentPosition?: "above-arrow" | "below-arrow";
}
export type Show = "box" | "text" | "plus" | "none";
export type ProductInput = {
  id: Key;
  ratio?: string;
  yield?: string;
  fraction?: number;
};
export interface FrameInput extends StructureInput {
  id: Key;
  title?: Key;
  smiles: string;
  map?: Record<string, number>;
  explain?: Key;
  above?: Key;
  below?: Key;
  arrow?: ArrowKind;
}
export interface CycleStepInput {
  in?: Key;
  out?: Key;
  label?: Key;
}
export interface FigureInput {
  bond?: number;
  width?: number;
  scale?: number;
  abbreviate?: ("Ph" | "Trt" | "Bz")[];
  kind?: "route" | "mechanism" | "markush" | "gallery" | "scope" | "cycle";
  core?: MarkushFigureData["core"];
  groups?: MarkushFigureData["groups"];
  view?: MarkushFigureData["view"];
  name?: string;
  note?: string;
  unmodeled?: string;
  patents?: MarkushFigureData["patents"];
  gaps?: MarkushFigureData["gaps"];
  gaps_title?: string;
  rot?: number;
  flip?: "h" | "v";
  title?: Key;
  explain?: Key;
  sources?: { source: Key; locator?: Key; note?: Key }[];
  compounds?: Record<string, string | StructureInput>;
  steps?: StepInput[];
  cycleSteps?: CycleStepInput[];
  scopeGroups?: { title?: Key; subtitle?: Key; items: Key[] }[];
  cols?: number;
  nodes?: (Key | StructureInput)[];
  radius?: number;
  branch?: number;
  frames?: FrameInput[];
  coordgen?: boolean;
  forming?: boolean;
  anchor?: Key;
  wrap?: "serpentine";
  footnote?: Key;
  mark?: string;
  changes?: boolean | "on" | "off";
}

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
const styles = new Set(["charges", "dots", "ring_h"]);
const deferred = new Set(["mark", "notes", "bend"]);
export function validateFigureInput(value: unknown): {
  input: FigureInput;
  warnings: string[];
} {
  const warnings: string[] = [];
  const object =
    (fields: Record<string, Rule>, required: string[] = []): Rule =>
    (v, p) => {
      if (!isObject(v)) fail(p, "expected mapping");
      else {
        if ("template" in v) fail(`${p}.template`, "尚未支持");
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
    abbreviate: bool,
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
  const product = object(
    { id: text, ratio: string, yield: string, fraction: quantity(1) },
    ["id"],
  );
  const from = either(
    text,
    list(
      either(text, object({ id: text, show, equivalents: quantity() }, ["id"])),
    ),
  );
  const to = either(text, product, list(either(text, product)));
  const sources = list(
    object({ source: text, locator: text, note: text }, ["source"]),
  );
  const step = object(
    {
      id: text,
      title: text,
      sources,
      from,
      to,
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
      explain: text,
      arrow: arrowKind,
      tags: list(string),
      reagentPosition: choice("above-arrow", "below-arrow"),
    },
    ["from", "to"],
  );
  if (!isObject(value)) fail("figure", "expected YAML mapping");
  const kind = value.kind ?? "route";
  if (kind === "markush") {
    validateMarkushFigure(value, "figure");
    object(
      {
        bond: positiveNumber,
        width: positiveNumber,
        scale: positiveNumber,
        kind: choice("markush"),
        title: text,
        sources,
        explain: text,
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
    )(value, "figure");
    return { input: value as unknown as FigureInput, warnings };
  }
  if (kind === "table") fail("figure.kind", "尚未支持");
  if (
    !["route", "mechanism", "gallery", "scope", "cycle"].includes(String(kind))
  )
    fail("figure.kind", "expected route | mechanism | gallery | scope | cycle");
  const shared = {
    bond: positiveNumber,
    width: positiveNumber,
    kind: choice("route", "mechanism", "gallery", "scope", "cycle"),
    title: text,
    explain: text,
    sources,
    coordgen: bool,
    forming: bool,
    footnote: text,
    abbreviate: list(choice("Ph", "Trt", "Bz")),
    mark: string,
  };
  const compounds = map((v, p) =>
    typeof v === "string" ? string(v, p) : object(structure)(v, p),
  );
  const positive: Rule = (v, p) => {
    number(v, p);
    if (Number(v) <= 0) fail(p, "expected positive number");
  };
  if (kind === "gallery" || kind === "scope")
    object(
      {
        ...shared,
        compounds,
        ...(kind === "gallery"
          ? {
              cols: (v: unknown, p: string) => {
                positive(v, p);
                if (!Number.isInteger(v)) fail(p, "expected integer");
              },
            }
          : {
              groups: list(
                object({ title: text, subtitle: text, items: list(text) }, [
                  "items",
                ]),
              ),
            }),
      },
      kind === "scope" ? ["compounds", "groups"] : ["compounds"],
    )(value, "figure");
  else if (kind === "cycle")
    object(
      {
        ...shared,
        nodes: list(either(text, object(structure))),
        steps: list(object({ in: text, out: text, label: text })),
        radius: positive,
        branch: positive,
      },
      ["nodes"],
    )(value, "figure");
  else if (kind === "route")
    object(
      {
        ...shared,
        compounds,
        steps: list(step),
        anchor: text,
        wrap: choice("serpentine"),
        changes: choice(true, false, "on", "off"),
      },
      ["compounds", "steps"],
    )(value, "figure");
  else
    object(
      {
        ...shared,
        frames: list(
          object(
            {
              smiles: string,
              rot: number,
              flip: choice("h", "v"),
              coordgen: bool,
              drawing: structure.drawing,
              bracket: structure.bracket,
              scale: structure.scale,
              numbers: bool,
              notes: map(text),
              arrows,
              focus,
              enclose,
              id: text,
              title: text,
              map: map(number),
              explain: text,
              above: text,
              below: text,
              arrow: arrowKind,
            },
            ["id", "smiles"],
          ),
        ),
      },
      ["frames"],
    )(value, "figure");
  // The complete untrusted boundary above establishes the authoring type.
  // Scope groups and cycle steps retain their separate validated contracts.
  const input = (kind === "cycle"
    ? { ...value, steps: undefined, cycleSteps: value.steps }
    : kind === "scope"
      ? { ...value, groups: undefined, scopeGroups: value.groups }
      : value) as unknown as FigureInput;
  if (
    kind === "route" &&
    (!input.steps!.length || !Object.keys(input.compounds!).length)
  )
    fail("figure", "requires compounds and steps");
  if (kind === "mechanism" && !input.frames!.length)
    fail("figure.frames", "requires frames");
  if (
    (kind === "gallery" || kind === "scope") &&
    !Object.keys(input.compounds!).length
  )
    fail("figure.compounds", "requires compounds");
  if (kind === "scope") {
    if (!input.scopeGroups!.length) fail("figure.groups", "requires groups");
    for (const [i, group] of input.scopeGroups!.entries()) {
      if (!group.items.length)
        fail(`figure.groups[${i}].items`, "requires compounds");
      for (const key of group.items)
        if (!Object.hasOwn(input.compounds!, String(key)))
          fail(`figure.groups[${i}].items`, `unknown compound ${key}`);
    }
  }
  if (kind === "cycle") {
    if (input.nodes!.length < 2)
      fail("figure.nodes", "requires at least two species");
    if (input.cycleSteps && input.cycleSteps.length !== input.nodes!.length)
      fail("figure.steps", "requires one step per species");
  }
  const pending = ["gallery", "scope", "cycle"].includes(String(kind))
    ? warnings.filter((path) => !path.endsWith(".mark"))
    : warnings;
  return {
    input,
    warnings: pending.length
      ? [`已保存、渲染待实现: ${pending.join(", ")}`]
      : [],
  };
}
