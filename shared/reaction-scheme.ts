import type { MoleculeData } from "../src/ui/chemistry/types.ts";
import { validateAbbreviations } from "./molecule-abbreviations.ts";
import { isObject } from "./json.ts";

export interface SchemeCompound extends MoleculeData {
  number: string;
}
export interface ReactionStep {
  title: string;
  reactants: SchemeCompound[];
  products: SchemeCompound[];
  reagents: string[];
  conditions: string[];
  yield?: string;
  explanation: string;
}
export interface SynthesisRoute {
  id: string;
  title: string;
  core?: string;
  direction?: "forward" | "retro";
  steps: ReactionStep[];
}
export interface SubstrateScope {
  scheme: ReactionStep;
  groups: { key: string; label: string }[];
  readings: { key: string; label: string }[];
  rows: {
    number: string;
    substituents: Record<string, string>;
    yield: string;
    readings: Record<string, string>;
    product: MoleculeData;
  }[];
}
function requireValue(ok: unknown, where: string): asserts ok {
  if (!ok) throw new Error(where);
}
function text(value: unknown, where: string): asserts value is string {
  requireValue(
    typeof value === "string" && value.trim(),
    `${where} must be text`,
  );
}
export function validateReactionStep(
  value: unknown,
  at: string,
): asserts value is ReactionStep {
  requireValue(isObject(value), `${at} must be an object`);
  text(value.title, `${at}.title`);
  text(value.explanation, `${at}.explanation`);
  for (const key of ["reagents", "conditions"]) {
    const lines = value[key];
    requireValue(
      Array.isArray(lines) && lines.length,
      `${at}.${key} must be a list of lines`,
    );
    lines.forEach((line, i) => text(line, `${at}.${key}[${i}]`));
  }
  if (value.yield !== undefined) text(value.yield, `${at}.yield`);
  for (const side of ["reactants", "products"]) {
    const compounds = value[side];
    requireValue(
      Array.isArray(compounds) && compounds.length,
      `${at}.${side} needs compounds`,
    );
    for (const compound of compounds) {
      requireValue(isObject(compound), `${at}.${side} needs compounds`);
      for (const key of ["name", "smiles", "number"])
        text(compound[key], `${at}.${side}.${key}`);
      validateAbbreviations(compound.abbreviations, at);
    }
  }
}
export function validateSynthesisRoutes(
  value: unknown,
  at: string,
): asserts value is SynthesisRoute[] {
  requireValue(Array.isArray(value) && value.length, `${at} needs routes`);
  const ids = new Set<string>();
  for (const route of value) {
    requireValue(isObject(route), `${at} needs route objects`);
    text(route.id, `${at}.id`);
    text(route.title, `${at}.title`);
    requireValue(!ids.has(route.id), `${at} duplicate route ${route.id}`);
    ids.add(route.id);
    if (route.core !== undefined) text(route.core, `${at}.${route.id}.core`);
    requireValue(
      route.direction === undefined ||
        ["forward", "retro"].includes(String(route.direction)),
      `${at}.${route.id}.direction is invalid`,
    );
    requireValue(
      Array.isArray(route.steps) && route.steps.length,
      `${at}.${route.id} needs steps`,
    );
    route.steps.forEach((step, i) =>
      validateReactionStep(step, `${at}.${route.id}.steps[${i}]`),
    );
  }
}
export function validateSubstrateScope(
  value: unknown,
  at: string,
): asserts value is SubstrateScope {
  requireValue(isObject(value), `${at} needs a scope`);
  validateReactionStep(value.scheme, `${at}.scheme`);
  requireValue(
    value.scheme.products.length === 1,
    `${at}.scheme needs one product template`,
  );
  const keys: Record<string, string[]> = {};
  for (const field of ["groups", "readings"]) {
    const columns = value[field];
    requireValue(
      Array.isArray(columns) && (field !== "groups" || columns.length),
      `${at}.${field} needs columns`,
    );
    keys[field] = [];
    for (const column of columns) {
      requireValue(isObject(column), `${at}.${field} needs column objects`);
      text(column.key, at);
      text(column.label, at);
      requireValue(
        !keys[field].includes(column.key),
        `${at}.${field} duplicate key ${column.key}`,
      );
      if (field === "groups")
        requireValue(
          /^[1-9]\d*$/.test(column.key),
          `${at}.groups keys must be positive atom maps`,
        );
      keys[field].push(column.key);
    }
  }
  requireValue(
    Array.isArray(value.rows) && value.rows.length,
    `${at} needs rows`,
  );
  const numbers = new Set<string>();
  value.rows.forEach((row, i) => {
    const w = `${at}.rows[${i}]`;
    requireValue(isObject(row), `${w} needs a row`);
    text(row.number, `${w}.number`);
    text(row.yield, `${w}.yield`);
    requireValue(
      !numbers.has(row.number),
      `${w} duplicate number ${row.number}`,
    );
    numbers.add(row.number);
    for (const [field, expected] of [
      ["substituents", keys.groups],
      ["readings", keys.readings],
    ] as const) {
      const cells = row[field];
      requireValue(
        isObject(cells) && Object.keys(cells).length === expected.length,
        `${w}.${field} needs one value per column`,
      );
      for (const key of expected) text(cells[key], `${w}.${field}.${key}`);
    }
    requireValue(isObject(row.product), `${w}.product is required`);
    text(row.product.name, w);
    text(row.product.smiles, w);
    validateAbbreviations(row.product.abbreviations, w);
  });
}

/** Wrap units begin with an arrow. Independent branches start their own run. */
export function schemeRuns(route: SynthesisRoute) {
  const runs: {
    initial: SchemeCompound[];
    steps: { step: ReactionStep; index: number; after: SchemeCompound[] }[];
  }[] = [];
  route.steps.forEach((step, index) => {
    const previous = route.steps[index - 1];
    const connected =
      previous &&
      step.reactants.some((m) =>
        previous.products.some((p) => p.number === m.number),
      );
    if (!connected) runs.push({ initial: step.reactants, steps: [] });
    else {
      const extra = step.reactants.filter(
        (m) => !previous.products.some((p) => p.number === m.number),
      );
      runs
        .at(-1)!
        .steps.at(-1)!
        .after.push(...extra);
    }
    runs.at(-1)!.steps.push({ step, index, after: [...step.products] });
  });
  return runs;
}
