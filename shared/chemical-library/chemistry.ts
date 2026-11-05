import type { Mol } from "@rdkit/rdkit";
import { coordinatesFrom, withCoordinates } from "../molecule-layout.ts";
import {
  validateAbbreviations,
  abbreviatedGroups,
} from "../molecule-abbreviations.ts";
import type { Compound, CompoundLayout, Point } from "./types.ts";
export type Toolkit =
  import("../../src/ui/chemistry/rdkit.ts").ChemistryToolkit;
export interface ChemicalGraph {
  atoms: { z?: number; chg?: number; impHs?: number; stereo?: string }[];
  bonds: { atoms: [number, number]; bo?: number }[];
  conformers?: { coords: [number, number][] }[];
}
export function graphOf(mol: Mol): ChemicalGraph {
  return JSON.parse(mol.get_json()).molecules[0];
}
export function openMolecule(toolkit: Toolkit, text: string) {
  const mol = toolkit.get_mol(text);
  if (!mol?.is_valid()) {
    mol?.delete();
    throw new Error("Invalid molecular graph");
  }
  return mol;
}
/** V3000 maps bind IDs to atoms independently of a SMILES traversal. */
export function atomMaps(mol: Mol): number[] {
  return mol
    .get_v3Kmolblock()
    .split("M  V30 BEGIN ATOM\n")[1]
    .split("M  V30 END ATOM")[0]
    .trim()
    .split("\n")
    .map((line) => Number(line.trim().split(/\s+/)[7]));
}
function mappedBlock(mol: Mol, maps: number[]) {
  let inside = false,
    index = 0;
  return mol
    .get_v3Kmolblock()
    .split("\n")
    .map((line) => {
      if (line === "M  V30 BEGIN ATOM") {
        inside = true;
        return line;
      }
      if (line === "M  V30 END ATOM") {
        inside = false;
        return line;
      }
      if (!inside) return line;
      const fields = line.trim().split(/\s+/);
      fields[7] = String(maps[index++]);
      return "M  V30 " + fields.slice(2).join(" ");
    })
    .join("\n");
}
export function unmappedMolecule(toolkit: Toolkit, mol: Mol) {
  return openMolecule(
    toolkit,
    mappedBlock(mol, Array(mol.get_num_atoms()).fill(0)),
  );
}
function graphSignature(toolkit: Toolkit, mol: Mol) {
  const copy = unmappedMolecule(toolkit, mol);
  try {
    copy.remove_hs_in_place();
    return copy.get_smiles();
  } finally {
    copy.delete();
  }
}
export function prepareCompound(
  toolkit: Toolkit,
  input: Pick<Compound, "id" | "title" | "smiles" | "sources">,
  molfile?: string,
): Compound {
  const mol = openMolecule(toolkit, input.smiles);
  try {
    const graph = graphSignature(toolkit, mol);
    let coords: [number, number][];
    if (molfile) {
      const imported = openMolecule(toolkit, molfile);
      try {
        imported.remove_hs_in_place();
        if (graphSignature(toolkit, imported) !== graph)
          throw new Error(
            `${input.id}: molfile graph or stereochemistry differs`,
          );
        const matched = coordinatesFrom(
          toolkit,
          input.smiles,
          imported.get_molblock(),
        );
        if (!matched)
          throw new Error(`${input.id}: cannot map molfile coordinates`);
        coords = matched.map((p) => [p[0], p[1]]);
      } finally {
        imported.delete();
      }
    } else {
      if (!mol.has_coords()) mol.set_new_coords();
      coords = graphOf(mol).conformers![0].coords;
    }
    const existingMaps = atomMaps(mol);
    const maps =
      existingMaps.every((n) => n > 0) &&
      new Set(existingMaps).size === coords.length
        ? existingMaps
        : coords.map((_, i) => i + 1);
    const atoms = maps.map((n) => `a${n}`);
    const mapped = openMolecule(toolkit, mappedBlock(mol, maps));
    let smiles: string;
    try {
      smiles = mapped.get_smiles(JSON.stringify({ canonical: false }));
    } finally {
      mapped.delete();
    }
    const serialized = openMolecule(toolkit, smiles);
    let atomIds: string[];
    try {
      atomIds = atomMaps(serialized).map((n) => `a${n}`);
    } finally {
      serialized.delete();
    }
    const lengths = graphOf(mol)
      .bonds.map(({ atoms: [a, b] }) =>
        Math.hypot(coords[a][0] - coords[b][0], coords[a][1] - coords[b][1]),
      )
      .sort((a, b) => a - b);
    const unit = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 1.5;
    if (unit < 1e-6) throw new Error(`${input.id}: degenerate coordinates`);
    const xs = coords.map((p) => p[0]),
      ys = coords.map((p) => p[1]);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2,
      cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    return {
      ...input,
      smiles,
      kind: "compound",
      graph,
      atomIds,
      layout: {
        coords: Object.fromEntries(
          atoms.map((id, i) => [
            id,
            { x: (coords[i][0] - cx) / unit, y: -(coords[i][1] - cy) / unit },
          ]),
        ),
      },
    };
  } finally {
    mol.delete();
  }
}
export function validateCompound(toolkit: Toolkit, c: Compound) {
  const mol = openMolecule(toolkit, c.smiles);
  try {
    if (graphSignature(toolkit, mol) !== c.graph)
      throw new Error(`${c.id}: graph changed; review saved layout`);
    if (c.atomIds.length !== mol.get_num_atoms())
      throw new Error(`${c.id}: atom ID count differs`);
    if (atomMaps(mol).some((map, i) => map <= 0 || c.atomIds[i] !== `a${map}`))
      throw new Error(`${c.id}: atom IDs must match persistent SMILES maps`);
    for (const layout of [c.layout, ...Object.values(c.variants ?? {})]) {
      if (
        Object.keys(layout.coords).length !== c.atomIds.length ||
        c.atomIds.some((id) => !layout.coords[id])
      )
        throw new Error(`${c.id}: complete saved coordinates required`);
      for (const id of [
        ...Object.keys(layout.pins ?? {}),
        ...Object.keys(layout.labels ?? {}),
      ])
        if (!c.atomIds.includes(id))
          throw new Error(`${c.id}: unknown layout atom ${id}`);
      validateAbbreviations(layout.abbreviations, c.id);
      abbreviatedGroups(toolkit, mol, layout.abbreviations, c.id);
    }
    const g = graphOf(mol);
    const dummies = c.atomIds.filter((_, i) => g.atoms[i].z === 0);
    if (
      c.attachment &&
      (dummies.length !== 1 ||
        dummies[0] !== c.attachment ||
        g.bonds.filter((b) =>
          b.atoms.includes(c.atomIds.indexOf(c.attachment!)),
        ).length !== 1 ||
        c.template?.length)
    )
      throw new Error(`${c.id}: substituent needs one terminal attachment`);
    if (!c.attachment && dummies.length !== (c.template?.length ?? 0))
      throw new Error(`${c.id}: each dummy requires an R template definition`);
    for (const t of c.template ?? [])
      if (!dummies.includes(t.atom))
        throw new Error(`${c.id}: template must name a dummy atom`);
  } finally {
    mol.delete();
  }
}
export function placedCoordinates(
  c: Compound,
  layout: CompoundLayout,
  rotate = 0,
  mirror = false,
) {
  const a = (rotate * Math.PI) / 180;
  return c.atomIds.map((id) => {
    const p = layout.pins?.[id] ?? layout.coords[id],
      x = mirror ? -p.x : p.x;
    return {
      x: x * Math.cos(a) - p.y * Math.sin(a),
      y: x * Math.sin(a) + p.y * Math.cos(a),
    };
  });
}
export function drawingMolecule(
  toolkit: Toolkit,
  c: Compound,
  points: Point[],
) {
  const mapped = openMolecule(
    toolkit,
    withCoordinates(
      c.smiles,
      points.map((p) => [p.x * 1.5, -p.y * 1.5]),
    ),
  );
  try {
    return unmappedMolecule(toolkit, mapped);
  } finally {
    mapped.delete();
  }
}
/** Align an explicit pair of atom correspondences; the caller persists the resulting coordinates. */
export function alignCoordinates(
  coords: Record<string, Point>,
  reference: Record<string, Point>,
  pairs: [string, string][],
): Record<string, Point> {
  if (pairs.length < 2) throw new Error("Alignment needs two atom pairs");
  const [a, b] = pairs;
  const p = coords[a[0]],
    q = coords[b[0]],
    r = reference[a[1]],
    s = reference[b[1]];
  if (!p || !q || !r || !s) throw new Error("Unknown alignment atom");
  const angle =
    Math.atan2(s.y - r.y, s.x - r.x) - Math.atan2(q.y - p.y, q.x - p.x);
  return Object.fromEntries(
    Object.entries(coords).map(([id, v]) => [
      id,
      {
        x: r.x + (v.x - p.x) * Math.cos(angle) - (v.y - p.y) * Math.sin(angle),
        y: r.y + (v.x - p.x) * Math.sin(angle) + (v.y - p.y) * Math.cos(angle),
      },
    ]),
  );
}

