import { depictRoute, figureAbbreviations } from "./figure-depiction.ts";
import { compileRouteLayout, compileReactionLayout } from "./figure-route.ts";
import type { FigureStyle } from "../src/ui/library/scene-geometry.ts";
import { createHash } from "node:crypto";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  abbreviationSmarts,
  type MoleculeAbbreviation,
} from "../shared/molecule-abbreviations.ts";
import {
  atomMaps,
  graphOf,
  validateCompound,
  prepareCompound,
  openMolecule,
  graphSignature,
  molecularSmiles,
  placedCoordinates,
  type Toolkit,
  validateSceneChemistry,
} from "../shared/chemical-library/chemistry.ts";
import {
  validateLibraryEntry,
  validateLibrary,
} from "../shared/chemical-library/contract.ts";
import { finishFigureEntry } from "./figure-output.ts";
import { routeMetrics } from "../shared/chemical-library/routes.ts";
import {
  validateFigureInput,
  type StructureInput,
  type ProductInput,
  type StepInput,
} from "./figure-input.ts";
import type {
  Anchor,
  AtomRef,
  Compound,
  Evidence,
  Library,
  LibraryEntry,
  Mechanism,
  Participant,
  Placement,
  Point,
  Reaction,
  Route,
  Scene,
} from "../shared/chemical-library/types.ts";

export const figureKey = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 12);
const words = (v: string | number | undefined) =>
  v === undefined ? "" : String(v);
const lines = (v: string | number | undefined) =>
  words(v).split("\n").filter(Boolean);
// Expansion strings use the attachment atom first; every other atom is in a branch.
const expansions: Record<string, string> = {
  Boc: "C(=O)(OC(C)(C)C)",
  Cbz: "C(=O)(OCc1ccccc1)",
  Fmoc: "C(=O)(OCC1c2ccccc2-c2ccccc21)",
  Ts: "S(=O)(=O)(c1ccc(C)cc1)",
  Ms: "S(=O)(=O)(C)",
  Tf: "S(=O)(=O)(C(F)(F)F)",
  TMS: "[Si](C)(C)(C)",
  TBS: "[Si](C)(C)(C(C)(C)C)",
  TIPS: "[Si](C(C)C)(C(C)C)(C(C)C)",
  TBDPS: "[Si](c1ccccc1)(c1ccccc1)C(C)(C)C",
  TES: "[Si](CC)(CC)CC",
  MOM: "C(OC)",
  Bn: "C(c1ccccc1)",
  PMB: "C(c1ccc(OC)cc1)",
  Ac: "C(=O)(C)",
  Bz: "C(=O)(c1ccccc1)",
  Piv: "C(=O)(C(C)(C)C)",
  Ph: "c1ccccc1",
  OTMS: "O([Si](C)(C)C)",
  OMe: "O(C)",
  OEt: "O(CC)",
  CCl3: "C(Cl)(Cl)(Cl)",
  PPh3: "P(c1ccccc1)(c1ccccc1)(c1ccccc1)",
};
export function expandFigureSmiles(smiles: string) {
  let ring = Math.max(
    0,
    ...[...smiles.replace(/\[[^\]]*\]/g, "").matchAll(/%\d{2}|\d/g)].map((m) =>
      Number(m[0].replace("%", "")),
    ),
  );
  return smiles.replace(
    /\[([A-Za-z][A-Za-z0-9]*)\]/g,
    (token, name: string) => {
      const expansion = expansions[name];
      if (!expansion) return token;
      const rings = new Map<string, string>();
      return expansion.replace(/%\d{2}|\d/g, (n) => {
        if (!rings.has(n)) {
          ring++;
          rings.set(n, ring >= 10 ? `%${ring}` : String(ring));
        }
        return rings.get(n)!;
      });
    },
  );
}
interface Resolved {
  variant?: string;
  compound: Compound;
  atoms: Map<number, string>;
  spec: StructureInput;
}
function endpoints<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
const keyOf = (v: string | number | { id: string | number }) =>
  typeof v === "object" ? String(v.id) : String(v);
