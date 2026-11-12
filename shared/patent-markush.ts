import { isObject } from "./json.ts";

export type Alternative = { id: string; label: string } & (
  | { type: "fragment"; smiles: string }
  | { type: "class"; smarts: string }
  | {
      type: "count";
      element: number;
      min: number;
      max: number;
      atomSmarts: string;
    }
  | {
      type: "substituted";
      core: string;
      group: string;
      min: number;
      max: number;
    }
  | { type: "repeat"; unit: string; end: string; min: number; max: number }
);
export interface MarkushGroup {
  label: string;
  alternatives: Alternative[];
  positions?: number[];
  unmodeled?: string;
}
export interface Markush {
  core: string;
  groups: Record<string, MarkushGroup>;
  note: string;
  unmodeled?: string;
  exclusions?: ({ id: string; label: string } & (
    { smarts: string } | { smiles: string }
  ))[];
}
export type MatchStatus = "matched" | "not-matched" | "unmodeled";
export interface GroupMatch {
  key: string;
  label: string;
  fragment: string;
  status: MatchStatus;
  alternatives: string[];
  note?: string;
}
export interface MarkushMatch {
  status: MatchStatus;
  reason: "within" | "groups" | "core" | "excluded" | "unmodeled";
  groups: GroupMatch[];
  exclusion?: string;
  outside?: string[];
}
/** Validate the persisted contract before chemistry parsing. */
export function validateMarkush(
  value: unknown,
  where: string,
): asserts value is Markush {
  const fail = (message: string): never => {
    throw new Error(`${where}: ${message}`);
  };
  const object = (v: unknown) => {
    if (!isObject(v)) return fail("invalid Markush object");
    return v;
  };
  const text = (v: unknown) => {
    if (typeof v !== "string" || !v.trim()) fail("expected nonempty text");
  };
  const range = (v: Record<string, unknown>) => {
    if (
      !Number.isSafeInteger(v.min) ||
      !Number.isSafeInteger(v.max) ||
      Number(v.min) < 0 ||
      Number(v.max) < Number(v.min)
    )
      fail("invalid range");
  };
  const m = object(value);
  text(m.core);
  text(m.note);
  if (m.unmodeled !== undefined) text(m.unmodeled);
  const groups = object(m.groups);
  for (const [key, v] of Object.entries(groups)) {
    if (!/^[1-9]\d*$/.test(key)) fail("invalid R key");
    const g = object(v);
    text(g.label);
    if (g.unmodeled !== undefined) text(g.unmodeled);
    if (
      !Array.isArray(g.alternatives) ||
      (!g.alternatives.length && !g.unmodeled)
    )
      fail("R needs alternatives or unmodeled reason");
    if (
      g.positions !== undefined &&
      (!Array.isArray(g.positions) ||
        !g.positions.length ||
        new Set(g.positions).size !== g.positions.length ||
        g.positions.some((p) => !Number.isSafeInteger(p) || p < 0))
    )
      fail("invalid positions");
    const ids = new Set();
    for (const v of g.alternatives as unknown[]) {
      const a = object(v);
      text(a.id);
      text(a.label);
      if (ids.has(a.id)) fail("duplicate alternative id");
      ids.add(a.id);
      switch (a.type) {
        case "fragment":
          text(a.smiles);
          break;
        case "class":
          text(a.smarts);
          break;
        case "count":
          range(a);
          text(a.atomSmarts);
          if (
            !Number.isSafeInteger(a.element) ||
            Number(a.element) < 1 ||
            Number(a.element) > 118
          )
            fail("invalid element");
          break;
        case "substituted":
          range(a);
          text(a.core);
          text(a.group);
          if (!Object.hasOwn(groups, String(a.group)))
            fail("undefined R reference");
          break;
        case "repeat":
          range(a);
          text(a.unit);
          text(a.end);
          break;
        default:
          fail("unknown alternative type");
      }
    }
  }
  const visited = new Set<string>();
  function visit(key: string, path: Set<string>) {
    if (path.has(key)) fail("cyclic R definitions");
    if (visited.has(key)) return;
    const next = new Set(path).add(key);
    for (const a of object(groups[key]).alternatives as Alternative[])
      if (a.type === "substituted") visit(a.group, next);
    visited.add(key);
  }
  for (const key of Object.keys(groups)) visit(key, new Set());
  if (m.exclusions !== undefined) {
    if (!Array.isArray(m.exclusions)) fail("invalid exclusions");
    const ids = new Set();
    for (const v of m.exclusions as unknown[]) {
      const e = object(v);
      text(e.id);
      text(e.label);
      if (ids.has(e.id)) fail("duplicate exclusion id");
      ids.add(e.id);
      if ((e.smarts === undefined) === (e.smiles === undefined))
        fail("exclusion needs one structure");
      text(e.smarts ?? e.smiles);
    }
  }
}
