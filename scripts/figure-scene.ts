import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isObject } from "../shared/json.ts";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  prepareCompound,
  graphOf,
  openMolecule,
} from "../shared/chemical-library/chemistry.ts";
import { abbreviatedGroups } from "../shared/molecule-abbreviations.ts";
import type {
  Anchor,
  Compound,
  Library,
  Point,
  Scene,
  AtomRef,
  Evidence,
} from "../shared/chemical-library/types.ts";

interface MoleculeInput {
  smiles?: string;
  ref?: string;
  variant?: string;
  molfile?: string;
  labels?: string[];
  rightOf?: string;
  leftOf?: string;
  above?: string;
  below?: string;
  gap?: number;
  offset?: [number, number];
  rotate?: number;
  orient?: "auto" | "keep";
  wedges?: Array<{ from: string; to: string; style: "solid" | "hashed" }>;
  chargeAngles?: Record<string, number>;
  methyl?: boolean;
  plus?: boolean;
  number?: string;
  yield?: number;
}
interface ReactionInput {
  id?: string;
  from: string;
  to: string;
  kind?: "forward" | "equilibrium";
  above?: string[];
  below?: string[];
  byproduct?: string;
  aboveMolecule?: string;
  belowMolecule?: string;
  lane?: "bottom";
  tone?: "comparison";
}
export interface FigureSceneInput {
  title: string;
  molecules: Record<string, MoleculeInput>;
  arrows?: Array<
    | string
    | {
        from: string;
        to: string;
        tone?: "comparison";
        bend?: "left" | "right";
        electrons?: 1 | 2;
      }
  >;
  reactions?: ReactionInput[];
  captions?: Record<string, string>;
  comparison?: boolean;
  focus?: string[];
}
function validateSceneInput(value: unknown): asserts value is FigureSceneInput {
  const object = (v: unknown, where: string): Record<string, unknown> => {
    if (!isObject(v)) throw new Error(`${where}: expected object`);
    return v;
  };
  const text = (v: unknown, where: string) => {
    if (typeof v !== "string" || !v.trim())
      throw new Error(`${where}: expected text`);
  };
  const number = (v: unknown, where: string) => {
    if (typeof v !== "number" || !Number.isFinite(v))
      throw new Error(`${where}: expected finite number`);
  };
  const array = (v: unknown, where: string): unknown[] => {
    if (!Array.isArray(v)) throw new Error(`${where}: expected array`);
    return v;
  };
  const strings = (v: unknown, where: string) =>
    array(v, where).forEach((x) => text(x, where));
  const choice = (v: unknown, allowed: unknown[], where: string) => {
    if (v !== undefined && !allowed.includes(v))
      throw new Error(`${where}: invalid value`);
  };
  const input = object(value, "scene");
  text(input.title, "title");
  const molecules = object(input.molecules, "molecules");
  if (!Object.keys(molecules).length)
    throw new Error("Scene requires molecules");
  for (const [name, raw] of Object.entries(molecules)) {
    const m = object(raw, name);
    if (!!m.ref === !!m.smiles)
      throw new Error(`${name}: supply either smiles or ref`);
    for (const k of [
      "smiles",
      "ref",
      "variant",
      "molfile",
      "rightOf",
      "leftOf",
      "above",
      "below",
      "number",
    ])
      if (m[k] !== undefined) text(m[k], `${name}.${k}`);
    if (m.variant !== undefined && !m.ref)
      throw new Error(`${name}: variant requires a compound ref`);
    for (const k of ["gap", "rotate", "yield"])
      if (m[k] !== undefined) number(m[k], `${name}.${k}`);
    if (m.offset !== undefined) {
      const xy = array(m.offset, `${name}.offset`);
      if (xy.length !== 2)
        throw new Error(`${name}.offset: expected two coordinates`);
      xy.forEach((v) => number(v, `${name}.offset`));
    }
    choice(m.orient, ["auto", "keep"], `${name}.orient`);
    for (const k of ["methyl", "plus"])
      choice(m[k], [true, false], `${name}.${k}`);
    if (m.labels !== undefined) strings(m.labels, `${name}.labels`);
    if (m.chargeAngles !== undefined)
      Object.values(object(m.chargeAngles, `${name}.chargeAngles`)).forEach(
        (v) => number(v, `${name}.chargeAngles`),
      );
    if (m.wedges !== undefined)
      for (const raw of array(m.wedges, `${name}.wedges`)) {
        const wedge = object(raw, "wedge");
        text(wedge.from, "wedge.from");
        text(wedge.to, "wedge.to");
        if (!["solid", "hashed"].includes(String(wedge.style)))
          throw new Error("Invalid wedge style");
      }
  }
  if (input.arrows !== undefined)
    for (const raw of array(input.arrows, "arrows")) {
      if (typeof raw === "string") continue;
      const a = object(raw, "arrow");
      text(a.from, "arrow.from");
      text(a.to, "arrow.to");
      choice(a.tone, ["comparison"], "arrow.tone");
      choice(a.bend, ["left", "right"], "arrow.bend");
      choice(a.electrons, [1, 2], "arrow.electrons");
    }
  if (input.reactions !== undefined)
    for (const raw of array(input.reactions, "reactions")) {
      const r = object(raw, "reaction");
      text(r.from, "reaction.from");
      text(r.to, "reaction.to");
      for (const k of ["id", "byproduct", "aboveMolecule", "belowMolecule"])
        if (r[k] !== undefined) text(r[k], `reaction.${k}`);
      for (const k of ["above", "below"])
        if (r[k] !== undefined) strings(r[k], `reaction.${k}`);
      choice(r.kind, ["forward", "equilibrium"], "reaction.kind");
      choice(r.lane, ["bottom"], "reaction.lane");
      choice(r.tone, ["comparison"], "reaction.tone");
    }
  if (input.captions !== undefined)
    Object.values(object(input.captions, "captions")).forEach((v) =>
      text(v, "caption"),
    );
  if (input.focus !== undefined) strings(input.focus, "focus");
  choice(input.comparison, [true, false], "comparison");
}
type Box = { left: number; right: number; top: number; bottom: number };
/** Compile the short authoring language into the same persistent graph/scene
 * contract used by the site. No case names or example-specific coordinates. */