const layoutOf = (r: Resolved) =>
  r.variant ? r.compound.variants![r.variant] : r.compound.layout;
function bounds(rd: Toolkit, r: Resolved) {
  const ps = placedCoordinates(
    rd,
    r.compound,
    layoutOf(r),
    -(r.spec.rot ?? 0) + (r.spec.flip === "v" ? 180 : 0),
    !!r.spec.flip,
  );
  return {
    left: Math.min(...ps.map((p) => p.x)) - 0.8,
    right: Math.max(...ps.map((p) => p.x)) + 0.8,
    top: Math.min(...ps.map((p) => p.y)) - 0.8,
    bottom: Math.max(...ps.map((p) => p.y)) + 0.8,
  };
}
const blank = (): Scene => ({
  width: 1,
  height: 1,
  molecules: [],
  arrows: [],
  labels: [],
  reactionArrows: [],
  captions: [],
});
function fit(scene: Scene, extra: Point[] = []) {
  const ps = [
    ...extra,
    ...scene.captions!.map((c) => c.at),
    ...scene.reactionArrows!.flatMap((a) => [a.from, a.to]),
  ];
  const dx = 1.5 - Math.min(0, ...ps.map((p) => p.x)),
    dy = 1.5 - Math.min(0, ...ps.map((p) => p.y));
  scene.width = Math.max(0, ...ps.map((p) => p.x)) + dx + 1.5;
  scene.height = Math.max(0, ...ps.map((p) => p.y)) + dy + 1.5;
  for (const p of [
    ...scene.molecules.map((m) => m.at),
    ...scene.captions!.map((c) => c.at),
    ...scene.reactionArrows!.flatMap((a) => [a.from, a.to]),
  ]) {
    p.x += dx;
    p.y += dy;
  }
  return { dx, dy };
}

