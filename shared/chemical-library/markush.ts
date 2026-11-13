import { isObject } from "../json.ts";
import { validateMarkush, type Alternative } from "../patent-markush.ts";

type DrawingAlternative = {
  [K in Alternative["type"]]: Omit<Extract<Alternative, { type: K }>, "id">;
}[Alternative["type"]];
export type MarkushAlternative = (
  DrawingAlternative | { label: string; type?: undefined }
) & {
  id?: string;
  examples?: number | (string | number)[];
  by?: Record<string, number | (string | number)[]>;
};
export interface MarkushFigureData {
  core: string;
  view?: "formula" | "map" | "overlay";
  name?: string;
  note?: string;
  unmodeled?: string;
  rot?: number;
  flip?: "h" | "v";
  groups: Record<
    string,
    {
      label: string;
      alternatives: MarkushAlternative[];
      positions?: number[];
      count?: string;
      unmodeled?: string;
      outside?: (
        | string
        | { label: string; by?: Record<string, number | (string | number)[]> }
      )[];
    }
  >;
  patents?: Record<string, string>;
  gaps_title?: string;
  gaps?: { parts: string[]; note?: string }[];
}

/** Markush chemistry fields retain the query model's contract; coverage is authored evidence. */
export function validateMarkushFigure(
  value: unknown,
  where: string,
): asserts value is MarkushFigureData {
  function fail(message: string): never {
    throw new Error(`${where}: ${message}`);
  }
  const text = (v: unknown) => {
    if (typeof v !== "string" || !v.trim()) fail("expected text");
  };
  if (!isObject(value) || !isObject(value.groups))
    fail("expected Markush figure");
  const v = value as Record<string, unknown> & {
    groups: Record<string, unknown>;
  };
  if (
    v.view !== undefined &&
    !["formula", "map", "overlay"].includes(String(v.view))
  )
    fail("invalid Markush view");
  for (const key of ["name", "note", "unmodeled", "gaps_title"])
    if (v[key] !== undefined) text(v[key]);
  if (
    v.rot !== undefined &&
    (typeof v.rot !== "number" || !Number.isFinite(v.rot))
  )
    fail("invalid rotation");
  if (v.flip !== undefined && v.flip !== "h" && v.flip !== "v")
    fail("invalid flip");
  if (v.patents !== undefined) {
    if (!isObject(v.patents) || !Object.keys(v.patents).length)
      fail("expected patents");
    Object.values(v.patents).forEach(text);
  }
  if (v.view === "overlay" && v.patents === undefined)
    fail("overlay requires patents");
  const counts = (data: unknown) => {
    if (typeof data === "number" && Number.isSafeInteger(data) && data >= 0)
      return;
    if (
      Array.isArray(data) &&
      data.every(
        (x) =>
          typeof x === "string" ||
          (typeof x === "number" && Number.isFinite(x)),
      )
    )
      return;
    fail("expected example count or IDs");
  };
  const by = (data: unknown) => {
    if (!isObject(data)) fail("expected per-patent coverage");
    for (const [key, count] of Object.entries(data)) {
      if (!isObject(v.patents) || !Object.hasOwn(v.patents, key))
        fail("unknown coverage patent");
      counts(count);
    }
  };
  const groups = Object.fromEntries(
    Object.entries(v.groups).map(([key, data]) => {
      if (!isObject(data) || !Array.isArray(data.alternatives))
        fail("expected R alternatives");
      const g = data as Record<string, unknown> & { alternatives: unknown[] };
      if (g.count !== undefined) text(g.count);
      const alternatives = g.alternatives.map((a, i) => {
        if (!isObject(a)) fail("expected alternative");
        const alt = a as Record<string, unknown>;
        text(alt.label);
        if (alt.examples !== undefined) counts(alt.examples);
        if (alt.by !== undefined) by(alt.by);
        return alt.type === undefined
          ? {
              id: alt.id ?? String(i),
              label: alt.label,
              type: "class",
              smarts: "*",
            }
          : { ...alt, id: alt.id ?? String(i) };
      });
      if (g.outside !== undefined) {
        if (!Array.isArray(g.outside)) fail("expected outside alternatives");
        for (const a of g.outside as unknown[]) {
          if (typeof a === "string") text(a);
          else if (isObject(a)) {
            text(a.label);
            if (a.by !== undefined) by(a.by);
          } else fail("invalid outside alternative");
        }
      }
      return [key, { ...g, alternatives }];
    }),
  );
  validateMarkush(
    { core: v.core, note: v.note ?? "Figure", groups, unmodeled: v.unmodeled },
    where,
  );
  if (v.gaps !== undefined) {
    if (!Array.isArray(v.gaps)) fail("expected gap combinations");
    for (const gap of v.gaps as unknown[]) {
      if (!isObject(gap) || !Array.isArray(gap.parts) || !gap.parts.length)
        fail("expected gap parts");
      const g = gap as { parts: unknown[]; note?: unknown };
      g.parts.forEach(text);
      if (g.note !== undefined) text(g.note);
    }
  }
}
