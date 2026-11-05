import { isObject, isFiniteNumber } from "./json.ts";
import {
  validateAbbreviations,
  type MoleculeAbbreviation,
} from "./molecule-abbreviations.ts";

export interface MechanismMolecule {
  id: string;
  name: string;
  smiles: string;
  /** One persistent positive map number per atom in SMILES parse order. */
  atomMap: number[];
  /** Relative centre in shared bond-length units. */
  position: { x: number; y: number };
  rotation?: number;
  substituents?: { key: number; atoms: number[]; attachment: number }[];
  abbreviations?: MoleculeAbbreviation[];
}
export type MechanismAnchor =
  | { atom: number }
  | { bond: [number, number] }
  | { lonePair: number }
  | { charge: number }
  | { forming: [number, number] };
export interface MechanismArrow {
  from: MechanismAnchor;
  to: MechanismAnchor;
  electrons: 1 | 2;
  /** Signed curvature; omitted selects the least obstructed side. */
  bend?: number;
}
export interface MechanismFrame {
  title?: string;
  explanation: string;
  molecules: MechanismMolecule[];
  arrows: MechanismArrow[];
  lonePairs?: { atom: number; angle: number }[];
  partialCharges?: { atom: number; charge: "+" | "-"; angle?: number }[];
  partialBonds?: [number, number][];
  transitionState?: boolean;
  step?: { title: string; reversible: boolean; definitions?: string[] };
}
export interface CatalyticCycle {
  /** One molecule id in each corresponding frame, in reaction order. */
  intermediates: string[];
  steps: {
    title: string;
    branches?: {
      direction: "in" | "out";
      frame: number;
      molecule: string;
    }[];
  }[];
}
function assert(test: unknown, where: string): asserts test {
  if (!test) throw new Error(where);
}
function text(x: unknown): x is string {
  return typeof x === "string" && !!x.trim();
}
function map(x: unknown): x is number {
  return typeof x === "number" && Number.isSafeInteger(x) && x > 0;
}
export function anchorMaps(anchor: MechanismAnchor): number[] {
  if ("atom" in anchor) return [anchor.atom];
  if ("lonePair" in anchor) return [anchor.lonePair];
  if ("charge" in anchor) return [anchor.charge];
  return "bond" in anchor ? anchor.bond : anchor.forming;
}
export function validateMechanismFrames(
  value: unknown,
  where: string,
): asserts value is MechanismFrame[] {
  assert(Array.isArray(value) && value.length, `${where}: needs frames`);
  value.forEach((f: unknown, index: number) => {
    const at = `${where} frame ${index + 1}`;
    assert(isObject(f) && text(f.explanation), `${at}: needs explanation`);
    assert(f.title === undefined || text(f.title), `${at}: invalid title`);
    assert(
      Array.isArray(f.molecules) && f.molecules.length,
      `${at}: needs mapped molecules`,
    );
    const maps = new Set<number>(),
      ids = new Set<string>();
    for (const m of f.molecules) {
      assert(
        isObject(m) && text(m.id) && text(m.name) && text(m.smiles),
        `${at}: invalid molecule`,
      );
      assert(!ids.has(m.id), `${at}: duplicate molecule id ${m.id}`);
      ids.add(m.id);
      assert(
        Array.isArray(m.atomMap) && m.atomMap.length && m.atomMap.every(map),
        `${at}: needs atomMap`,
      );
      for (const id of m.atomMap) {
        assert(!maps.has(id), `${at}: duplicate atom map ${id}`);
        maps.add(id);
      }
      assert(
        isObject(m.position) &&
          isFiniteNumber(m.position.x) &&
          isFiniteNumber(m.position.y),
        `${at}: needs relative position`,
      );
      assert(
        m.rotation === undefined || isFiniteNumber(m.rotation),
        `${at}: invalid rotation`,
      );
      validateAbbreviations(m.abbreviations, at);
    }
    const atom = (x: unknown) => {
      assert(map(x) && maps.has(x), `${at}: unknown atom map ${x}`);
    };
    const pair = (x: unknown) => {
      assert(
        Array.isArray(x) && x.length === 2 && x[0] !== x[1],
        `${at}: needs two atom maps`,
      );
      x.forEach(atom);
    };
    if (f.step !== undefined) {
      assert(
        isObject(f.step) &&
          text(f.step.title) &&
          typeof f.step.reversible === "boolean",
        `${at}: step needs title and reversible`,
      );
      assert(
        f.step.definitions === undefined ||
          (Array.isArray(f.step.definitions) && f.step.definitions.every(text)),
        `${at}: invalid substituent definitions`,
      );
    }
    for (const m of f.molecules)
      if (isObject(m) && m.substituents !== undefined) {
        assert(Array.isArray(m.substituents), `${at}: invalid substituents`);
        for (const g of m.substituents) {
          assert(
            isObject(g) &&
              map(g.key) &&
              Array.isArray(g.atoms) &&
              g.atoms.length &&
              new Set(g.atoms).size === g.atoms.length,
            `${at}: invalid substituent`,
          );
          g.atoms.forEach(atom);
          atom(g.attachment);
        }
      }
    for (const [key, kind] of [
      ["lonePairs", "pair"],
      ["partialCharges", "charge"],
    ] as const) {
      if (f[key] === undefined) continue;
      assert(Array.isArray(f[key]), `${at}: invalid ${key}`);
      for (const a of f[key]) {
        assert(isObject(a), `${at}: invalid ${key}`);
        atom(a.atom);
        assert(
          (a.angle === undefined && kind === "charge") ||
            isFiniteNumber(a.angle),
          `${at}: invalid annotation angle`,
        );
        if (kind === "charge")
          assert(
            a.charge === "+" || a.charge === "-",
            `${at}: invalid partial charge`,
          );
      }
    }
    assert(
      f.transitionState === undefined || typeof f.transitionState === "boolean",
      `${at}: invalid transitionState`,
    );
    if (f.partialBonds !== undefined) {
      assert(Array.isArray(f.partialBonds), `${at}: invalid partialBonds`);
      f.partialBonds.forEach(pair);
    }
    assert(Array.isArray(f.arrows), `${at}: needs arrows`);
    for (const a of f.arrows) {
      assert(isObject(a), `${at}: invalid arrow`);
      for (const end of [a.from, a.to]) {
        assert(
          isObject(end) && Object.keys(end).length === 1,
          `${at}: invalid endpoint`,
        );
        const key = Object.keys(end)[0];
        if (key === "bond" || key === "forming") pair(end[key]);
        else {
          assert(
            ["atom", "lonePair", "charge"].includes(key),
            `${at}: invalid endpoint kind`,
          );
          atom(end[key]);
        }
        if (key === "lonePair")
          assert(
            Array.isArray(f.lonePairs) &&
              f.lonePairs.some((p) => isObject(p) && p.atom === end[key]),
            `${at}: missing lone pair`,
          );
      }
      assert(
        a.electrons === 1 || a.electrons === 2,
        `${at}: electrons must be 1 or 2`,
      );
      assert(
        a.bend === undefined || isFiniteNumber(a.bend),
        `${at}: invalid bend`,
      );
    }
  });
}
export function validateCatalyticCycle(
  value: unknown,
  frames: MechanismFrame[],
  where: string,
): asserts value is CatalyticCycle | undefined {
  if (value === undefined) return;
  assert(
    isObject(value) &&
      Array.isArray(value.intermediates) &&
      Array.isArray(value.steps) &&
      frames.length >= 3 &&
      value.steps.length === frames.length &&
      value.intermediates.length === frames.length,
    `${where}: cycle needs one intermediate and step per frame (at least three)`,
  );
  value.intermediates.forEach((id, i) =>
    assert(
      frames[i].molecules.some((m) => m.id === id),
      `${where}: unknown cycle intermediate ${id}`,
    ),
  );
  for (const step of value.steps) {
    assert(
      isObject(step) && text(step.title),
      `${where}: cycle step needs title`,
    );
    if (step.branches === undefined) continue;
    assert(Array.isArray(step.branches), `${where}: invalid cycle branches`);
    for (const b of step.branches) {
      assert(
        isObject(b) &&
          (b.direction === "in" || b.direction === "out") &&
          typeof b.frame === "number" &&
          Number.isInteger(b.frame) &&
          b.frame >= 0 &&
          b.frame < frames.length &&
          frames[b.frame].molecules.some((m) => m.id === b.molecule),
        `${where}: cycle branch needs a mapped frame molecule`,
      );
    }
  }
}