export async function compileFigureScene(
  input: unknown,
  existing: Library = {},
  directory = ".",
  identity?: { id: string; sources: Evidence[] },
) {
  validateSceneInput(input);
  const rd = await moleculeToolkit(),
    entries: Library = { ...existing };
  const compounds = new Map<string, Compound>(),
    handles = new Map<string, ReturnType<typeof rd.get_mol>>();
  const names = Object.keys(input.molecules),
    scene: Scene = {
      width: 1,
      height: 1,
      molecules: [],
      arrows: [],
      labels: [],
      reactionArrows: [],
      captions: [],
      comparison: input.comparison,
    };
  const atomIndex = (c: Compound, id: string) => c.atomIds.indexOf(id);
  try {
    for (const [name, spec] of Object.entries(input.molecules)) {
      const id = "cmp_" + (identity ? identity.id + "_" : "scene_") + name;
      let c: Compound;
      if (spec.ref) {
        const source = existing[spec.ref];
        if (source?.kind !== "compound")
          throw new Error(`${name}: unknown compound ${spec.ref}`);
        c = structuredClone(source);
        if (spec.variant) {
          const variant = c.variants?.[spec.variant];
          if (!variant)
            throw new Error(`${name}: unknown variant ${spec.variant}`);
          c.layout = structuredClone(variant);
        }
      } else {
        if (!spec.smiles) throw new Error(`${name}: supply smiles or ref`);
        c = prepareCompound(
          rd,
          {
            id,
            title: name,
            smiles: spec.smiles,
            sources: identity?.sources ?? [
              { source: "authored-scene", locator: input.title },
            ],
          },
          spec.molfile
            ? await readFile(resolve(directory, spec.molfile), "utf8")
            : undefined,
        );
      }
      c.id = id;
      const m = openMolecule(
        rd,
        c.layout.molblock ?? c.smiles,
        !c.layout.molblock,
      );
      handles.set(name, m);
      compounds.set(name, c);
      entries[id] = c;
      const graph = graphOf(m);
      const dummy = graph.atoms.flatMap((a, i) =>
        a.z === 0 ? [c.atomIds[i]] : [],
      );
      if (spec.labels) {
        if (spec.labels.length !== dummy.length)
          throw new Error(`${name}: one label per dummy atom required`);
        c.template = dummy.map((atom, i) => ({
          atom,
          label: spec.labels![i],
          allowed: [],
          description: "Authored generic site",
        }));
      }
      const matches = (smarts: string) => {
        const q = rd.get_qmol(smarts);
        if (!q) throw new Error(`Invalid selector ${smarts}`);
        try {
          return JSON.parse(m.get_substruct_matches(q)) as {
            atoms: number[];
            bonds: number[];
          }[];
        } finally {
          q.delete();
        }
      };
      if (!spec.ref && !spec.molfile && spec.orient !== "keep") {
        const carbonyl = matches("[C]=[O]")[0];
        let angle = 0;
        if (carbonyl) {
          const [ci, oi] = carbonyl.atoms,
            p = c.layout.coords[c.atomIds[ci]],
            q = c.layout.coords[c.atomIds[oi]];
          angle = -Math.PI / 2 - Math.atan2(q.y - p.y, q.x - p.x);
        }
        if (angle)
          for (const p of Object.values(c.layout.coords)) {
            const x = p.x;
            p.x = x * Math.cos(angle) - p.y * Math.sin(angle);
            p.y = x * Math.sin(angle) + p.y * Math.cos(angle);
          }
        // Put the larger carbonyl substituent on the left. RDKit retains stereo
        // from the source when it wedges the transformed conformer.
        if (carbonyl) {
          const ci = carbonyl.atoms[0],
            center = c.layout.coords[c.atomIds[ci]];
          let moment = 0;
          for (let i = 0; i < graph.atoms.length; i++)
            if (i !== carbonyl.atoms[1])
              moment += c.layout.coords[c.atomIds[i]].x - center.x;
          if (moment > 0)
            for (const p of Object.values(c.layout.coords)) p.x = -p.x;
        }
      }
      if (!spec.ref && !spec.molfile && spec.orient !== "keep") {
        // Standard planar projection for a generic tetrahedral acyl intermediate.
        // Move whole substituent branches; graph identity remains unchanged.
        for (let center = 0; center < graph.atoms.length; center++) {
          const neighbors = graph.bonds
            .filter((b) => b.atoms.includes(center))
            .map((b) => b.atoms.find((i) => i !== center)!);
          const oxygen = neighbors.find((i) => graph.atoms[i].z === 8);
          const sites = neighbors.filter((i) => graph.atoms[i].z === 0);
          if (
            neighbors.length !== 4 ||
            oxygen === undefined ||
            sites.length !== 2
          )
            continue;
          const o = c.layout.coords[c.atomIds[center]];
          for (const neighbor of neighbors) {
            const symbol = c.template?.find(
              (t) => t.atom === c.atomIds[neighbor],
            )?.label;
            const target =
              neighbor === oxygen
                ? -Math.PI / 2
                : symbol === "Nu"
                  ? Math.PI / 2
                  : graph.atoms[neighbor].z === 0
                    ? Math.PI / 6
                    : (Math.PI * 5) / 6;
            const p = c.layout.coords[c.atomIds[neighbor]],
              angle = target - Math.atan2(p.y - o.y, p.x - o.x);
            const seen = new Set([center]),
              todo = [neighbor];
            while (todo.length) {
              const i = todo.pop()!;
              if (seen.has(i)) continue;
              seen.add(i);
              const q = c.layout.coords[c.atomIds[i]],
                x = q.x - o.x,
                y = q.y - o.y;
              q.x = o.x + x * Math.cos(angle) - y * Math.sin(angle);
              q.y = o.y + x * Math.sin(angle) + y * Math.cos(angle);
              for (const b of graph.bonds)
                if (b.atoms.includes(i))
                  for (const j of b.atoms) if (!seen.has(j)) todo.push(j);
            }
          }
        }
      }
      if (spec.wedges) c.layout.wedgeBonds = spec.wedges;
      if (spec.chargeAngles) c.layout.chargeAngles = spec.chargeAngles;
      if (!spec.ref && !spec.molfile && spec.orient !== "keep") {
        let folded: ReturnType<typeof abbreviatedGroups>[number] | undefined;
        try {
          folded = abbreviatedGroups(rd, m, ["PPh3"])[0];
        } catch {
          /* No eligible terminal group. */
        }
        if (folded) {
          const p = c.layout.coords[c.atomIds[folded.atoms[0]]],
            q = Object.entries(c.layout.coords)
              .filter(([id]) => !folded!.atoms.includes(c.atomIds.indexOf(id)))
              .map(([, v]) => v)
              .sort(
                (a, b) =>
                  Math.hypot(b.x - p.x, b.y - p.y) -
                  Math.hypot(a.x - p.x, a.y - p.y),
              )[0],
            target = graph.atoms[folded.attachment].z === 17 ? 0 : Math.PI,
            angle = target - Math.atan2(q.y - p.y, q.x - p.x);
          const cx = p.x,
            cy = p.y;
          for (const v of Object.values(c.layout.coords)) {
            const x = v.x - cx,
              y = v.y - cy;
            v.x = cx + x * Math.cos(angle) - y * Math.sin(angle);
            v.y = cy + x * Math.sin(angle) + y * Math.cos(angle);
          }
        }
      }
      if (spec.rotate) {
        const a = (spec.rotate * Math.PI) / 180;
        for (const p of Object.values(c.layout.coords)) {
          const x = p.x;
          p.x = x * Math.cos(a) - p.y * Math.sin(a);
          p.y = x * Math.sin(a) + p.y * Math.cos(a);
        }
      }
      if (spec.methyl)
        c.layout.methylLabels = graph.atoms.flatMap((a, i) =>
          (a.z ?? 6) === 6 && a.impHs === 3 ? [c.atomIds[i]] : [],
        );
      if (!spec.ref) {
        const abbreviations: NonNullable<Compound["layout"]["abbreviations"]> =
          [];
        for (const label of ["CCl3", "PPh3", "OTMS"] as const) {
          try {
            if (abbreviatedGroups(rd, m, [label]).length)
              abbreviations.push(label);
          } catch {}
        }
        if (abbreviations.length) c.layout.abbreviations = abbreviations;
        const p = graph.atoms.findIndex((a) => a.z === 15);
        if (
          p >= 0 &&
          graph.atoms.length === 19 &&
          matches("P(c1ccccc1)(c1ccccc1)c1ccccc1").length > 0 &&
          graph.bonds.filter((b) => b.atoms.includes(p)).length === 3
        )
          c.layout.compact = {
            atom: c.atomIds[p],
            text: "Ph<sub>3</sub>P",
            anchor: "last",
          };
      }
    }
    function selection(name: string, selector: string) {
      const c = compounds.get(name),
        m = handles.get(name);
      if (!c || !m) throw new Error(`Unknown molecule ${name}`);
      if (/^a\d+$/.test(selector)) {
        const i = atomIndex(c, selector);
        if (i < 0) throw new Error(`Unknown atom ${name}:${selector}`);
        return { atoms: [i], bonds: [] };
      }
      if (/^a\d+,a\d+$/.test(selector))
        return {
          atoms: selector.split(",").map((id) => atomIndex(c, id)),
          bonds: [],
        };
      const alias = c.template?.find((t) => t.label === selector);
      if (alias) return { atoms: [atomIndex(c, alias.atom)], bonds: [] };
      const namedBond = /^(C|N|O|P)-(R|X|Nu)$/.exec(selector);
      if (namedBond) {
        const site = c.template?.find((t) => t.label === namedBond[2]);
        if (!site)
          throw new Error(`${name}: unknown template site ${namedBond[2]}`);
        const i = atomIndex(c, site.atom),
          g = graphOf(m);
        const bi = g.bonds.findIndex((b) => b.atoms.includes(i));
        if (bi < 0) throw new Error(`${name}: unbound template site`);
        return {
          atoms: [g.bonds[bi].atoms.find((v) => v !== i)!, i],
          bonds: [bi],
        };
      }
      const ordinal = /#(\d+)$/.exec(selector);
      const pattern = selector.replace(/#\d+$/, "");
      const q = rd.get_qmol(pattern);
      if (!q) throw new Error(`Invalid SMARTS selector ${pattern}`);
      try {
        const matches = JSON.parse(m.get_substruct_matches(q)) as {
          atoms: number[];
          bonds: number[];
        }[];
        const chosen = matches[(ordinal ? Number(ordinal[1]) : 1) - 1];
        if (!chosen)
          throw new Error(`${name}: selector ${selector} has no match`);
        return chosen;
      } finally {
        q.delete();
      }
    }
    function endpoint(value: string, arrowId: string, end: string): Anchor {
      const between = /^(?:([\w-]+):)?between\(([^,]+),([^,]+)\)$/.exec(value);
      if (between) {
        const atomRef = (v: string): AtomRef => {
          const parts = v.trim().split(":");
          const name = parts.length === 2 ? parts[0] : between[1];
          if (!name)
            throw new Error("between endpoints need molecule:atom IDs");
          const c = compounds.get(name);
          const atom = parts.at(-1)!;
          if (!c?.atomIds.includes(atom))
            throw new Error(`Unknown atom ${name}:${atom}`);
          return { molecule: name, atom };
        };
        return {
          kind: "formingBond",
          atoms: [atomRef(between[2]), atomRef(between[3])],
        };
      }
      const split = value.indexOf(":");
      if (split < 0)
        throw new Error(`Endpoint needs molecule:selector: ${value}`);
      const name = value.slice(0, split),
        raw = value.slice(split + 1),
        c = compounds.get(name);
      if (!c) throw new Error(`Unknown molecule ${name}`);
      const ref = (i: number) => ({ molecule: name, atom: c.atomIds[i] });
      if (raw === "charge") {
        const i = graphOf(handles.get(name)!).atoms.findIndex((a) => a.chg);
        if (i < 0) throw new Error(`${name}: no formal charge`);
        return { kind: "charge", at: ref(i) };
      }
      const found = /^(atom|charge|bond|pi|lp|radical)\((.*)\)(#\d+)?$/.exec(
        raw,
      );
      if (!found) throw new Error(`Invalid endpoint ${value}`);
      const matched = selection(name, found[2] + (found[3] ?? ""));
      if (found[1] === "atom" || found[1] === "charge")
        return { kind: found[1], at: ref(matched.atoms[0]) };
      if (found[1] === "radical") {
        const at = ref(matched.atoms[0]);
        scene.labels!.push({
          id: arrowId + "-" + end + "-radical",
          at,
          kind: "radical",
          offset: { x: 0, y: 0 },
        });
        return { kind: "radical", at };
      }
      if (found[1] === "lp") {
        const id = arrowId + "-" + end + "-lp";
        scene.labels!.push({
          id,
          at: ref(matched.atoms[0]),
          kind: "lonePair",
          offset: { x: 0, y: 0 },
          angle: 90,
        });
        return { kind: "lonePair", label: id };
      }
      if (matched.atoms.length < 2)
        throw new Error(`${value}: bond selector needs two atoms`);
      return {
        kind: found[1] === "pi" ? "pi" : "bond",
        atoms: [ref(matched.atoms[0]), ref(matched.atoms[1])],
      };
    }
    for (const [i, raw] of (input.arrows ?? []).entries()) {
      const spec =
        typeof raw === "string"
          ? { from: raw.split("->")[0]?.trim(), to: raw.split("->")[1]?.trim() }
          : raw;
      if (!spec.from || !spec.to)
        throw new Error("Electron arrow requires from -> to");
      const id = "electron-" + (i + 1);
      const from = endpoint(spec.from, id, "from"),
        to = endpoint(spec.to, id, "to");
      if (from.kind === "atom" || from.kind === "formingBond")
        throw new Error(
          `Arrow ${id}: source must be lp, charge, bond, pi or radical`,
        );
      if (from.kind === "charge") {
        const c = compounds.get(from.at.molecule)!;
        if (
          (graphOf(handles.get(from.at.molecule)!).atoms[
            c.atomIds.indexOf(from.at.atom)
          ].chg ?? 0) >= 0
        )
          throw new Error(
            `Arrow ${id}: charge source requires negative charge; use lp for a neutral donor`,
          );
      }
      if (to.kind === "charge" || to.kind === "lonePair" || to.kind === "pi")
        throw new Error(
          `Arrow ${id}: destination must be atom, bond, between or radical`,
        );
      scene.arrows!.push({
        id,
        from,
        to,
        electrons:
          from.kind === "radical" || to.kind === "radical"
            ? 1
            : "electrons" in spec
              ? (spec.electrons ?? 2)
              : 2,
        tone: "tone" in spec ? spec.tone : undefined,
        bend: "bend" in spec ? spec.bend : undefined,
      });
    }
    // Keep a group expanded when an arrow addresses one of its internal atoms.
    const used = new Map<string, Set<string>>();
    for (const a of scene.arrows!)
      for (const e of [a.from, a.to]) {
        const refs =
          e.kind === "atom" || e.kind === "charge" || e.kind === "radical"
            ? [e.at]
            : e.kind === "bond" || e.kind === "pi" || e.kind === "formingBond"
              ? e.atoms
              : [];
        for (const r of refs) {
          if (!used.has(r.molecule)) used.set(r.molecule, new Set());
          used.get(r.molecule)!.add(r.atom);
        }
      }
    const atomRefs = (a: Anchor): AtomRef[] =>
      a.kind === "lonePair"
        ? [scene.labels!.find((l) => l.id === a.label)!.at]
        : "at" in a
          ? [a.at]
          : a.atoms;
    const interaction = (name: string, relation: string) => {
      for (const a of scene.arrows!) {
        const refs = [...atomRefs(a.from), ...atomRefs(a.to)];
        const own = refs.find((r) => r.molecule === name),
          other = refs.find((r) => r.molecule === relation);
        if (own && other) return { own, other };
      }
    };
    // Orient the reacting site of a dependent molecule toward its partner.
    // Saved projections retain their authored orientation.
    for (const [name, spec] of Object.entries(input.molecules)) {
      const relation = spec.above ?? spec.below ?? spec.leftOf ?? spec.rightOf;
      if (
        !relation ||
        spec.ref ||
        spec.molfile ||
        spec.rotate ||
        spec.orient === "keep"
      )
        continue;
      const pair = interaction(name, relation),
        c = compounds.get(name)!;
      if (!pair || c.layout.compact) continue;
      const groups = abbreviatedGroups(
        rd,
        handles.get(name)!,
        c.layout.abbreviations,
      );
      const hidden = new Set(
        groups.flatMap((g) => g.atoms.slice(1)).map((i) => c.atomIds[i]),
      );
      const visible = Object.entries(c.layout.coords)
        .filter(([id]) => !hidden.has(id) && id !== pair.own.atom)
        .map(([, p]) => p);
      if (!visible.length) continue;
      const site = c.layout.coords[pair.own.atom];
      const graph = graphOf(handles.get(name)!);
      const atomId = c.atomIds.indexOf(pair.own.atom);
      const neighbor = graph.bonds.filter((b) => b.atoms.includes(atomId));
      const center =
        neighbor.length === 1
          ? c.layout.coords[
              c.atomIds[neighbor[0].atoms.find((i) => i !== atomId)!]
            ]
          : {
              x: visible.reduce((sum, p) => sum + p.x, 0) / visible.length,
              y: visible.reduce((sum, p) => sum + p.y, 0) / visible.length,
            };
      const target = spec.below
        ? -Math.PI / 2
        : spec.above
          ? Math.PI / 2
          : spec.leftOf
            ? 0
            : Math.PI;
      const angle = target - Math.atan2(site.y - center.y, site.x - center.x);
      for (const p of Object.values(c.layout.coords)) {
        const x = p.x;
        p.x = x * Math.cos(angle) - p.y * Math.sin(angle);
        p.y = x * Math.sin(angle) + p.y * Math.cos(angle);
      }
      if (spec.above || spec.below) {
        const centerX = visible.reduce((sum, p) => sum + p.x - site.x, 0);
        if (centerX > 0)
          for (const p of Object.values(c.layout.coords)) p.x = -p.x;
      }
    }
    const boxes = new Map<string, Box>();
    for (const [name, c] of compounds) {
      const groups = abbreviatedGroups(
        rd,
        handles.get(name)!,
        c.layout.abbreviations,
      ).filter(
        (g) => !g.atoms.slice(1).some((i) => used.get(name)?.has(c.atomIds[i])),
      );
      if (
        c.layout.abbreviations &&
        groups.length !==
          abbreviatedGroups(rd, handles.get(name)!, c.layout.abbreviations)
            .length
      )
        c.layout.abbreviationAtoms = groups.map((g) => c.atomIds[g.atoms[0]]);
      const hidden = new Set(
        groups.flatMap((g) => g.atoms.slice(1)).map((i) => c.atomIds[i]),
      );
      const ps = Object.entries(c.layout.coords)
        .filter(([id]) => !hidden.has(id))
        .map(([, p]) => p);
      let box = {
        left: Math.min(...ps.map((p) => p.x)) - 0.65,
        right: Math.max(...ps.map((p) => p.x)) + 0.65,
        top: Math.min(...ps.map((p) => p.y)) - 0.65,
        bottom: Math.max(...ps.map((p) => p.y)) + 0.65,
      };
      if (c.layout.compact) {
        const p = c.layout.coords[c.layout.compact.atom];
        box = {
          left: p.x - 1.7,
          right: p.x + 0.3,
          top: p.y - 0.35,
          bottom: p.y + 0.35,
        };
      }
      for (const g of groups) {
        const p = c.layout.coords[c.atomIds[g.atoms[0]]],
          outside = c.layout.coords[c.atomIds[g.attachment]];
        const labelWidth = g.name === "PPh3" ? 1.5 : 1.35;
        if (outside.x > p.x) box.left = Math.min(box.left, p.x - labelWidth);
        else box.right = Math.max(box.right, p.x + labelWidth);
      }
      boxes.set(name, box);
    }
    const positions = new Map<string, Point>(),
      pending = new Set(names);
    const byproducts = new Set(
      (input.reactions ?? []).flatMap((r) =>
        [r.byproduct, r.aboveMolecule, r.belowMolecule].filter(
          (v): v is string => !!v,
        ),
      ),
    );
    for (let pass = 0; pending.size && pass < names.length + 2; pass++)
      for (const name of [...pending]) {
        if (byproducts.has(name)) continue;
        const spec = input.molecules[name],
          box = boxes.get(name)!;
        let relation = spec.rightOf ?? spec.leftOf ?? spec.above ?? spec.below;
        if (!relation && positions.size)
          relation = [...positions.keys()].at(-1);
        if (relation && !positions.has(relation)) continue;
        let p = { x: 0, y: 0 };
        if (relation) {
          const other = positions.get(relation)!,
            b = boxes.get(relation)!;
          const pair = interaction(name, relation);
          const partners = names.filter(
            (n) => n !== relation && interaction(n, relation!),
          ).length;
          const gap =
            spec.gap ??
            (spec.above || spec.below
              ? pair
                ? partners > 1
                  ? 0.85
                  : 0.3
                : 1
              : pair
                ? 1.2
                : 3.5);
          p = { ...other };
          if (!spec.above && !spec.below)
            p.y += (b.top + b.bottom - box.top - box.bottom) / 2;
          if (spec.below) p.y += b.bottom - box.top + gap;
          else if (spec.above) p.y += b.top - box.bottom - gap;
          else if (spec.leftOf) p.x += b.left - box.right - gap;
          else p.x += b.right - box.left + gap;
          if ((spec.above || spec.below) && pair) {
            p.x =
              other.x +
              compounds.get(relation)!.layout.coords[pair.other.atom].x -
              compounds.get(name)!.layout.coords[pair.own.atom].x +
              (spec.below ? 0.65 : -0.65);
          }
        }
        p.x += spec.offset?.[0] ?? 0;
        p.y += spec.offset?.[1] ?? 0;
        positions.set(name, p);
        pending.delete(name);
      }
    const globalBox = (name: string) => {
      const b = boxes.get(name)!,
        p = positions.get(name)!;
      return {
        left: b.left + p.x,
        right: b.right + p.x,
        top: b.top + p.y,
        bottom: b.bottom + p.y,
      };
    };
    for (const [i, r] of (input.reactions ?? []).entries()) {
      if (!positions.has(r.from) || !positions.has(r.to))
        throw new Error(`Reaction ${i + 1}: place both endpoints`);
      const a = globalBox(r.from),
        b = globalBox(r.to),
        right = b.left > a.left,
        margin = 0.35;
      const y =
        r.lane === "bottom"
          ? Math.max(a.bottom, b.bottom) + 0.15
          : (a.top + a.bottom + b.top + b.bottom) / 4;
      const from = { x: right ? a.right + margin : a.left - margin, y },
        to = { x: right ? b.left - margin : b.right + margin, y };
      const id = r.id ?? "reaction-" + (i + 1);
      scene.reactionArrows!.push({
        id,
        from,
        to,
        kind: r.kind,
        above: r.above,
        below: r.below,
        tone: r.tone,
      });
      for (const [name, sign] of [
        [r.aboveMolecule, -1],
        [r.belowMolecule, 1],
      ] as const) {
        if (!name) continue;
        const box = boxes.get(name)!;
        const center = (from.x + to.x) / 2;
        positions.set(name, {
          x: center - (box.left + box.right) / 2,
          y:
            sign < 0
              ? y - 0.45 - (box.bottom - 0.65)
              : y + 0.45 - (box.top + 0.65),
        });
        pending.delete(name);
      }
      if (r.byproduct) {
        const box = boxes.get(r.byproduct)!;
        const nominalCenter = (from.x + to.x) / 2;
        let center = nominalCenter,
          branchY = y - 1.2 - box.bottom,
          best = Infinity;
        for (const dy of [0, -0.5, -1, -1.5, -2, -2.5, -3])
          for (const dx of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]) {
            const cx = nominalCenter + dx,
              cy = y - 1.2 - box.bottom + dy;
            const left = cx + (box.left - box.right) / 2,
              rightEdge = cx + (box.right - box.left) / 2;
            let score = Math.abs(dx) + Math.abs(dy) * 1.2;
            if (
              cx < Math.min(from.x, to.x) + 0.3 ||
              cx > Math.max(from.x, to.x) - 0.3
            )
              score += 100;
            for (const name of positions.keys()) {
              if (name === r.byproduct) continue;
              const occupied = globalBox(name);
              if (
                cy + box.bottom > occupied.top - 0.15 &&
                cy + box.top < occupied.bottom + 0.15 &&
                rightEdge > occupied.left - 0.15 &&
                left < occupied.right + 0.15
              )
                score += 10000;
            }
            if (score < best) {
              best = score;
              center = cx;
              branchY = cy;
            }
          }
        positions.set(r.byproduct, {
          x: center - (box.left + box.right) / 2,
          y: branchY,
        });
        pending.delete(r.byproduct);
        const start = { x: from.x + (to.x - from.x) * 0.3, y },
          end = { x: center, y: branchY + box.bottom + 0.3 };
        scene.reactionArrows!.push({
          id: id + "-branch",
          from: start,
          to: end,
          controls: [
            { x: center, y },
            { x: center, y: (y + end.y) / 2 },
          ],
        });
      }
    }
    if (pending.size)
      throw new Error(
        `Unresolved/cyclic placement: ${[...pending].join(", ")}`,
      );
    for (const [name, p] of positions) {
      scene.molecules.push({
        id: name,
        compound: compounds.get(name)!.id,
        at: p,
      });
      const spec = input.molecules[name],
        box = globalBox(name);
      const centerX = (box.left + box.right) / 2;
      let y = box.bottom + 0.6;
      if (spec.number) {
        scene.captions!.push({ at: { x: centerX, y }, text: spec.number });
        y += 0.7;
      }
      if (spec.yield !== undefined)
        scene.captions!.push({ at: { x: centerX, y }, text: `${spec.yield}%` });
      if (spec.plus && spec.rightOf) {
        const left = globalBox(spec.rightOf);
        scene.captions!.push({
          at: {
            x: (left.right + box.left) / 2,
            y: (left.top + left.bottom + box.top + box.bottom) / 4,
          },
          text: "+",
        });
      }
      if (input.captions?.[name])
        scene.captions!.push({
          at: { x: centerX, y: box.bottom + 1 },
          text: input.captions[name],
          tone: input.reactions?.find((r) => r.to === name)?.tone,
        });
    }
    scene.focus = {
      primary: {
        arrows: scene.arrows!.filter((a) => !a.tone).map((a) => a.id),
      },
    };
    for (const [i, value] of (input.focus ?? []).entries()) {
      const e = endpoint(value, "focus-" + i, "from");
      if (e.kind === "bond") (scene.focus!.primary!.bonds ??= []).push(e.atoms);
      else if (e.kind === "atom")
        (scene.focus!.primary!.atoms ??= []).push(e.at);
    }
    const allBoxes = [...positions.keys()].map(globalBox);
    const minX = Math.min(...allBoxes.map((b) => b.left)) - 1.5,
      minY = Math.min(...allBoxes.map((b) => b.top)) - 1.5;
    for (const p of scene.molecules) {
      p.at.x -= minX;
      p.at.y -= minY;
    }
    for (const a of scene.reactionArrows!) {
      for (const p of [a.from, a.to, ...(a.controls ?? [])]) {
        p.x -= minX;
        p.y -= minY;
      }
    }
    for (const c of scene.captions!) {
      c.at.x -= minX;
      c.at.y -= minY;
    }
    scene.width = Math.max(...allBoxes.map((b) => b.right)) - minX + 1.5;
    scene.height = Math.max(...allBoxes.map((b) => b.bottom)) - minY + 2.5;
    if (identity) {
      for (const placement of scene.molecules) {
        const sourceId = input.molecules[placement.id].ref;
        if (!sourceId) continue;
        const source = existing[sourceId];
        if (source.kind !== "compound")
          throw new Error(`Missing compound ${sourceId}`);
        const generated = compounds.get(placement.id)!;
        if (
          JSON.stringify(generated.template) !== JSON.stringify(source.template)
        )
          throw new Error(
            `${sourceId}: template labels belong to the saved compound`,
          );
        const selected = input.molecules[placement.id].variant;
        const sourceLayout = selected
          ? source.variants![selected]
          : source.layout;
        if (JSON.stringify(generated.layout) !== JSON.stringify(sourceLayout)) {
          const variant = identity.id + "_" + placement.id;
          const stored = entries[sourceId];
          if (stored.kind !== "compound")
            throw new Error(`Missing compound ${sourceId}`);
          entries[sourceId] = {
            ...stored,
            variants: { ...stored.variants, [variant]: generated.layout },
          };
          placement.variant = variant;
        } else if (selected) placement.variant = selected;
        placement.compound = sourceId;
        delete entries[generated.id];
      }
    }
    const id = identity?.id ?? "mec_authored_scene";
    entries[id] = {
      kind: "mechanism",
      id,
      title: input.title,
      sources: identity?.sources ?? [
        { source: "authored-scene", locator: input.title },
      ],
      category: input.comparison ? "comparison" : "reaction",
      frames: [
        { id: "scene", title: input.title, explanation: input.title, scene },
      ],
    };
    return {
      entries,
      reference: { ref: id },
      stats: {
        molecules: names.length,
        arrows: scene.arrows!.length,
        adjustments: Object.entries(input.molecules)
          .flatMap(([name, m]) =>
            ["offset", "rotate"]
              .filter((k) => k in m)
              .map((k) => name + "." + k),
          )
          .concat(
            scene.arrows!.flatMap((a) => (a.bend ? [a.id + ".bend"] : [])),
          ),
      },
    };
  } finally {
    for (const h of handles.values()) h?.delete();
  }
}