/** Compile validated figure intent into persistent library graphs and scenes. */
export async function compileFigure(
  inputValue: unknown,
  existing: Library = {},
  sourceKey = "example",
  options: { style?: FigureStyle } = {},
) {
  const { input, warnings } = validateFigureInput(inputValue);
  const rd = await moleculeToolkit(),
    entries: Library = structuredClone(existing),
    generated = new Set<string>();
  for (const entry of Object.values(entries)) finishFigureEntry(entry);
  const previous = Object.values(entries).find(
    (e) => e.sourceKey === sourceKey && !e.owner,
  );
  const kind = input.kind ?? "route",
    count = input.steps?.length ?? 0;
  const routeGraph =
    kind !== "mechanism" && (count > 1 || previous?.kind === "route");
  const prefix = kind === "mechanism" ? "mec_" : routeGraph ? "rte_" : "rxn_";
  const id = previous?.id ?? prefix + sourceKey;
  if (!id.startsWith(prefix))
    throw new Error("Changing figure kind requires a new source file");
  const sourceFile = `library/sources/${id}.yaml`,
    title = words(input.title) || "Figure";
  const sources: Evidence[] = input.sources?.map((s) => ({
    source: words(s.source),
    locator: words(s.locator) || title,
    ...(s.note === undefined ? {} : { note: words(s.note) }),
  })) ?? [{ source: "unknown", locator: title, note: "Authored figure" }];
  const base = {
    title,
    sources,
    sourceFile,
    sourceKey,
    ...(input.footnote === undefined
      ? {}
      : { footnote: words(input.footnote) }),
    ...(input.explain === undefined ? {} : { overview: words(input.explain) }),
  };
  const previousReactions =
    previous?.kind === "reaction"
      ? [previous]
      : previous?.kind === "route"
        ? previous.steps
            .map((step) => existing[step.reaction])
            .filter((entry): entry is Reaction => entry?.kind === "reaction")
        : [];
  const compoundBindings = new Map<string, string>(
    previousReactions.flatMap((reaction) =>
      [...reaction.reactants, ...reaction.products].flatMap((p) =>
        p.sourceKey ? [[`compounds.${p.sourceKey}`, p.compound] as const] : [],
      ),
    ),
  );
  // Remove only entries owned by this route when a step is removed.
  for (const e of Object.values(entries))
    if (e.owner === id) delete entries[e.id];
  async function resolveStructure(
    spec: StructureInput,
    where: string,
  ): Promise<Resolved> {
    if (!spec.smiles) throw new Error(`${where}: structure requires smiles`);
    const expanded = expandFigureSmiles(spec.smiles),
      m = openMolecule(rd, expanded);
    try {
      const signature = graphSignature(rd, m),
        maps = atomMaps(m);
      const labels = maps.filter((n) => n > 0);
      if (new Set(labels).size !== labels.length)
        throw new Error(`${where}: duplicate atom map`);
      const bound = entries[compoundBindings.get(where) ?? ""];
      let compound =
        bound?.kind === "compound" && bound.graph === signature
          ? bound
          : Object.values(entries).find(
              (e): e is Compound =>
                e.kind === "compound" && e.graph === signature,
            );
      const unmapped = molecularSmiles(
        m,
        JSON.stringify({ canonical: false }),
      ).replace(/:\d+(?=\])/g, "");
      if (!compound) {
        const cid = "cmp_" + figureKey(signature);
        if (spec.coordgen ?? input.coordgen) m.set_new_coords(true);
        compound = finishFigureEntry(
          prepareCompound(
            rd,
            { id: cid, title: "Compound", smiles: unmapped, sources },
            (spec.coordgen ?? input.coordgen) ? m.get_molblock() : undefined,
          ),
        );
        const abbrevs = [
          ...new Set(
            [...spec.smiles.matchAll(/\[([A-Za-z][A-Za-z0-9]*)\]/g)].map(
              (m) => m[1],
            ),
          ),
        ].filter((key): key is MoleculeAbbreviation =>
          Object.hasOwn(abbreviationSmarts, key),
        );
        compound.layout.abbreviations =
          spec.abbreviate === false ? [] : abbrevs;
        entries[cid] = compound;
        generated.add(cid);
      }
      let variant: string | undefined;
      const abbreviations = figureAbbreviations(rd, m, spec, input.abbreviate);
      if (
        JSON.stringify(abbreviations) !==
        JSON.stringify(compound.layout.abbreviations ?? [])
      ) {
        variant = `${id}_${figureKey(where)}`;
        compound.variants ??= {};
        compound.variants[variant] = {
          ...structuredClone(compound.layout),
          abbreviations,
        };
        generated.add(compound.id);
      }
      const target = openMolecule(rd, compound.smiles),
        query = openMolecule(rd, unmapped);
      try {
        const match: { atoms?: number[] } = JSON.parse(
          target.get_substruct_match(
            query,
            JSON.stringify({ useChirality: true }),
          ),
        );
        if (match.atoms?.length !== maps.length)
          throw new Error(`${where}: cannot map compound atoms`);
        if (spec.arrows?.some((a) => a.from.startsWith("pi("))) {
          const raw = openMolecule(rd, expanded, false);
          try {
            const orders = new Map(
              graphOf(raw).bonds.map((b) => [
                b.atoms
                  .map((i) => match.atoms![i])
                  .sort((a, b) => a - b)
                  .join(","),
                b.bo ?? 1,
              ]),
            );
            let inBonds = false;
            const molblock = target
              .get_v3Kmolblock()
              .split("\n")
              .map((line) => {
                if (line === "M  V30 BEGIN BOND") inBonds = true;
                else if (line === "M  V30 END BOND") inBonds = false;
                else if (inBonds) {
                  const fields = line.trim().split(/\s+/),
                    order = orders.get(
                      [Number(fields[4]) - 1, Number(fields[5]) - 1]
                        .sort((a, b) => a - b)
                        .join(","),
                    );
                  if (order !== undefined && Number.isInteger(order))
                    fields[3] = String(order);
                  return "M  V30 " + fields.slice(2).join(" ");
                }
                return line;
              })
              .join("\n");
            const layout = variant
              ? compound.variants![variant]
              : compound.layout;
            variant ??= `${id}_${figureKey(where)}`;
            compound.variants ??= {};
            compound.variants[variant] = {
              ...structuredClone(layout),
              molblock,
            };
            generated.add(compound.id);
          } finally {
            raw.delete();
          }
        }
        const atoms = new Map(
          maps.flatMap((n, i) =>
            n > 0
              ? [[n, compound.atomIds[match.atoms![i]]] as [number, string]]
              : [],
          ),
        );
        if (spec.numbers && atoms.size) {
          const layout = variant
            ? compound.variants![variant]
            : compound.layout;
          variant ??= `${id}_${figureKey(where)}`;
          compound.variants ??= {};
          compound.variants[variant] = {
            ...structuredClone(layout),
            atomNumbers: Object.fromEntries(
              [...atoms].map(([number, atom]) => [atom, number]),
            ),
          };
          generated.add(compound.id);
        }
        const substanceGroups: {
          properties: { TYPE: string; LABEL?: string };
          atoms: number[];
        }[] = JSON.parse(m.get_json()).molecules[0].substanceGroups ?? [];
        const repeatUnits = substanceGroups
          .filter((group) => group.properties.TYPE === "SRU")
          .map((group) => ({
            atoms: group.atoms.map((i) => compound.atomIds[match.atoms![i]]),
            label: group.properties.LABEL ?? "n",
          }));
        if (repeatUnits.length) {
          const layout = variant
            ? compound.variants![variant]
            : compound.layout;
          variant ??= `${id}_${figureKey(where)}`;
          compound.variants ??= {};
          compound.variants[variant] = {
            ...structuredClone(layout),
            repeatUnits,
          };
          generated.add(compound.id);
        }
        if (spec.scale !== undefined && spec.scale !== 1) {
          const layout = variant
            ? compound.variants![variant]
            : compound.layout;
          variant ??= `${id}_${figureKey(where)}`;
          compound.variants ??= {};
          compound.variants[variant] = {
            ...structuredClone(layout),
            coords: Object.fromEntries(
              Object.entries(layout.coords).map(([atom, p]) => [
                atom,
                { x: p.x * spec.scale!, y: p.y * spec.scale! },
              ]),
            ),
          };
          generated.add(compound.id);
        }
        for (const n of Object.keys(spec.notes ?? {}))
          if (!atoms.has(Number(n)))
            throw new Error(`${where}.notes: unknown atom ${n}`);
        for (const enclosure of spec.enclose ?? []) {
          if (!enclosure.atoms?.length && !enclosure.bonds?.length)
            throw new Error(`${where}.enclose: requires atoms or bonds`);
          for (const n of [
            ...(enclosure.atoms ?? []),
            ...(enclosure.bonds ?? []).flat(),
          ])
            if (!atoms.has(n))
              throw new Error(`${where}.enclose: unknown atom ${n}`);
        }
        return { compound, atoms, spec, ...(variant ? { variant } : {}) };
      } finally {
        target.delete();
        query.delete();
      }
    } finally {
      m.delete();
    }
  }
  function placement(resolved: Resolved, local: string, at: Point): Placement {
    return {
      id: local,
      compound: resolved.compound.id,
      at,
      ...(resolved.variant ? { variant: resolved.variant } : {}),
      ...(resolved.spec.bracket ? { bracket: resolved.spec.bracket } : {}),
      ...(resolved.spec.rot || resolved.spec.flip === "v"
        ? {
            rotate:
              -(resolved.spec.rot ?? 0) +
              (resolved.spec.flip === "v" ? 180 : 0),
          }
        : {}),
      ...(resolved.spec.flip ? { mirror: true } : {}),
    };
  }
  function pushArrows(
    scene: Scene,
    resolved: Resolved,
    local: string,
    namespaced = false,
  ) {
    const arrowId = (id: string) => (namespaced ? `${local}/${id}` : id);
    const atom = (n: number): AtomRef => {
      const id = resolved.atoms.get(n);
      if (!id) throw new Error(`Unknown atom map ${n}`);
      return { molecule: local, atom: id };
    };
    const anchor = (
      text: string,
      arrow: string,
      end: "from" | "to",
    ): Anchor => {
      const match =
        /^(lp|charge|radical|atom|bond|pi|between)\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)$/.exec(
          text,
        );
      if (!match) throw new Error(`Invalid endpoint ${text}`);
      const [_, type, a, b] = match;
      if (
        end === "from"
          ? !["lp", "charge", "radical", "bond", "pi"].includes(type)
          : !["atom", "bond", "between"].includes(type)
      )
        throw new Error(`Invalid ${end} endpoint ${text}`);
      if (["bond", "pi", "between"].includes(type)) {
        if (!b) throw new Error(`Expected atom pair ${text}`);
        return {
          kind: type === "between" ? "formingBond" : (type as "bond" | "pi"),
          atoms: [atom(Number(a)), atom(Number(b))],
        };
      }
      if (b) throw new Error(`Expected one atom ${text}`);
      const at = atom(Number(a));
      if (type === "lp") {
        const label = arrow + "-lp";
        scene.labels!.push({
          id: label,
          at,
          offset: { x: 0, y: 0 },
          kind: "lonePair",
          angle: 90,
        });
        return { kind: "lonePair", label };
      }
      if (type === "radical")
        scene.labels!.push({
          id: arrow + "-radical",
          at,
          offset: { x: 0, y: 0 },
          kind: "radical",
        });
      return { kind: type as "atom" | "charge" | "radical", at };
    };
    for (const [i, a] of (resolved.spec.arrows ?? []).entries()) {
      const aid = arrowId(words(a.id) || `electron-${i + 1}`);
      if (scene.arrows!.some((x) => x.id === aid))
        throw new Error(`Duplicate arrow id ${aid}`);
      const from = anchor(a.from, aid, "from"),
        to = anchor(a.to, aid, "to");
      scene.arrows!.push({
        id: aid,
        from,
        to,
        electrons: a.electrons ?? (from.kind === "radical" ? 1 : 2),
        ...(a.side === undefined
          ? {}
          : { bend: a.side === "left" || a.side === 1 ? "left" : "right" }),
      });
    }
    const focus = resolved.spec.focus;
    if (focus) {
      for (const aid of [...(focus.primary ?? []), ...(focus.supporting ?? [])])
        if (!scene.arrows!.some((a) => a.id === arrowId(String(aid))))
          throw new Error(`Unknown focus arrow ${aid}`);
      if ((focus.supporting?.length ?? 0) > 2)
        throw new Error("At most two supporting focuses");
      scene.focus = {
        ...(focus.primary
          ? {
              primary: { arrows: focus.primary.map((a) => arrowId(String(a))) },
            }
          : {}),
        ...(focus.supporting
          ? {
              supporting: focus.supporting.map((a) => ({
                arrows: [arrowId(String(a))],
              })),
            }
          : {}),
      };
    }
  }
  let top: LibraryEntry;
  if (kind === "mechanism") {
    const frames: Mechanism["frames"] = [],
      maps: NonNullable<Mechanism["maps"]> = [];
    let prior: Resolved | undefined,
      priorId = "";
    for (const frame of input.frames!) {
      const fid = String(frame.id);
      if (frames.some((f) => f.id === fid))
        throw new Error(`Duplicate frame ${fid}`);
      const resolved = await resolveStructure(frame, `frames.${fid}`),
        scene = blank(),
        box = bounds(rd, resolved);
      scene.molecules.push(placement(resolved, "structure", { x: 0, y: 0 }));
      pushArrows(scene, resolved, "structure");
      const arrow = frame.arrow ?? "forward";
      if (arrow !== "none" && input.frames!.at(-1) !== frame)
        scene.reactionArrows!.push({
          id: `next-${fid}`,
          from: { x: box.right + 1, y: 0 },
          to: { x: box.right + 5, y: 0 },
          kind: arrow,
          above: lines(frame.above),
          below: lines(frame.below),
        });
      scene.comparison = arrow === "none";
      fit(scene, [
        { x: box.left, y: box.top },
        { x: box.right, y: box.bottom },
      ]);
      if (frame.map && !prior) throw new Error("First frame cannot have map");
      if (prior) {
        const explicit = frame.map ?? {},
          targets = new Set(Object.values(explicit));
        for (const n of Object.keys(explicit))
          if (!prior.atoms.has(Number(n)) || !resolved.atoms.has(explicit[n]))
            throw new Error(`frames.${fid}.map: unknown atom`);
        const pairs = [...prior.atoms].flatMap(([n, a]) => {
          const target = Object.hasOwn(explicit, String(n))
            ? explicit[n]
            : targets.has(n)
              ? undefined
              : n;
          const b =
            target === undefined ? undefined : resolved.atoms.get(target);
          return b
            ? [
                {
                  from: { molecule: "structure", atom: a },
                  to: { molecule: "structure", atom: b },
                  fromFrame: priorId,
                  toFrame: fid,
                },
              ]
            : [];
        });
        if (new Set(pairs.map((p) => p.to.atom)).size !== pairs.length)
          throw new Error(`frames.${fid}.map: duplicate target`);
        maps.push(...pairs);
      }
      frames.push({
        id: fid,
        title: words(frame.title) || fid,
        explanation: words(frame.explain) || words(input.explain) || title,
        scene,
        arrow,
        above: lines(frame.above),
        below: lines(frame.below),
      });
      prior = resolved;
      priorId = fid;
    }
    top = {
      ...base,
      kind: "mechanism",
      id,
      category: input.frames!.every((f) => f.arrow === "none")
        ? "comparison"
        : "reaction",
      frames,
      maps,
    };
  } else {
    const compounds = new Map<string, Resolved | StructureInput>();
    for (const [key, raw] of Object.entries(input.compounds!)) {
      const spec = typeof raw === "string" ? { smiles: raw } : raw;
      compounds.set(
        key,
        spec.smiles ? await resolveStructure(spec, `compounds.${key}`) : spec,
      );
    }
    for (const cid of depictRoute(
      rd,
      compounds,
      input,
      (key) => `${id}_${figureKey(key)}`,
    ))
      generated.add(cid);
    const resolve = (key: string) => {
      const r = compounds.get(key);
      if (!r) throw new Error(`Unknown compound ${key}`);
      return r;
    };
    const producer = new Map<string, string>(),
      rawSteps = new Map<string, StepInput>();
    for (const [i, step] of input.steps!.entries()) {
      const sid = words(step.id) || String(i + 1);
      if (rawSteps.has(sid)) throw new Error(`Duplicate step ${sid}`);
      rawSteps.set(sid, step);
      for (const p of endpoints(step.to)) {
        const key = keyOf(p);
        resolve(key);
        if (producer.has(key)) throw new Error(`Two steps produce ${key}`);
        producer.set(key, sid);
      }
      for (const r of endpoints(step.from)) resolve(keyOf(r));
    }
    const ordered: string[] = [],
      active = new Set<string>();
    function visit(sid: string) {
      if (ordered.includes(sid)) return;
      if (active.has(sid)) throw new Error("Route cycle");
      active.add(sid);
      for (const r of endpoints(rawSteps.get(sid)!.from)) {
        const p = producer.get(keyOf(r));
        if (p) visit(p);
      }
      active.delete(sid);
      ordered.push(sid);
    }
    for (const sid of rawSteps.keys()) visit(sid);
    const reactions: Reaction[] = [],
      steps: Route["steps"] = [],
      edges: Route["edges"] = [];
    for (const sid of ordered) {
      const oldStep =
        previous?.kind === "route"
          ? previous.steps.find((s) => s.id === sid)
          : undefined;
      const step = rawSteps.get(sid)!,
        rid = !routeGraph
          ? id
          : oldStep && existing[oldStep.reaction]?.owner === id
            ? oldStep.reaction
            : `rxn_${sourceKey}_${figureKey(sid)}`,
        scene = blank();
      const previousReaction = existing[oldStep?.reaction ?? rid];
      const participantId = (role: "reactants" | "products", key: string) =>
        previousReaction?.kind === "reaction"
          ? (previousReaction[role].find((p) => p.sourceKey === key)?.id ??
            (role === "products" ? `product-${key}` : key))
          : role === "products"
            ? `product-${key}`
            : key;
      const reactants: Participant[] = [],
        products: Participant[] = [],
        reagents: string[] = [],
        extra: Point[] = [];
      let cursor = 0,
        first = true;
      const display = (pid: string, resolved: Resolved) => {
        const box = bounds(rd, resolved),
          at = { x: cursor - box.left, y: 0 };
        scene.molecules.push(placement(resolved, pid, at));
        extra.push(
          { x: at.x + box.left, y: box.top },
          { x: at.x + box.right, y: box.bottom + 2 },
        );
        pushArrows(scene, resolved, pid, true);
        cursor = at.x + box.right + 2;
        return {
          left: at.x + box.left,
          right: at.x + box.right,
          top: box.top,
          bottom: box.bottom,
        };
      };
      const localNumber = (key: string, spec: StructureInput) =>
        spec.label === undefined ? key : words(spec.label);
      for (const raw of endpoints(step.from)) {
        const quantity =
          typeof raw === "object" && "equivalents" in raw
            ? { equivalents: raw.equivalents }
            : {};
        const key = keyOf(raw),
          r = resolve(key),
          spec = "compound" in r ? r.spec : r;
        const show = first
          ? "plus"
          : typeof raw === "object"
            ? (raw.show ?? step.others ?? ("compound" in r ? "plus" : "text"))
            : (step.others ?? ("compound" in r ? "plus" : "text"));
        first = false;
        if (show === "text" || show === "none") {
          if (show === "text")
            reagents.push(
              words(spec.text) ||
                [localNumber(key, spec), words(spec.name)]
                  .filter(Boolean)
                  .join(" · "),
            );
          if ("compound" in r)
            reactants.push({
              id: participantId("reactants", key),
              sourceKey: key,
              ...quantity,
              compound: r.compound.id,
              number: localNumber(key, spec),
              name: words(spec.name),
              position: show,
            });
          continue;
        }
        if (!("compound" in r))
          throw new Error(`${key}: structure required for ${show}`);
        const participant: Participant = {
          id: participantId("reactants", key),
          sourceKey: key,
          ...quantity,
          compound: r.compound.id,
          number: localNumber(key, spec),
          name: words(spec.name),
          ...(show === "box" ? { position: "above-arrow" } : {}),
        };
        reactants.push(participant);
        if (show !== "box") display(participant.id, r);
      }
      reagents.push(...lines(step.above));
      const from = { x: cursor - 0.7, y: 0 },
        to = { x: cursor + 4.3, y: 0 };
      cursor += 5.8;
      let previousProduct: ReturnType<typeof display> | undefined;
      for (const raw of endpoints(step.to)) {
        const key = keyOf(raw),
          r = resolve(key);
        if (!("compound" in r))
          throw new Error(`${key}: product requires smiles`);
        const p: ProductInput = typeof raw === "object" ? raw : { id: key };
        if (typeof step.changes === "object")
          for (const n of [
            ...(step.changes.add ?? []),
            ...(step.changes.remove ?? []),
          ])
            if (
              !endpoints(step.to).some((p) => {
                const t = resolve(keyOf(p));
                return "compound" in t && t.atoms.has(n);
              })
            )
              throw new Error(`changes: unknown product atom ${n}`);
        products.push({
          id: participantId("products", key),
          sourceKey: key,
          compound: r.compound.id,
          number: localNumber(key, r.spec),
          name: words(r.spec.name),
          ...(p.yield === undefined && r.spec.yield === undefined
            ? {}
            : { yield: p.yield ?? r.spec.yield }),
          ...(p.ratio === undefined ? {} : { ratio: p.ratio }),
          ...(p.fraction === undefined ? {} : { fraction: p.fraction }),
        });
        const productBox = display(participantId("products", key), r);
        if (previousProduct)
          scene.captions!.push({
            at: {
              x: (previousProduct.right + productBox.left) / 2,
              y:
                (previousProduct.top +
                  previousProduct.bottom +
                  productBox.top +
                  productBox.bottom) /
                4,
            },
            text: "+",
          });
        previousProduct = productBox;
      }
      for (const p of reactants.filter((p) => p.position === "above-arrow")) {
        const r = resolve(p.sourceKey!);
        if (!("compound" in r)) throw new Error("Missing boxed structure");
        const b = bounds(rd, r),
          at = { x: (from.x + to.x) / 2, y: -2 - b.bottom };
        // Boxed structures use the website's existing overhead placement.
        scene.molecules.push(placement(r, p.id, at));
        extra.push(
          { x: at.x + b.left, y: at.y + b.top },
          { x: at.x + b.right, y: at.y + b.bottom },
        );
      }
      extra.push(from, to);
      const { dx, dy } = fit(scene, extra);
      from.x += dx;
      from.y += dy;
      to.x += dx;
      to.y += dy;
      const reaction: Reaction = {
        ...base,
        ...(step.title === undefined ? {} : { title: words(step.title) }),
        ...(step.sources === undefined
          ? {}
          : {
              sources: step.sources.map((s) => ({
                source: words(s.source),
                locator: words(s.locator) || title,
                ...(s.note === undefined ? {} : { note: words(s.note) }),
              })),
            }),
        ...(routeGraph ? { footnote: undefined } : {}),
        kind: "reaction",
        id: rid,
        ...(routeGraph ? { owner: id } : {}),
        reactants,
        products,
        reagents,
        conditions: lines(step.below),
        ...(step.tags === undefined ? {} : { tags: step.tags }),
        ...(step.reagentPosition === undefined
          ? {}
          : { reagentPosition: step.reagentPosition }),
        explanation: words(step.explain) || words(input.explain) || title,
        scene,
        arrow: { from, to, textWidth: 5, kind: step.arrow ?? "forward" },
      };
      entries[rid] = reaction;
      await compileReactionLayout(
        entries,
        reaction,
        sid,
        input,
        step,
        options.style,
      );
      generated.add(rid);
      reactions.push(reaction);
      steps.push({ id: sid, reaction: rid, at: { x: 0, y: 0 } });
      for (const raw of endpoints(step.from)) {
        const key = keyOf(raw),
          p = producer.get(key);
        if (p && reactants.some((r) => r.sourceKey === key))
          edges.push({
            from: p,
            to: sid,
            product: (
              entries[steps.find((s) => s.id === p)!.reaction] as Reaction
            ).products.find((item) => item.sourceKey === key)!.id,
            reactant: reactants.find((item) => item.sourceKey === key)!.id,
          });
      }
    }
    if (!routeGraph) top = reactions[0];
    else {
      top = { ...base, kind: "route", id, steps, edges, width: 1, height: 1 };
      await compileRouteLayout(entries, top, input, rawSteps, options.style);
    }
  }
  entries[id] = top;
  generated.add(id);
  for (const gid of generated) finishFigureEntry(entries[gid]);
  validateLibrary(entries);
  for (const gid of generated) {
    const e = entries[gid];
    validateLibraryEntry(e);
    if (e.kind === "compound") validateCompound(rd, e);
    if (e.kind === "route") routeMetrics(e, entries);
    if (e.kind === "reaction")
      validateSceneChemistry(rd, entries, e.scene, e.id);
    if (e.kind === "mechanism")
      for (const f of e.frames)
        validateSceneChemistry(rd, entries, f.scene, `${id}/${f.id}`);
  }
  return {
    entries,
    generated: [...generated],
    reference: { ref: id },
    warnings,
    sourceFile,
  };
}
