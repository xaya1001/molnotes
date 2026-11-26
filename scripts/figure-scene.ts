import { computeDefaultCoords } from "../shared/chemical-toolkit.ts";
import { chemicalFigureStyle } from "../shared/chemical-library/style.ts";
import type { LibraryMarkush } from "../shared/chemical-library/types.ts";
import { scaffoldLayout } from "./figure-scaffolds.ts";
import { isObject } from "../shared/json.ts";
import { validateConformationSpec } from "../shared/chemical-templates/conformation.ts";
import { depictRoute, figureAbbreviations } from "./figure-depiction.ts";
import { reactionChanges } from "./figure-changes.ts";
import { placeArrowFragments } from "./figure-fragments.ts";
import { counterionGroups } from "../shared/chemical-library/ion-layout.ts";
import {
  compileGraphLayout,
  compileArrowLayout,
  loadFigureStyle,
} from "./figure-route.ts";
import {
  createFigureScene,
  type FigureStyle,
} from "../src/ui/library/scene-geometry.ts";
import { loadFigureFonts } from "./figure-fonts.ts";
import { conformationGeometry } from "../src/ui/library/conformation-geometry.ts";
import { createHash } from "node:crypto";
import { moleculeToolkit } from "../shared/molecule-toolkit.ts";
import {
  abbreviationFragments,
  type AbbreviationName,
} from "../shared/molecule-abbreviations.ts";
import {
  atomMaps,
  graphOf,
  validateCompound,
  prepareCompound,
  openMolecule,
  graphSignature,
  molecularSmiles,
  mappedBlock,
  compoundView,
  placedCoordinates,
  compoundAbbreviations,
  type Toolkit,
  validateSceneChemistry,
} from "../shared/chemical-library/chemistry.ts";
import {
  validateLibraryEntry,
  validateLibrary,
} from "../shared/chemical-library/contract.ts";
import { finishFigureEntry } from "./figure-output.ts";
import { figureRouteMetrics } from "../shared/chemical-library/routes.ts";
import { compilePanelScene, type PanelCell } from "./figure-panels.ts";
import { compileGroupLayout, compileStateLayout } from "./figure-mechanism.ts";
import {
  validateFigureInput,
  type StructureInput,
  type SchemeArrow,
  type SchemeCompound,
  type SchemeEndpoint,
  type SchemeGraph,
  type SchemeParticipant,
  type SchemeState,
} from "./figure-input.ts";
import { graphScenes } from "../shared/chemical-library/figure-layout.ts";
import type {
  Anchor,
  AtomRef,
  Compound,
  Conformation,
  Evidence,
  Library,
  Figure,
  FigureGraph,
  GraphArrow,
  Participant,
  Placement,
  Point,
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
interface ChemicalStructure {
  variant?: string;
  compound: Compound;
  atoms: Map<number, string>;
  spec: StructureInput;
  depiction: { smiles: string; atoms: number[] };
}
interface TemplateStructure {
  compound: Conformation;
  atoms: Map<number, string>;
  spec: StructureInput;
  variant?: undefined;
}
type Resolved = ChemicalStructure | TemplateStructure;
function isChemical(r: Resolved): r is ChemicalStructure {
  return r.compound.kind === "compound";
}
function depictStructures(
  rd: Parameters<typeof depictRoute>[0],
  structures: Map<string, Resolved | StructureInput>,
  input: Parameters<typeof depictRoute>[2],
  variantName: Parameters<typeof depictRoute>[3],
  style: FigureStyle,
  placeFragments?: (key: string) => void,
) {
  const chemical = new Map(
    [...structures].map(([key, r]) => [
      key,
      "compound" in r && !isChemical(r) ? r.spec : r,
    ]),
  );
  const anchor =
    input.anchor === undefined
      ? undefined
      : structures.get(String(input.anchor));
  return depictRoute(
    rd,
    chemical,
    {
      ...input,
      anchor:
        anchor && "compound" in anchor && !isChemical(anchor)
          ? undefined
          : input.anchor,
    },
    variantName,
    style,
    placeFragments,
  );
}
function endpoints<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
const layoutOf = (r: ChemicalStructure) =>
  r.variant ? r.compound.variants![r.variant] : r.compound.layout;
function chemicalBounds(rd: Toolkit, r: ChemicalStructure) {
  const hidden = new Set(
    compoundAbbreviations(rd, r.compound, layoutOf(r)).flatMap((g) =>
      g.atoms.slice(1),
    ),
  );
  const ps = placedCoordinates(
    rd,
    r.compound,
    layoutOf(r),
    -(r.spec.rot ?? 0) + (r.spec.flip === "v" ? 180 : 0),
    !!r.spec.flip,
  ).filter((_, i) => !hidden.has(i));
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
  if (isObject(inputValue) && inputValue.kind === "conformation") {
    validateConformationSpec(inputValue, "figure", [
      "kind",
      "title",
      "sources",
      "footnote",
      "bond",
      "width",
    ]);
    const title = String(inputValue.title ?? inputValue.template);
    const id = "cnf_" + sourceKey;
    const sourceFile = `library/sources/${id}.yaml`;
    const entry: Record<string, unknown> = {
      ...inputValue,
      kind: "conformation" as const,
      id,
      title,
      sourceKey,
      sourceFile,
      sources: inputValue.sources ?? [
        {
          source: "unknown",
          locator: title,
          note: "Authored conformation drawing",
        },
      ],
    };
    if (inputValue.bond !== undefined || inputValue.width !== undefined)
      entry.style = Object.fromEntries(
        Object.entries({
          bond: inputValue.bond,
          width: inputValue.width,
        }).filter(([, value]) => value !== undefined),
      );
    delete entry.bond;
    delete entry.width;
    validateLibraryEntry(entry);
    const entries = { ...structuredClone(existing), [id]: entry };
    return {
      entries,
      reference: { ref: id },
      generated: [id],
      sourceFile,
      warnings: [],
      review: [],
    };
  }
  const { input, warnings } = validateFigureInput(inputValue);
  const review: string[] = [];
  const rd = await moleculeToolkit(),
    entries: Library = structuredClone(existing),
    generated = new Set<string>();
  for (const entry of Object.values(entries)) finishFigureEntry(entry);
  const previous = Object.values(entries).find(
    (e) =>
      (("id" in input && e.id === input.id) || e.sourceKey === sourceKey) &&
      !e.owner,
  );
  const authored = input.kind === "scheme" ? input : undefined;
  const reactionCount = Object.values(authored?.arrows ?? {}).filter(
    (arrow) => arrow.role === "reaction",
  ).length;
  const prefix =
    input.kind === "markush"
      ? "mku_"
      : reactionCount > 1
        ? "rte_"
        : reactionCount
          ? "rxn_"
          : "mec_";
  const id = authored?.id ?? previous?.id ?? prefix + sourceKey;
  const sourceFile = `library/sources/${id}.yaml`,
    title = words(input.title) || "Figure";
  const sources: Evidence[] = input.sources?.map((s) => ({
    source: words(s.source),
    locator: words(s.locator) || title,
    ...(s.note === undefined ? {} : { note: words(s.note) }),
  })) ?? [{ source: "unknown", locator: title, note: "Authored figure" }];
  const overrides =
    input.bond !== undefined || input.width !== undefined
      ? { bond: input.bond, width: input.width }
      : undefined;
  const style = chemicalFigureStyle(
    options.style ?? (await loadFigureStyle()),
    overrides,
  );
  const base = {
    ...(overrides && { style: overrides }),
    title,
    sources,
    sourceFile,
    sourceKey,
    ...(input.footnote === undefined
      ? {}
      : { footnote: words(input.footnote) }),
  };
  if (input.kind === "markush") {
    const entry: LibraryMarkush = finishFigureEntry({
      ...base,
      kind: "markush",
      id,
      core: input.core!,
      scale: input.scale,
      groups: input.groups!,
      view: input.view,
      name: input.name,
      note: input.note,
      unmodeled: input.unmodeled,
      patents: input.patents,
      gaps: input.gaps,
      gaps_title: input.gaps_title,
      rot: input.rot,
      flip: input.flip,
    });
    entries[id] = entry;
    validateLibrary(entries);
    return {
      entries,
      generated: [id],
      reference: { ref: id },
      warnings,
      review,
      sourceFile,
    };
  }
  const templateFonts = await loadFigureFonts();
  if (!authored) throw new Error("Expected a scheme graph");
  const graphSource = authored;
  const existingGraph =
    previous?.kind === "figure" ? previous.graph : undefined;
  const bindings = new Map<string, { ref: string; variant?: string }>();
  const bindSaved = (graph: FigureGraph, prefix = "") => {
    for (const [id, state] of Object.entries(graph.states))
      for (const [placement, binding] of Object.entries(state.compounds ?? {}))
        bindings.set(prefix + id + "/" + placement, binding);
    for (const [id, group] of Object.entries(graph.groups ?? {}))
      for (const { id: placement, compound, variant } of group.scene
        ?.molecules ?? [])
        bindings.set(prefix + id + "/" + placement, { ref: compound, variant });
    for (const [id, arrow] of Object.entries(graph.arrows))
      if (arrow.via) bindSaved(arrow.via, prefix + id + "/via/");
  };
  if (existingGraph) bindSaved(existingGraph);
  const variantName = (where: string) =>
    bindings.get(where)?.variant ?? `${id}_${figureKey(where)}`;

  async function resolveStructure(
    spec: SchemeCompound,
    where: string,
    frameMaps: { electronic: number[]; protected: number[] } = {
      electronic: [],
      protected: [],
    },
    piSources: number[][] = [],
    electronicState = false,
  ): Promise<Resolved> {
    const binding = bindings.get(where);
    if (spec.ref) {
      const target = entries[spec.ref];
      if (target?.kind === "conformation")
        return { compound: target, spec, atoms: new Map() };
      if (target?.kind !== "compound")
        throw new Error(`${where}: unknown compound ${spec.ref}`);
      spec = { ...spec, smiles: target.smiles };
    }
    if (spec.template) {
      const cid = binding?.ref ?? `cnf_${sourceKey}_${figureKey(where)}`;
      const compound: Conformation = {
        template: spec.template,
        subs: spec.subs,
        atoms: spec.atoms,
        bonds: spec.bonds,
        mirror: spec.mirror,
        rot: spec.rot,
        scale: spec.scale,
        sub_len: spec.sub_len,
        slots: spec.slots,
        clash: spec.clash,
        front: spec.front,
        back: spec.back,
        dihedral: spec.dihedral,
        rows: spec.rows,
        top: spec.top,
        bottom: spec.bottom,
        bracket: spec.bracket,
        // Template flip exchanges ring conformations; mirror reflects the drawing.
        flip: typeof spec.flip === "boolean" ? spec.flip : undefined,
        id: cid,
        kind: "conformation",
        title: words(spec.label) || spec.template,
        sources,
        owner: id,
      };
      entries[cid] = compound;
      generated.add(cid);
      return { compound, spec, atoms: new Map() };
    }
    if (!spec.smiles) throw new Error(`${where}: structure requires smiles`);
    const expanded = expandFigureSmiles(spec.smiles),
      m = openMolecule(rd, expanded);
    try {
      const signature = graphSignature(rd, m),
        maps = atomMaps(m);
      const labels = maps.filter((n) => n > 0);
      if (new Set(labels).size !== labels.length)
        throw new Error(`${where}: duplicate atom map`);
      const bound = entries[spec.ref ?? binding?.ref ?? ""];
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
        if (spec.coordgen ?? graphSource.coordgen)
          computeDefaultCoords(m, true);
        compound = finishFigureEntry(
          prepareCompound(
            rd,
            { id: cid, title: "Compound", smiles: unmapped, sources },
            (spec.coordgen ?? graphSource.coordgen)
              ? m.get_molblock()
              : undefined,
          ),
        );
        compound.layout.abbreviations =
          spec.abbreviate === false
            ? []
            : [
                ...new Set(
                  [...spec.smiles.matchAll(/\[([A-Za-z][A-Za-z0-9]*)\]/g)].map(
                    (match) => match[1],
                  ),
                ),
              ].filter((name): name is AbbreviationName =>
                Object.hasOwn(abbreviationFragments, name),
              );
        entries[cid] = compound;
        generated.add(cid);
      }
      let variant: string | undefined;
      const abbreviations = figureAbbreviations(
        rd,
        m,
        {
          ...spec,
          enclose: spec.enclose ?? [],
        },
        graphSource.abbreviate,
        frameMaps,
        where,
        electronicState ||
          frameMaps.electronic.length > 0 ||
          !!spec.arrows?.length,
      );
      const baseTarget = openMolecule(rd, compound.smiles);
      try {
        if (m.get_num_atoms() > baseTarget.get_num_atoms()) {
          const baseCount = baseTarget.get_num_atoms();
          const persistentMaps = atomMaps(baseTarget);
          baseTarget.add_hs_in_place();
          const match: { atoms?: number[] } = JSON.parse(
            baseTarget.get_substruct_match(
              m,
              JSON.stringify({ useChirality: true }),
            ),
          );
          if (match.atoms?.length !== maps.length)
            throw new Error(`${where}: cannot map explicit hydrogens`);
          const graph = graphOf(baseTarget),
            maxMap = Math.max(...persistentMaps);
          const stableMap = (i: number) =>
            i < baseCount ? persistentMaps[i] : maxMap + i - baseCount + 1;
          const explicitHydrogens = Object.fromEntries(
            match.atoms
              .filter((i) => i >= baseCount)
              .sort((a, b) => a - b)
              .map((i) => {
                const bond = graph.bonds.find((b) => b.atoms.includes(i))!;
                const parent = bond.atoms.find((a) => a !== i)!;
                return [`a${stableMap(i)}`, `a${stableMap(parent)}`];
              }),
          );
          const mapped = openMolecule(
            rd,
            mappedBlock(m, match.atoms.map(stableMap)),
          );
          try {
            const inputSmiles = molecularSmiles(
              mapped,
              JSON.stringify({ canonical: false }),
            );
            const prepared = prepareCompound(rd, {
              id: compound.id,
              title: compound.title,
              sources: compound.sources,
              smiles: inputSmiles,
            });
            variant = `explicit_h_${figureKey(JSON.stringify(explicitHydrogens))}`;
            compound.variants ??= {};
            compound.variants[variant] ??= {
              ...structuredClone(compound.layout),
              ...prepared.layout,
              inputSmiles,
              explicitHydrogens,
            };
            generated.add(compound.id);
            compound = compoundView(rd, compound, compound.variants[variant]);
          } finally {
            mapped.delete();
          }
        }
      } finally {
        baseTarget.delete();
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
        const selectedAbbreviations = abbreviations.abbreviations.map(
          (selection) =>
            typeof selection === "string"
              ? selection
              : { ...selection, atom: match.atoms![selection.atom] },
        );
        const abbreviationAtoms = abbreviations.abbreviationAtoms?.map(
          (i) => compound.atomIds[match.atoms![i]],
        );
        if (
          compound.smiles.includes(".") ||
          spec.abbreviate !== undefined ||
          JSON.stringify(selectedAbbreviations) !==
            JSON.stringify(compound.layout.abbreviations ?? []) ||
          JSON.stringify(abbreviationAtoms) !==
            JSON.stringify(compound.layout.abbreviationAtoms)
        ) {
          variant = variantName(where);
          compound.variants ??= {};
          const layout = {
            ...structuredClone(compound.layout),
            abbreviations: selectedAbbreviations,
          };
          if (spec.abbreviate === undefined) delete layout.reagentAbbreviate;
          else layout.reagentAbbreviate = spec.abbreviate;
          delete layout.abbreviationAtoms;
          if (abbreviationAtoms) layout.abbreviationAtoms = abbreviationAtoms;
          compound.variants[variant] = layout;
          generated.add(compound.id);
        }
        const piPairs = [
          ...piSources,
          ...(spec.arrows ?? [])
            .filter((a) => a.from.startsWith("pi("))
            .map((a) => [...a.from.matchAll(/\d+/g)].map((n) => Number(n[0]))),
        ];
        if (piPairs.length) {
          const raw = openMolecule(rd, expanded, false);
          try {
            const orders = new Map(
              graphOf(target).bonds.map((b) => [
                [...b.atoms].sort((a, b) => a - b).join(","),
                b.bo ?? 1,
              ]),
            );
            for (const b of graphOf(raw).bonds) {
              if (!Number.isInteger(b.bo ?? 1)) continue;
              orders.set(
                b.atoms
                  .map((i) => match.atoms![i])
                  .sort((a, b) => a - b)
                  .join(","),
                b.bo ?? 1,
              );
            }
            const representation = JSON.parse(
              m.get_json(),
            ).molecules[0].extensions?.find(
              (e: { name: string }) => e.name === "rdkitRepresentation",
            );
            const aromatic = new Set<number>(
              representation?.aromaticAtoms ?? [],
            );
            const rings: number[][] = (representation?.atomRings ?? []).filter(
              (ring: number[]) =>
                ring.length === 6 && ring.every((i) => aromatic.has(i)),
            );
            for (const numbers of piPairs) {
              const pair = numbers.map((n) => maps.indexOf(n));
              const bondKey = pair
                .map((i) => match.atoms![i])
                .sort((a, b) => a - b)
                .join(",");
              if ((orders.get(bondKey) ?? 1) >= 2) continue;
              const ring = rings.find((r) => pair.every((i) => r.includes(i)));
              if (ring)
                for (let i = 0; i < ring.length; i++) {
                  const key = [ring[i], ring[(i + 1) % ring.length]]
                    .map((i) => match.atoms![i])
                    .sort((a, b) => a - b)
                    .join(",");
                  orders.set(key, orders.get(key) === 2 ? 1 : 2);
                }
            }
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
            variant ??= variantName(where);
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
          variant ??= variantName(where);
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
          variant ??= variantName(where);
          compound.variants ??= {};
          compound.variants[variant] = {
            ...structuredClone(layout),
            repeatUnits,
          };
          generated.add(compound.id);
        }
        if (spec.ring_h !== undefined || graphSource.ring_h !== undefined) {
          const layout = variant
            ? compound.variants![variant]
            : compound.layout;
          variant ??= variantName(where);
          compound.variants ??= {};
          compound.variants[variant] = {
            ...structuredClone(layout),
            ringHydrogens: spec.ring_h ?? graphSource.ring_h,
          };
          generated.add(compound.id);
        }
        if (spec.drawing) {
          const layout = variant
            ? compound.variants![variant]
            : compound.layout;
          variant ??= variantName(where);
          compound.variants ??= {};
          compound.variants[variant] = scaffoldLayout(
            rd,
            { ...compound, layout },
            spec.drawing,
            spec.ring_h ?? graphSource.ring_h ?? true,
          );
          generated.add(compound.id);
        }
        if (spec.scale !== undefined && spec.scale !== 1) {
          const layout = variant
            ? compound.variants![variant]
            : compound.layout;
          variant ??= variantName(where);
          compound.variants ??= {};
          compound.variants[variant] = {
            ...structuredClone(layout),
            coords: Object.fromEntries(
              Object.entries(layout.coords).map(([atom, p]) => [
                atom,
                { x: p.x * spec.scale!, y: p.y * spec.scale! },
              ]),
            ),
            ...(layout.hydrogens
              ? {
                  hydrogens: Object.fromEntries(
                    Object.entries(layout.hydrogens).map(([atom, p]) => [
                      atom,
                      { x: p.x * spec.scale!, y: p.y * spec.scale! },
                    ]),
                  ),
                }
              : {}),
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
        return {
          compound,
          atoms,
          spec,
          depiction: { smiles: unmapped, atoms: match.atoms },
          ...(variant ? { variant } : {}),
        };
      } finally {
        target.delete();
        query.delete();
      }
    } finally {
      m.delete();
    }
  }
  function bounds(rd: Toolkit, r: Resolved) {
    if (isChemical(r)) return chemicalBounds(rd, r);
    const ctx = createFigureScene(style, templateFonts);
    const box = ctx.box(conformationGeometry(r.compound, ctx));
    return {
      left: box.x / ctx.token("--chemical-bond"),
      right: (box.x + box.width) / ctx.token("--chemical-bond"),
      top: box.y / ctx.token("--chemical-bond"),
      bottom: (box.y + box.height) / ctx.token("--chemical-bond"),
    };
  }
  function placement(resolved: Resolved, local: string, at: Point): Placement {
    if (!isChemical(resolved))
      return { id: local, compound: resolved.compound.id, at };
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
  function positionArrowFragments(resolved: Resolved) {
    if (!isChemical(resolved) || !resolved.compound.smiles.includes("."))
      return;
    const c = resolved.compound,
      layout = layoutOf(resolved),
      m = openMolecule(rd, c.smiles);
    if (resolved.spec.arrows?.length) layout.methylLabels = [];
    try {
      const full = graphOf(m),
        groups = compoundAbbreviations(rd, c, layout),
        hidden = new Set(groups.flatMap((g) => g.atoms.slice(1))),
        visible = c.atomIds.map((_, i) => i).filter((i) => !hidden.has(i));
      const index = new Map(visible.map((i, n) => [i, n])),
        scale = resolved.spec.scale ?? 1;
      const graph = {
        atoms: visible.map((i) =>
          groups.some((g) => g.atoms[0] === i)
            ? { z: 0, impHs: 0 }
            : full.atoms[i],
        ),
        bonds: full.bonds
          .filter((b) => b.atoms.every((i) => index.has(i)))
          .map((b) => ({
            ...b,
            atoms: b.atoms.map((i) => index.get(i)!) as [number, number],
          })),
      };
      const before = visible.map((i) => ({
        x: layout.coords[c.atomIds[i]].x / scale,
        y: -layout.coords[c.atomIds[i]].y / scale,
      }));
      const ids = (text: string) =>
        [...text.matchAll(/\d+/g)].map((n) =>
          index.get(c.atomIds.indexOf(resolved.atoms.get(Number(n[0]))!))!,
        );
      const links = (resolved.spec.arrows ?? []).flatMap((a) => {
        const from = ids(a.from),
          to = ids(a.to);
        return a.to.startsWith("between(")
          ? [[to[0], to[1]] as [number, number]]
          : from.flatMap((i) => to.map((j) => [i, j] as [number, number]));
      });
      const { points: after, contactAtoms } = placeArrowFragments(
        graph,
        before,
        links,
      );
      const ionGroups = counterionGroups(full, new Set());
      const activeAtoms = new Set([...contactAtoms].map((i) => visible[i]));
      if (
        !ionGroups.length ||
        ionGroups.some(({ atoms }) => atoms.some((i) => activeAtoms.has(i)))
      )
        layout.ionPairs = "keep";
      const coords = structuredClone(layout.coords);
      visible.forEach(
        (i, n) =>
          (coords[c.atomIds[i]] = {
            x: after[n].x * scale,
            y: -after[n].y * scale,
          }),
      );
      for (const group of groups) {
        const root = group.atoms[0],
          outside = group.attachment,
          oldRoot = layout.coords[c.atomIds[root]],
          oldOutside = layout.coords[c.atomIds[outside]],
          newRoot = coords[c.atomIds[root]],
          newOutside = coords[c.atomIds[outside]];
        const angle =
          Math.atan2(newRoot.y - newOutside.y, newRoot.x - newOutside.x) -
          Math.atan2(oldRoot.y - oldOutside.y, oldRoot.x - oldOutside.x);
        for (const i of group.atoms.slice(1)) {
          const p = layout.coords[c.atomIds[i]],
            x = p.x - oldRoot.x,
            y = p.y - oldRoot.y;
          coords[c.atomIds[i]] = {
            x: newRoot.x + x * Math.cos(angle) - y * Math.sin(angle),
            y: newRoot.y + x * Math.sin(angle) + y * Math.cos(angle),
          };
        }
      }
      layout.coords = coords;
    } finally {
      m.delete();
    }
  }
  function pushArrows(
    scene: Scene,
    resolved: Resolved,
    local: string,
    namespaced = false,
    resolveAtom?: (key: string) => AtomRef,
  ) {
    const arrowId = (id: string) => (namespaced ? `${local}/${id}` : id);
    const atom = (key: string): AtomRef => {
      if (resolveAtom) return resolveAtom(key);
      const id = resolved.atoms.get(Number(key));
      if (!id) throw new Error(`Unknown atom map ${key}`);
      return { molecule: local, atom: id };
    };
    const anchor = (
      text: string,
      arrow: string,
      end: "from" | "to",
    ): Anchor => {
      const match =
        /^(lp|charge|radical|atom|bond|pi|between)\(\s*((?:[^\s,():]+:)?\d+)\s*(?:,\s*((?:[^\s,():]+:)?\d+)\s*)?\)$/.exec(
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
          atoms: [atom(a), atom(b)],
        };
      }
      if (b) throw new Error(`Expected one atom ${text}`);
      const at = atom(a);
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
      if (to.kind === "formingBond" && (a.forming ?? graphSource.forming)) {
        const bonds = (scene.partialBonds ??= []);
        if (
          !bonds.some((b) =>
            b.atoms.every((at) =>
              to.atoms.some(
                (other) =>
                  at.molecule === other.molecule && at.atom === other.atom,
              ),
            ),
          )
        )
          bonds.push({ atoms: to.atoms, order: 1 });
      }
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
  function pushEnclosures(
    scene: Scene,
    resolved: Resolved,
    local: string,
    enclosures = resolved.spec.enclose ?? [],
  ) {
    const atom = (n: number): AtomRef => {
      const id = resolved.atoms.get(n);
      if (!id) throw new Error(`enclose: unknown atom ${n}`);
      return { molecule: local, atom: id };
    };
    for (const [i, e] of enclosures.entries()) {
      if (!e.atoms?.length && !e.bonds?.length)
        throw new Error("enclose: requires atoms or bonds");
      (scene.enclose ??= []).push({
        id: `${local}/${e.id ?? i + 1}`,
        shape: e.shape,
        atoms: e.atoms?.map(atom),
        bonds: e.bonds?.map(([a, b]) => [atom(a), atom(b)]),
      });
    }
  }
  const figure: Figure = {
    ...base,
    kind: "figure",
    id,
    graph: { states: {}, arrows: {} },
    views: graphSource.views ?? {},
  };
  entries[id] = figure;
  generated.add(id);

  const authoredParticipant = (end: SchemeEndpoint): SchemeParticipant =>
    typeof end === "string" ? { state: end } : end;
  const asStructure = (raw: string | SchemeCompound): SchemeCompound =>
    typeof raw === "string" ? { smiles: raw } : raw;
  const atomsByState = new Map<string, Map<string, AtomRef>>();

  function selectSavedVariant(
    resolved: Resolved,
    variant: string,
    location: string,
  ) {
    const saved = existing[resolved.compound.id];
    const layout = saved?.kind === "compound" && saved.variants?.[variant];
    if (!isChemical(resolved) || !layout)
      throw new Error(`${location}: unknown variant ${variant}`);
    (resolved.compound.variants ??= {})[variant] = structuredClone(layout);
    resolved.variant = variant;
  }

  async function compileState(
    state: SchemeState,
    where: string,
    outer: Map<string, Resolved> | undefined,
    orientation?: Map<string, Resolved>,
    outgoing?: { id: string; arrow: GraphArrow },
    groupLayout?: (cells: PanelCell[]) => Promise<Scene>,
  ) {
    const resolved = new Map<string, Resolved>();
    const cells: PanelCell[] = [];
    const compounds = Object.entries(state.compounds ?? {});
    const eventRefs = (text: string) =>
      [...text.matchAll(/(?:([^\s,():]+):)?(\d+)/g)].map((m) => ({
        local: m[1] ?? "structure",
        number: Number(m[2]),
      }));
    for (const [local, raw] of compounds) {
      const location = where + "/" + local;
      const spec = asStructure(raw);
      const shared = spec.use === undefined ? undefined : outer?.get(spec.use);
      if (spec.use !== undefined && !shared)
        throw new Error(`${location}: unknown structure binding ${spec.use}`);
      const mapsFor = (refs: string[]) =>
        refs
          .flatMap(eventRefs)
          .filter((event) => event.local === local)
          .map((event) => event.number);
      const frameMaps = {
        electronic: mapsFor([
          ...(state.arrows ?? []).flatMap(({ from, to }) => [from, to]),
          ...(state.labels ?? [])
            .filter(({ kind }) => kind !== "text")
            .map(({ at }) => at),
        ]),
        protected: mapsFor([
          ...(state.labels ?? [])
            .filter(({ kind }) => kind === "text")
            .map(({ at }) => at),
          ...(state.partialBonds ?? []).flatMap(({ from, to }) => [from, to]),
        ]),
      };
      const piSources = (state.arrows ?? [])
        .filter((a) => a.from.startsWith("pi("))
        .map(({ from }) => eventRefs(from))
        .filter(
          (pair) =>
            pair.length === 2 && pair.every((ref) => ref.local === local),
        )
        .map((pair) => pair.map(({ number }) => number));
      const bound = orientation?.get(location);
      const placementArrows =
        compounds.length === 1 && state.arrows?.length
          ? [
              ...(spec.arrows ?? []),
              ...state.arrows.map((arrow) => ({
                ...arrow,
                from: arrow.from.replaceAll(local + ":", ""),
                to: arrow.to.replaceAll(local + ":", ""),
              })),
            ]
          : spec.arrows;
      const layoutSpec = {
        ...shared?.spec,
        ...spec,
        ...(placementArrows && { arrows: placementArrows }),
        enclose: [...(spec.enclose ?? []), ...(state.enclose ?? [])],
      };
      const r =
        bound ??
        (shared && !isChemical(shared)
          ? shared
          : await resolveStructure(
              layoutSpec,
              location,
              frameMaps,
              piSources,
              !!outer,
            ));
      resolved.set(local, r);
    }
    const singleMixture =
      resolved.size === 1 &&
      [...resolved.values()].some(
        (r) => isChemical(r) && r.compound.smiles.includes("."),
      );
    if (
      !orientation &&
      (singleMixture ||
        state.arrows?.length ||
        [...resolved.values()].some((r) => r.spec.arrows?.length))
    ) {
      for (const cid of depictStructures(
        rd,
        resolved,
        { ...graphSource, arrows: [], anchor: resolved.keys().next().value },
        (local) => variantName(where + "/" + local),
        style,
      ))
        generated.add(cid);
    }
    for (const [local, r] of resolved) {
      const authoredSpec = asStructure(state.compounds![local]);
      const variant = authoredSpec.variant;
      if (variant !== undefined) {
        selectSavedVariant(r, variant, where + "/" + local);
      } else {
        const binding = bindings.get(where + "/" + local);
        if (isChemical(r) && binding?.ref === r.compound.id)
          r.variant ??= binding.variant;
        positionArrowFragments(r);
      }
      const scene = blank();
      scene.molecules.push(placement(r, local, { x: 0, y: 0 }));
      const mark = authoredSpec.mark ?? graphSource.mark;
      if (mark && isChemical(r)) {
        const query = rd.get_qmol(mark);
        if (!query) throw new Error(`${where}: invalid mark SMARTS`);
        const mol = openMolecule(rd, r.compound.smiles);
        try {
          const matches: { atoms: number[]; bonds: number[] }[] = JSON.parse(
            mol.get_substruct_matches(query),
          );
          const atom = (idx: number) => ({
            molecule: local,
            atom: r.compound.atomIds[idx],
          });
          const graph = graphOf(mol);
          scene.changes = {
            atoms: [...new Set(matches.flatMap((match) => match.atoms))].map(
              atom,
            ),
            bonds: [...new Set(matches.flatMap((match) => match.bonds))].map(
              (idx) => {
                const [from, to] = graph.bonds[idx].atoms;
                return [atom(from), atom(to)];
              },
            ),
          };
        } finally {
          mol.delete();
          query.delete();
        }
      }
      if (
        isChemical(r) &&
        variant === undefined &&
        state.arrows?.length &&
        cells.length === 0 &&
        Object.keys(state.compounds!).length === 1
      )
        layoutOf(r).methylLabels = [];
      pushArrows(
        scene,
        {
          ...r,
          spec: {
            ...r.spec,
            arrows: authoredSpec.arrows,
            focus: authoredSpec.focus,
          },
        },
        local,
        true,
      );
      pushEnclosures(scene, r, local);
      cells.push({ key: local, spec: r.spec, scene });
    }
    if (!cells.length) {
      const scene = blank();
      cells.push({ key: where, spec: { text: state.text }, scene });
      return {
        scene: await compilePanelScene(entries, figure, {}, cells, style),
        cells,
        bindings: {},
        resolved,
      };
    }
    const atoms = new Map<string, AtomRef>(
      [...resolved].flatMap(([local, r]) =>
        [...r.atoms].map(
          ([number, atom]) =>
            [`${local}:${number}`, { molecule: local, atom }] as const,
        ),
      ),
    );
    const atom = (key: string): AtomRef => {
      const value = atoms.get(key.includes(":") ? key : `structure:${key}`);
      if (!value) throw new Error(`${where}: unknown atom ${key}`);
      return value;
    };
    const labelContext = createFigureScene(style, await loadFigureFonts());
    for (const label of state.labels ?? []) {
      const at = atom(label.at),
        r = resolved.get(at.molecule)!;
      if (!isChemical(r))
        throw new Error(`${where}.labels: requires a chemical atom`);
      let offset = label.offset ?? { x: 0, y: 0 };
      if (
        !label.offset &&
        (label.kind === "text" || label.kind === "partialCharge")
      ) {
        const molecule = openMolecule(rd, r.compound.smiles);
        try {
          const index = r.compound.atomIds.indexOf(at.atom),
            points = placedCoordinates(
              rd,
              r.compound,
              layoutOf(r),
              -(r.spec.rot ?? 0) + (r.spec.flip === "v" ? 180 : 0),
              !!r.spec.flip,
            );
          const angles = graphOf(molecule)
            .bonds.flatMap((b) =>
              b.atoms.includes(index)
                ? [b.atoms.find((i) => i !== index)!]
                : [],
            )
            .map(
              (i) =>
                (Math.atan2(
                  -(points[i].y - points[index].y),
                  points[i].x - points[index].x,
                ) +
                  2 * Math.PI) %
                (2 * Math.PI),
            )
            .sort((a, b) => a - b);
          const gaps = angles.map((angle, i) => ({
            angle,
            gap:
              angles[(i + 1) % angles.length] +
              (i === angles.length - 1 ? 2 * Math.PI : 0) -
              angle,
          }));
          const largest = gaps.sort((a, b) => b.gap - a.gap)[0],
            angle = largest ? largest.angle + largest.gap / 2 : -Math.PI / 2;
          const width =
            labelContext.textWidth(words(label.text), "var(--chemical-font)") /
            labelContext.token("--chemical-bond");
          offset = {
            x: Math.cos(angle) * (0.8 + width / 2),
            y: Math.sin(angle) * 1.1,
          };
        } finally {
          molecule.delete();
        }
      }
      cells
        .find((cell) => cell.key === at.molecule)!
        .scene.labels!.push({
          id: String(label.id),
          at,
          kind: label.kind,
          offset,
          ...(label.text === undefined ? {} : { text: String(label.text) }),
        });
    }

    const bonds = (state.partialBonds ?? []).map(({ from, to, order }) => ({
      atoms: [atom(from), atom(to)] as [AtomRef, AtomRef],
      order: order ?? 1,
    }));
    let scene: Scene;
    if (groupLayout) {
      scene = await groupLayout(cells);
    } else if (
      cells.length === 1 &&
      cells[0].key === "structure" &&
      !state.labels &&
      !bonds.length
    ) {
      scene = cells[0].scene;
      const r = resolved.get("structure")!;
      const box = bounds(rd, r);
      if (outgoing && outgoing.arrow.kind !== "none") {
        const y = orientation ? (box.top + box.bottom) / 2 : 0;
        scene.reactionArrows!.push({
          id: outgoing.id,
          from: { x: box.right + 1, y },
          to: { x: box.right + 5, y },
          kind: outgoing.arrow.kind,
          above: outgoing.arrow.above,
          below: outgoing.arrow.below,
        });
      }
      fit(scene, [
        { x: box.left, y: box.top },
        { x: box.right, y: box.bottom },
      ]);
    } else {
      if (
        cells.length === 1 &&
        cells[0].key === "structure" &&
        cells[0].spec.label === undefined
      )
        cells[0].spec = { ...cells[0].spec, label: "" };
      scene = await compileStateLayout(
        entries,
        figure,
        cells,
        style,
        (state.arrows ?? []).flatMap((arrow) => {
          const from = eventRefs(arrow.from).map((ref) =>
            atom(`${ref.local}:${ref.number}`),
          );
          const to = eventRefs(arrow.to).map((ref) =>
            atom(`${ref.local}:${ref.number}`),
          );
          const pairs: [AtomRef, AtomRef][] = arrow.to.startsWith("between(")
            ? [[to[0], to[1]]]
            : from.flatMap((a) => to.map((b): [AtomRef, AtomRef] => [a, b]));
          return pairs.filter(([a, b]) => a.molecule !== b.molecule);
        }),
        bonds.map(({ atoms }) => atoms),
        !!outer,
      );
    }
    const first = resolved.values().next().value!;
    pushArrows(
      scene,
      { ...first, spec: { arrows: state.arrows, focus: state.focus } },
      "structure",
      false,
      atom,
    );
    if (bonds.length) (scene.partialBonds ??= []).push(...bonds);
    if (state.tone === "comparison") scene.comparison = true;
    if (state.transitionState) scene.transitionState = true;
    atomsByState.set(where, atoms);
    const stateBindings = Object.fromEntries(
      scene.molecules.map(({ id, compound, variant }) => [
        id,
        { ref: compound, variant },
      ]),
    );
    return { scene, cells, bindings: stateBindings, resolved };
  }

  const newArrow = (edge: SchemeArrow): GraphArrow => ({
    from: endpoints(edge.from).map(authoredParticipant),
    to: endpoints(edge.to).map(authoredParticipant),
    kind: edge.kind,
    role: edge.role,
    title: edge.title === undefined ? undefined : words(edge.title),
    above: lines(edge.above),
    below: lines(edge.below),
    tags: edge.tags,
    sources: edge.sources?.map(({ source, locator, note }) => ({
      source: words(source),
      locator: words(locator) || words(edge.title) || title,
      note: note === undefined ? undefined : words(note),
    })),
    in: edge.in === undefined ? undefined : words(edge.in),
    out: edge.out === undefined ? undefined : words(edge.out),
    settings: {
      others: edge.others,
      turn: edge.turn,
      side: edge.side,
      reverse: edge.reverse,
    },
  });

  function resetArrowMap(
    graph: FigureGraph,
    source: SchemeGraph,
    prefix: string,
  ) {
    for (const [id, edge] of Object.entries(graph.arrows)) {
      const [from] = edge.from;
      const [to] = edge.to;
      if (edge.from.length !== 1 || edge.to.length !== 1) continue;
      const a = atomsByState.get(prefix + from.state);
      const b = atomsByState.get(prefix + to.state);
      if (!a || !b) continue;
      const qualify = (key: string | number) =>
        String(key).includes(":") ? String(key) : "structure:" + key;
      const explicit = new Map(
        Object.entries(source.arrows[id].map ?? {}).map(([atom, target]) => [
          qualify(atom),
          qualify(target),
        ]),
      );
      const taken = new Set(explicit.values());
      for (const [key, target] of explicit)
        if (!a.has(key) || !b.has(target))
          throw new Error(`${prefix}${id}: unknown mapped atom`);
      const matchImplicit =
        edge.kind !== "none" &&
        source.states[from.state]?.tone !== "comparison";
      const map = [...a].flatMap(([key, ref]) => {
        const other =
          explicit.get(key) ?? (matchImplicit && !taken.has(key) ? key : "");
        const target = b.get(other);
        if (!target) return [];
        return [
          {
            from: { ...ref, molecule: from.state + "/" + ref.molecule },
            to: { ...target, molecule: to.state + "/" + target.molecule },
          },
        ];
      });
      if (map.length) edge.map = map;
    }
  }

  function simpleCycle(graph: FigureGraph) {
    const keys = Object.keys(graph.states);
    const edges = Object.entries(graph.arrows).filter(
      ([, edge]) => edge.kind !== "none",
    );
    if (
      keys.length < 2 ||
      edges.length !== keys.length ||
      edges.some(
        ([, edge]) =>
          edge.from.length !== 1 ||
          edge.to.length !== 1 ||
          edge.role !== "elementary",
      )
    )
      return;
    const next = new Map(edges.map((pair) => [pair[1].from[0].state, pair]));
    const start = graph.layout?.anchor ?? keys[0];
    const cycle: [string, GraphArrow][] = [];
    const states: string[] = [];
    let state = start;
    while (!states.includes(state)) {
      const edge = next.get(state);
      if (!edge) return;
      states.push(state);
      cycle.push(edge);
      state = edge[1].to[0].state;
    }
    if (state === start && states.length === keys.length)
      return { states, cycle };
  }

  async function compileGraph(
    source: SchemeGraph,
    graph: FigureGraph,
    prefix: string,
    outer?: Map<string, Resolved>,
  ) {
    graph.layout = source.layout ? { ...source.layout } : undefined;
    graph.yields = source.yields?.map((span) => ({
      arrows: span.arrows,
      product: span.product,
      yield: span.yield,
      note: span.note === undefined ? undefined : words(span.note),
      sources: span.sources?.map(({ source, locator, note }) => ({
        source: words(source),
        locator: words(locator) || span.product,
        note: note === undefined ? undefined : words(note),
      })),
    }));
    for (const [key, state] of Object.entries(source.states))
      graph.states[key] = {
        title: state.title === undefined ? undefined : words(state.title),
        text: state.text === undefined ? undefined : words(state.text),
      };
    for (const [key, edge] of Object.entries(source.arrows))
      graph.arrows[key] = newArrow(edge);
    if (Object.values(graph.arrows).some(({ role }) => role === "reaction")) {
      await compileTransformations(source, graph, prefix);
      return;
    }
    const cycle = simpleCycle(graph);
    const childMembers = new Set(
      Object.values(source.groups ?? {})
        .filter(({ edges }) => edges?.length)
        .flatMap(({ items }) => items),
    );
    const authoredStates = Object.entries(source.states);
    const layoutAsGrid =
      Object.keys(graph.arrows).length === 0 &&
      (authoredStates.length > 1 || source.groups !== undefined);
    const orderedCells = new Map<string, PanelCell>();
    const oriented = new Map<string, Resolved>();
    const isLinear =
      !layoutAsGrid &&
      !cycle &&
      authoredStates.length > 1 &&
      !childMembers.size &&
      authoredStates.every(
        ([, state]) =>
          !state.labels &&
          !state.partialBonds &&
          Object.keys(state.compounds ?? {}).join() === "structure" &&
          !asStructure(state.compounds!.structure).use &&
          asStructure(state.compounds!.structure).align !== false,
      ) &&
      Object.values(source.arrows).every(({ kind }) => kind !== "none") &&
      authoredStates.some(([, state]) => state.arrows?.length);
    if (isLinear) {
      for (const [state, spec] of authoredStates) {
        const shape = asStructure(spec.compounds!.structure);
        oriented.set(
          prefix + state + "/structure",
          await resolveStructure(
            {
              ...shape,
              arrows: spec.arrows,
              focus: spec.focus,
              enclose: spec.enclose ?? shape.enclose,
            },
            prefix + state + "/structure",
            undefined,
            [],
            spec.tone !== "comparison",
          ),
        );
      }
      for (const cid of depictStructures(
        rd,
        oriented,
        {
          ...graphSource,
          arrows: Object.values(graph.arrows).map(({ from, to }) => ({
            from: from.map(({ state }) => prefix + state + "/structure"),
            to: to.map(({ state }) => prefix + state + "/structure"),
          })),
        },
        variantName,
        style,
      ))
        generated.add(cid);
    }
    for (const [key, state] of authoredStates) {
      const out = Object.entries(graph.arrows).find(
        ([id, arrow]) =>
          source.views?.[key]?.arrows?.includes(id) &&
          arrow.from.some(({ state }) => state === key),
      );
      const { scene, cells, bindings } = await compileState(
        state,
        prefix + key,
        outer,
        oriented.size ? oriented : undefined,
        out && { id: out[0], arrow: out[1] },
      );
      graph.states[key].compounds = bindings;
      graph.states[key].scene = scene;
      const label = cells.length === 1 ? cells[0].spec : {};
      orderedCells.set(key, {
        key,
        spec: {
          ...label,
          ...(state.text === undefined &&
            state.title !== undefined && { label: state.title }),
        },
        scene,
      });
    }
    if (source.groups) {
      graph.groups = {};
      for (const [id, group] of Object.entries(source.groups)) {
        for (const item of group.items)
          if (!orderedCells.has(item))
            throw new Error(`${prefix}${id}: unknown state ${item}`);
        const layoutGroup = async (cells: PanelCell[]) =>
          compileGroupLayout(
            entries,
            figure,
            cells,
            Object.fromEntries(
              group.items.map((item) => [item, graph.states[item]]),
            ),
            Object.fromEntries(
              group.edges!.map((edge) => [edge, graph.arrows[edge]]),
            ),
            style,
          );
        const scene = group.edges?.length
          ? (
              await compileState(
                {
                  ...group,
                  compounds: Object.assign(
                    {},
                    ...group.items.map((item) => source.states[item].compounds),
                  ),
                },
                prefix + id,
                outer,
                undefined,
                undefined,
                (cells) =>
                  layoutGroup(
                    cells.map((cell) => ({
                      ...cell,
                      key: group.items.find((item) =>
                        Object.hasOwn(
                          source.states[item].compounds ?? {},
                          cell.key,
                        ),
                      )!,
                    })),
                  ),
              )
            ).scene
          : undefined;
        graph.groups[id] = {
          items: group.items,
          edges: group.edges,
          title: group.title === undefined ? undefined : words(group.title),
          subtitle:
            group.subtitle === undefined ? undefined : words(group.subtitle),
          scene,
        };
      }
    }
    if (cycle || layoutAsGrid) {
      const cells = cycle
        ? cycle.states.map((id) => orderedCells.get(id)!)
        : [...orderedCells.values()];
      const groups = source.groups && Object.values(source.groups);
      const panel = await compilePanelScene(
        entries,
        figure,
        {
          ...source.layout,
          groups: cycle ? undefined : groups,
          cycle: cycle?.cycle,
        },
        cells,
        style,
      );
      graph.layout = { ...graph.layout, panel };
      if (!prefix)
        figure.views.overview ??= { items: cells.map(({ key }) => key) };
    } else {
      for (const key of Object.keys(graph.states))
        if (!childMembers.has(key))
          figure.views[prefix ? prefix.replace(/\/via\/$/, "/") + key : key] ??=
            { items: [prefix + key] };
    }
    resetArrowMap(graph, source, prefix);
  }

  async function compileTransformations(
    source: SchemeGraph,
    graph: FigureGraph,
    prefix: string,
  ) {
    const structures = new Map<string, Resolved>();
    const textStates = new Map<string, StructureInput>();
    for (const [state, item] of Object.entries(source.states)) {
      if (item.text !== undefined) textStates.set(state, { text: item.text });
      for (const [local, value] of Object.entries(item.compounds ?? {})) {
        const location = state + "/" + local;
        const spec = asStructure(value);
        const align =
          typeof spec.align === "string" || typeof spec.align === "number"
            ? String(spec.align)
            : undefined;
        if (align && !align.includes("/") && source.states[align]?.compounds)
          spec.align =
            align + "/" + Object.keys(source.states[align].compounds!)[0];
        const authoredEnclosures = Object.values(source.arrows).flatMap(
          (arrow) => arrow.enclose?.[state] ?? [],
        );
        structures.set(
          location,
          await resolveStructure(
            {
              label: "",
              ...spec,
              enclose: [...(spec.enclose ?? []), ...authoredEnclosures],
            },
            prefix + location,
          ),
        );
      }
    }
    const group = (ends: SchemeArrow["from"]) =>
      endpoints(ends).flatMap((raw) => {
        const item = authoredParticipant(raw);
        const state = source.states[item.state];
        if (!state) throw new Error(`Unknown state ${item.state}`);
        const keys = item.placement
          ? [item.placement]
          : Object.keys(state.compounds ?? {});
        if (!keys.length) return [{ ...item, key: item.state }];
        return keys.map((placement) => ({
          ...item,
          placement,
          key: item.state + "/" + placement,
        }));
      });
    const arrows = Object.entries(source.arrows).map(([id, arrow]) => ({
      id,
      from: group(arrow.from),
      to: group(arrow.to),
    }));
    const anchor = source.layout?.anchor;
    for (const cid of depictStructures(
      rd,
      structures,
      {
        ...graphSource,
        anchor:
          anchor &&
          (structures.has(anchor)
            ? anchor
            : anchor +
              "/" +
              Object.keys(source.states[anchor]?.compounds ?? {})[0]),
        arrows: arrows.map(({ from, to }) => ({
          from: from.map(({ key }) => key),
          to: to.map(({ key }) => key),
        })),
      },
      (key) => variantName(prefix + key),
      style,
      (key) => {
        const r = structures.get(key);
        if (r) positionArrowFragments(r);
      },
    ))
      generated.add(cid);
    for (const [key, state] of Object.entries(source.states)) {
      graph.states[key].compounds = Object.fromEntries(
        Object.entries(state.compounds ?? {}).map(([local, input]) => {
          const location = key + "/" + local;
          const r = structures.get(location)!;
          const { variant } = asStructure(input);
          if (variant !== undefined)
            selectSavedVariant(r, variant, prefix + location);
          return [
            local,
            {
              ref: r.compound.id,
              variant: isChemical(r) ? r.variant : undefined,
            },
          ];
        }),
      );
    }
    const resolve = (key: string) => {
      const r = structures.get(key) ?? textStates.get(key);
      if (!r) throw new Error(`Unknown placement ${key}`);
      return r;
    };
    for (const { id: sid, from: fromEndpoints, to: toEndpoints } of arrows) {
      const authored = source.arrows[sid];
      const edge = graph.arrows[sid];
      const scene = blank();
      const reactants: Participant[] = [];
      const products: Participant[] = [];
      const reagents: string[] = [];
      const extra: Point[] = [];
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
      for (const raw of fromEndpoints) {
        const other = !first;
        const quantity =
          typeof raw === "object" && "equivalents" in raw
            ? { equivalents: raw.equivalents }
            : {};
        const key = raw.key,
          r = resolve(key),
          spec = "compound" in r ? r.spec : r;
        const show = first
          ? "plus"
          : typeof raw === "object"
            ? (raw.show ??
              edge.settings?.others ??
              ("compound" in r ? "plus" : "text"))
            : (edge.settings?.others ?? ("compound" in r ? "plus" : "text"));
        first = false;
        if (show === "text" || show === "none") {
          if (show === "text")
            reagents.push(
              words(spec.text) ||
                [localNumber(raw.state, spec), words(spec.name)]
                  .filter(Boolean)
                  .join(" · "),
            );
          if ("compound" in r)
            reactants.push({
              id: raw.id ?? raw.state,
              sourceKey: key,
              ...(other ? { other: true } : {}),
              ...quantity,
              compound: r.compound.id,
              number: localNumber(raw.state, spec),
              name: words(spec.name),
              position: show,
            });
          continue;
        }
        if (!("compound" in r))
          throw new Error(`${key}: structure required for ${show}`);
        const participant: Participant = {
          id: raw.id ?? raw.state,
          sourceKey: key,
          ...(other ? { other: true } : {}),
          ...quantity,
          compound: r.compound.id,
          number: localNumber(raw.state, spec),
          name: words(spec.name),
          ...(show === "box" ? { position: "above-arrow" } : {}),
        };
        reactants.push(participant);
        if (show !== "box") display(participant.id, r);
      }
      reagents.push(...(edge.above ?? []));
      const from = { x: cursor - 0.7, y: 0 },
        to = { x: cursor + 4.3, y: 0 };
      cursor += 5.8;
      let previousProduct: ReturnType<typeof display> | undefined;
      for (const raw of toEndpoints) {
        const key = raw.key,
          r = resolve(key);
        if (!("compound" in r))
          throw new Error(`${key}: product requires smiles`);
        const p = raw;
        products.push({
          id: raw.id ?? "product-" + raw.state,
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
        const productBox = display(raw.id ?? "product-" + raw.state, r);
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
      for (const p of scene.molecules) {
        const participant = [...reactants, ...products].find(
          (v) => v.id === p.id,
        )!;
        const resolved = resolve(participant.sourceKey!);
        if (!("compound" in resolved))
          throw new Error("Enclosure requires structure");
        pushEnclosures(
          scene,
          resolved,
          p.id,
          authored.enclose?.[participant.sourceKey!.split("/")[0]] ??
            resolved.spec.enclose,
        );
      }
      const { dx, dy } = fit(scene, extra);
      from.x += dx;
      from.y += dy;
      to.x += dx;
      to.y += dy;
      edge.from = fromEndpoints.map(({ key, state, placement, show }) => ({
        state,
        placement,
        show,
        appearance: reactants.find((p) => p.sourceKey === key),
      }));
      edge.to = toEndpoints.map(({ key, state, placement }) => ({
        state,
        placement,
        appearance: products.find((p) => p.sourceKey === key),
      }));
      const drawing: NonNullable<GraphArrow["drawing"]> = {
        reagents,
        conditions: edge.below ?? [],
        reagentPosition: authored.reagentPosition,
        scene,
        arrow: { from, to, textWidth: 5, kind: edge.kind },
      };
      edge.drawing = drawing;
      edge.title ??= title;
      if (authored.via) {
        const via: NonNullable<GraphArrow["via"]> = {
          states: {},
          arrows: {},
          bind: authored.via.bind,
        };
        edge.via = via;
        await compileGraph(
          authored.via,
          via,
          prefix + sid + "/via/",
          structures,
        );
      }
      const manual = (numbers: number[] = []) =>
        numbers.map((n) => {
          const found = products.flatMap((p) => {
            const r = resolve(p.sourceKey!);
            const atom = "compound" in r ? r.atoms.get(n) : undefined;
            return atom ? [{ molecule: p.id, atom }] : [];
          });
          if (found.length !== 1)
            throw new Error(
              `changes: atom ${n} must identify exactly one product`,
            );
          return found[0];
        });
      review.push(
        ...reactionChanges(
          rd,
          entries,
          { ...edge, title: edge.title, drawing },
          {
            enabled:
              graphSource.changes !== false &&
              graphSource.changes !== "off" &&
              authored.changes !== false &&
              authored.changes !== "off",
            ...(typeof authored.changes === "object"
              ? {
                  add: manual(authored.changes.add),
                  remove: manual(authored.changes.remove),
                }
              : {}),
            numbers: Object.fromEntries(
              products.map((p) => {
                const r = resolve(p.sourceKey!);
                return [
                  p.id,
                  "compound" in r
                    ? Object.fromEntries([...r.atoms].map(([n, a]) => [a, n]))
                    : {},
                ];
              }),
            ),
          },
        ),
      );

      await compileArrowLayout(entries, { ...figure, graph }, sid, style);
    }
    if (arrows.length > 1 || existingGraph?.layout?.route)
      await compileGraphLayout(entries, { ...figure, graph }, style);
  }

  await compileGraph(graphSource, figure.graph, "");
  figureRouteMetrics(figure);
  for (const gid of generated) finishFigureEntry(entries[gid]);
  validateLibrary(entries);
  for (const gid of generated) {
    const entry = entries[gid];
    if (entry.kind === "compound") validateCompound(rd, entry);
  }
  for (const scene of graphScenes(figure.graph))
    validateSceneChemistry(rd, entries, scene, sourceFile, true);
  return {
    entries,
    generated: [...generated],
    reference: { ref: id },
    warnings,
    review,
    sourceFile,
  };
}