/** Validate chemical anchors at the persisted content boundary. */
export function validateSceneChemistry(
  toolkit: Toolkit,
  library: import("./types.ts").Library,
  scene: import("./types.ts").Scene,
  where: string,
) {
  const molecules = new Map(
    scene.molecules.map((placement) => {
      const compound = library[placement.compound];
      if (compound?.kind !== "compound")
        throw new Error(`${where}: missing compound`);
      const mol = openMolecule(toolkit, compound.smiles);
      try {
        const layout = placement.variant
          ? compound.variants![placement.variant]
          : compound.layout;
        return [
          placement.id,
          {
            compound,
            graph: graphOf(mol),
            hidden: new Set(
              abbreviatedGroups(toolkit, mol, layout.abbreviations).flatMap(
                (g) => g.atoms,
              ),
            ),
          },
        ] as const;
      } finally {
        mol.delete();
      }
    }),
  );
  const atom = (ref: import("./types.ts").AtomRef) => {
    const molecule = molecules.get(ref.molecule),
      index = molecule?.compound.atomIds.indexOf(ref.atom) ?? -1;
    if (!molecule || index < 0)
      throw new Error(`${where}: unknown atom ${ref.molecule}:${ref.atom}`);
    if (molecule.hidden.has(index))
      throw new Error(
        `${where}: folded atom cannot be an anchor ${ref.molecule}:${ref.atom}`,
      );
    return { ...molecule, index };
  };
  const bond = (
    refs: [import("./types.ts").AtomRef, import("./types.ts").AtomRef],
  ) => {
    const a = atom(refs[0]),
      b = atom(refs[1]);
    if (
      refs[0].molecule !== refs[1].molecule ||
      a.index === b.index ||
      !a.graph.bonds.some(
        (edge) => edge.atoms.includes(a.index) && edge.atoms.includes(b.index),
      )
    )
      throw new Error(`${where}: unknown bond anchor`);
  };
  for (const label of scene.labels ?? []) atom(label.at);
  for (const arrow of scene.arrows ?? [])
    for (const anchor of [arrow.from, arrow.to]) {
      if (anchor.kind === "atom") atom(anchor.at);
      else if (anchor.kind === "charge") {
        const a = atom(anchor.at);
        if (!a.graph.atoms[a.index].chg)
          throw new Error(`${where}: charge anchor requires a charged atom`);
      } else if (anchor.kind === "bond") bond(anchor.atoms);
      else if (anchor.kind === "formingBond") anchor.atoms.forEach(atom);
    }
  for (const group of [
    scene.focus?.primary,
    ...(scene.focus?.supporting ?? []),
  ]) {
    group?.atoms?.forEach(atom);
    group?.bonds?.forEach(bond);
  }
}
