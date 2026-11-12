import type { Mol, MainModule as Toolkit } from "@rdkit/rdkit";
import {
  relaxedCoordinates,
  relievedCoordinates,
} from "./figure-coordinate-relief.ts";
import {
  atomMaps,
  graphOf,
  openMolecule,
  graphSignature,
  abbreviatedDrawing,
} from "../shared/chemical-library/chemistry.ts";
import {
  abbreviatedGroups,
  matchingAbbreviations,
  abbreviationLabel,
  type MoleculeAbbreviation,
} from "../shared/molecule-abbreviations.ts";
import type { Compound } from "../shared/chemical-library/types.ts";
import type { FigureInput, StructureInput } from "./figure-input.ts";
import type { FigureStyle } from "../src/ui/library/scene-geometry.ts";
import {
  pathBox,
  pathContours,
  inkIntersectsBox,
} from "../src/ui/library/path-geometry.ts";
import {
  unionBoxes,
  rectangle,
  mainRowBox,
} from "../src/ui/library/geometry-math.ts";
import type { FigureRect } from "../shared/chemical-library/geometry.ts";
import { insidePolygon } from "../src/ui/library/geometry-collision.ts";
import { figureDimension } from "./figure-output.ts";

// The installed MinimalLib exposes this documented overload; its declaration omits it.
declare module "@rdkit/rdkit" {
  interface Mol {
    get_substruct_matches(mol: Mol, details: string): string;
  }
}

const defaults: MoleculeAbbreviation[] = [
  "OTBS",
  "OTBDPS",
  "OTES",
  "OTIPS",
  "OPMB",
  "OBn",
  "OPiv",
  "OAc",
  "OBz",
  "OMOM",
  "OTs",
  "OMs",
  "OTf",
  "NHBoc",
  "TMS",
  "TBS",
  "Boc",
  "Ts",
  "CO₂Me",
  "CO₂Et",
  "CO₂tBu",
  "CN",
  "SCH2Ph",
  "CO₂H",
  "Ac",
  "NO2",
];
export function figureAbbreviations(
  rd: Toolkit,
  mol: Mol,
  spec: StructureInput,
  extra: FigureInput["abbreviate"],
) {
  if (spec.abbreviate === false) return { abbreviations: [] };
  const names = matchingAbbreviations(rd, mol, [...defaults, ...(extra ?? [])]);
  const targets = new Set(
    (spec.arrows ?? []).flatMap((arrow) =>
      [arrow.from, arrow.to].flatMap((s) =>
        [...s.matchAll(/\d+/g)].map((m) => Number(m[0])),
      ),
    ),
  );
  const maps = atomMaps(mol),
    groups = abbreviatedGroups(rd, mol, names),
    retained = groups.filter(
      (g) => !g.atoms.slice(1).some((a) => targets.has(maps[a])),
    );
  return {
    abbreviations: names,
    ...(retained.length === groups.length
      ? {}
      : { abbreviationAtoms: retained.map((g) => g.atoms[0]) }),
  };
}
interface Structure {
  compound: Compound;
  spec: StructureInput;
  variant?: string;
  depiction: { smiles: string; atoms: number[] };
}
function descriptionMolecule(
  rd: Toolkit,
  data: {
    molecules: {
      conformers?: { coords: [number, number][] }[];
      bonds?: { stereo?: string }[];
    }[];
  },
) {
  const coordinates = (data.molecules[0].conformers ?? []).map((c) => c.coords);
  for (const conformer of data.molecules[0].conformers ?? [])
    conformer.coords = [];
  let text = JSON.stringify(data);
  for (const points of coordinates)
    text = text.replace(
      '"coords":[]',
      '"coords":[' +
        points
          .map(([x, y]) => `[${x.toExponential()},${y.toExponential()}]`)
          .join(",") +
        "]",
    );
  const mol = rd.get_mol(
    text,
    JSON.stringify({
      sanitize: false,
      removeHs: false,
      // Assign CIP ranks for canonical depiction. JSON has no directional bonds,
      // so reassignment would erase an existing double-bond configuration.
      assignStereo: !data.molecules[0].bonds?.some(
        (b) => b.stereo === "cis" || b.stereo === "trans",
      ),
    }),
  );
  if (!mol?.is_valid()) {
    mol?.delete();
    throw new Error("Invalid depiction copy");
  }
  return mol;
}
interface DisplayAtoms {
  original: number[];
  labels: Map<number, MoleculeAbbreviation>;
}
const displayAtoms = new WeakMap<Mol, DisplayAtoms>();
function contracted(
  rd: Toolkit,
  full: Mol,
  names: readonly MoleculeAbbreviation[] = [],
  allowed?: number[],
) {
  const groups = abbreviatedGroups(rd, full, names).filter(
      (g) => !allowed || allowed.includes(g.atoms[0]),
    ),
    removed = new Set(groups.flatMap((g) => g.atoms.slice(1))),
    roots = new Map(groups.map((g) => [g.atoms[0], g.name]));
  const data = JSON.parse(full.get_json()),
    source = data.molecules[0],
    original: number[] = source.atoms
      .map((_: unknown, i: number) => i)
      .filter((i: number) => !removed.has(i)),
    indices = new Map(original.map((i, j) => [i, j]));
  const retained: number[] = source.bonds
      .map((_: unknown, i: number) => i)
      .filter((i: number) =>
        source.bonds[i].atoms.every((a: number) => indices.has(a)),
      ),
    bondIndices = new Map(retained.map((i, j) => [i, j]));
  const representation = source.extensions?.find(
    (e: { name: string }) => e.name === "rdkitRepresentation",
  );
  source.atoms = original.map((i) =>
    roots.has(i) ? { z: 0 } : source.atoms[i],
  );
  source.bonds = retained.map((i) => {
    const b = source.bonds[i];
    return {
      ...b,
      atoms: b.atoms.map((a: number) => indices.get(a)),
      ...(b.stereoAtoms
        ? { stereoAtoms: b.stereoAtoms.map((a: number) => indices.get(a)) }
        : {}),
    };
  });
  delete source.conformers;
  source.extensions = representation
    ? [
        {
          name: "rdkitRepresentation",
          formatVersion: 2,
          aromaticAtoms: (representation.aromaticAtoms ?? [])
            .filter((a: number) => indices.has(a) && !roots.has(a))
            .map((a: number) => indices.get(a)),
          aromaticBonds: (representation.aromaticBonds ?? [])
            .filter((b: number) => bondIndices.has(b))
            .map((b: number) => bondIndices.get(b)),
          atomRings: (representation.atomRings ?? [])
            .filter((r: number[]) =>
              r.every((a) => indices.has(a) && !roots.has(a)),
            )
            .map((r: number[]) => r.map((a) => indices.get(a))),
        },
      ]
    : [];
  const shown = descriptionMolecule(rd, data);
  displayAtoms.set(shown, {
    original,
    labels: new Map([...roots].map(([i, name]) => [indices.get(i)!, name])),
  });
  return shown;
}
function matchingCopy(rd: Toolkit, mol: Mol) {
  const data = JSON.parse(mol.get_json());
  for (const [i, name] of displayAtoms.get(mol)?.labels ?? [])
    data.molecules[0].atoms[i] = {
      z:
        60 +
        [...defaults, "Ph", "Trt", "Bz"].indexOf(name as MoleculeAbbreviation),
      impHs: 0,
    };
  return descriptionMolecule(rd, data);
}
function alignCore(
  rd: Toolkit,
  mol: Mol,
  reference: Mol,
  smarts: string,
  coordgen: boolean,
) {
  const query = rd.get_qmol(smarts)!,
    currentMatch = matched(rd, mol, query),
    referenceMatch = matched(rd, reference, query);
  query.delete();
  // Stand-in elements distinguish labels during matching only. Depiction must
  // use the real atoms and an explicit correspondence, as for the source core.
  const currentData = JSON.parse(mol.get_json()),
    targetData = JSON.parse(reference.get_json());
  currentMatch.forEach((a, i) => {
    currentData.molecules[0].atoms[a].isotope = 2000 + i;
    targetData.molecules[0].atoms[referenceMatch[i]].isotope = 2000 + i;
  });
  let index = 0;
  const pattern = smarts.replace(/\[[^\]]+\]/g, () => `[${2000 + index++}*]`),
    current = descriptionMolecule(rd, currentData),
    target = descriptionMolecule(rd, targetData);
  try {
    if (
      !current.generate_aligned_coords(
        target,
        JSON.stringify({
          referenceSmarts: pattern,
          acceptFailure: false,
          useCoordGen: coordgen,
        }),
      )
    )
      return null;
    return withCoordinates(rd, mol, xy(current));
  } finally {
    current.delete();
    target.delete();
  }
}
function expandedCoordinates(
  rd: Toolkit,
  shown: Mol,
  full: Mol,
  coordgen: boolean,
) {
  const { original } = displayAtoms.get(shown)!,
    points = xy(shown);
  if (original.length === full.get_num_atoms()) return points;
  const data = JSON.parse(full.get_json());
  for (const i of original) data.molecules[0].atoms[i].isotope = 2000 + i;
  const working = descriptionMolecule(rd, data),
    templateData = JSON.parse(shown.get_json());
  templateData.molecules[0].atoms = original.map((i) => ({
    z: graphOf(full).atoms[i].z ?? 6,
    isotope: 2000 + i,
  }));
  templateData.molecules[0].extensions = [];
  const template = descriptionMolecule(rd, templateData);
  try {
    const pattern = template
      .get_smarts()
      .replace(/(\[[^\]]*\])|[-=#:]/g, (_s, atom) => atom ?? "~");
    if (
      !working.generate_aligned_coords(
        template,
        JSON.stringify({
          referenceSmarts: pattern,
          acceptFailure: false,
          useCoordGen: coordgen,
        }),
      )
    )
      throw new Error("Cannot expand the contracted depiction");
    working.normalize_depiction(0);
    const expanded = xy(working);
    // Expansion supplies coordinates for hidden atoms. The visible contracted
    // depiction owns the skeleton and label attachment positions.
    original.forEach((atom, i) => {
      expanded[atom] = points[i];
    });
    return expanded;
  } finally {
    working.delete();
    template.delete();
  }
}
const xy = (mol: Mol) => graphOf(mol).conformers![0].coords;
function withCoordinates(
  rd: Toolkit,
  mol: Mol,
  coordinates: [number, number][],
) {
  const data = JSON.parse(mol.get_json());
  data.molecules[0].conformers = [{ dim: 2, coords: coordinates }];
  const copy = descriptionMolecule(rd, data);
  const atoms = displayAtoms.get(mol);
  if (atoms) displayAtoms.set(copy, atoms);
  return copy;
}

function crowded(mol: Mol, limit: number) {
  const graph = graphOf(mol),
    coords = xy(mol),
    bonds = new Set(
      graph.bonds.map((b) => [...b.atoms].sort((a, b) => a - b).join(",")),
    );
  for (let i = 0; i < coords.length; i++)
    for (let j = i + 1; j < coords.length; j++)
      if (
        !bonds.has(`${i},${j}`) &&
        Math.hypot(coords[i][0] - coords[j][0], coords[i][1] - coords[j][1]) <
          limit
      )
        return true;
  return false;
}
function common(rd: Toolkit, reference: Mol, mol: Mol, strict: boolean) {
  const list = new rd.MolList();
  try {
    const a = matchingCopy(rd, reference),
      b = matchingCopy(rd, mol);
    list.append(a);
    list.append(b);
    a.delete();
    b.delete();
    const result: { numAtoms: number; smarts: string } = JSON.parse(
      rd.get_mcs_as_json(
        list,
        JSON.stringify({
          Timeout: 2,
          RingMatchesRingOnly: strict,
          CompleteRingsOnly: strict,
          MatchChiralTag: false,
          BondCompare: "Any",
        }),
      ),
    );
    return result;
  } finally {
    list.delete();
  }
}
function retainsStereo(rd: Toolkit, mol: Mol, identity: string) {
  const drawn = openMolecule(rd, mol.get_molblock());
  try {
    return graphSignature(rd, drawn) === identity;
  } finally {
    drawn.delete();
  }
}
function matched(rd: Toolkit, mol: Mol, query: Mol): number[] {
  const copy = matchingCopy(rd, mol);
  try {
    return JSON.parse(copy.get_substruct_match(query)).atoms ?? [];
  } finally {
    copy.delete();
  }
}
function free(rd: Toolkit, mol: Mol, coordgen: boolean) {
  mol.set_new_coords(coordgen);
  if (!coordgen) {
    // RDDepict's EmbeddedFrag::canonicalizeOrientation rotates in 2D.
    // normalize_depiction(1) uses a 3D canonical transform and may mirror the plane.
    const points = xy(mol),
      cx = points.reduce((n, p) => n + p[0], 0) / points.length,
      cy = points.reduce((n, p) => n + p[1], 0) / points.length;
    const centered = points.map(([x, y]): [number, number] => [x - cx, y - cy]);
    const xx = centered.reduce((n, p) => n + p[0] * p[0], 0),
      yy = centered.reduce((n, p) => n + p[1] * p[1], 0),
      cross = centered.reduce((n, p) => n + p[0] * p[1], 0);
    const ex = 2 * cross,
      ey = yy - xx + Math.hypot(xx - yy, 2 * cross),
      length = Math.hypot(ex, ey);
    const canonical = withCoordinates(
      rd,
      mol,
      length > 1e-4
        ? centered.map(([x, y]): [number, number] => [
            (x * ex + y * ey) / length,
            (-x * ey + y * ex) / length,
          ])
        : centered,
    );
    mol.delete();
    mol = canonical;
  }
  mol.straighten_depiction();
  mol.normalize_depiction(0);
  return mol;
}
function rings(mol: Mol): number[][] {
  return (
    JSON.parse(mol.get_json()).molecules[0].extensions?.find(
      (e: { name: string }) => e.name === "rdkitRepresentation",
    )?.atomRings ?? []
  );
}
function follow(rd: Toolkit, mol: Mol, reference: Mol, coordgen: boolean) {
  const result = common(rd, reference, mol, false);
  if (result.numAtoms < 4) return false;
  const query = rd.get_qmol(result.smarts)!;
  try {
    const rm = matched(rd, reference, query),
      mm = matched(rd, mol, query),
      toRef = new Map(mm.map((a, i) => [a, rm[i]]));
    const graph = graphOf(mol),
      referenceRings = rings(reference),
      freeAtoms = new Set<number>();
    const referenceRingBonds = new Set(
      referenceRings.flatMap((r) =>
        r.map((a, i) =>
          [a, r[(i + 1) % r.length]].sort((a, b) => a - b).join(","),
        ),
      ),
    );
    for (const ring of rings(mol))
      if (
        !ring.every((a, i) => {
          const b = ring[(i + 1) % ring.length];
          return (
            toRef.has(a) &&
            toRef.has(b) &&
            referenceRingBonds.has(
              [toRef.get(a)!, toRef.get(b)!].sort((a, b) => a - b).join(","),
            )
          );
        })
      )
        for (const a of ring) freeAtoms.add(a);
    const pinned = mm.filter((a) => !freeAtoms.has(a));
    if (pinned.length < 4) return false;
    const indices = new Map(pinned.map((a, i) => [a, i])),
      rxy = xy(reference),
      data = JSON.parse(mol.get_json());
    data.molecules = [
      {
        atoms: pinned.map((a) => ({ z: graph.atoms[a].z ?? 6 })),
        bonds: graph.bonds
          .filter((b) => b.atoms.every((a) => indices.has(a)))
          .map((b) => ({ atoms: b.atoms.map((a) => indices.get(a)!) })),
        conformers: [{ dim: 2, coords: [] }],
      },
    ];
    const coords = pinned.map((a) => rxy[toRef.get(a)!]);
    const text = JSON.stringify(data).replace(
      '"coords":[]',
      '"coords":[' +
        coords
          .map(([x, y]) => `[${x.toExponential()},${y.toExponential()}]`)
          .join(",") +
        "]",
    );
    const template = openMolecule(rd, text, false);
    try {
      // Only elements and connectivity constrain the pinned core, as in the loose MCS.
      const pattern = template
        .get_smarts()
        .replace(/(\[[^\]]*\])|[-=#:]/g, (_s, atom) => atom ?? "~");
      if (
        !mol.generate_aligned_coords(
          template,
          JSON.stringify({
            referenceSmarts: pattern,
            acceptFailure: false,
            useCoordGen: coordgen,
          }),
        )
      )
        return false;
      const points = xy(mol);
      if (
        graph.bonds.some(({ atoms: [a, b] }) => {
          const d = Math.hypot(
            points[a][0] - points[b][0],
            points[a][1] - points[b][1],
          );
          return d <= 0.9 || d >= 2.1;
        })
      )
        return false;
      return !crowded(mol, 0.9);
    } finally {
      template.delete();
    }
  } finally {
    query.delete();
  }
}
function orient(rd: Toolkit, mol: Mol, reference: Mol) {
  const result = common(rd, reference, mol, false);
  if (result.numAtoms < 3) return;
  const query = rd.get_qmol(result.smarts)!;
  try {
    const rm = matched(rd, reference, query),
      points = xy(mol),
      rpoints = xy(reference),
      ref = rm.map((i) => rpoints[i]);
    if (!rm.length) return;
    const center = (p: [number, number][]) => [
      p.reduce((n, p) => n + p[0], 0) / p.length,
      p.reduce((n, p) => n + p[1], 0) / p.length,
    ];
    const rc = center(ref);
    let best: { error: number; flip: number; angle: number } | undefined;
    const matching = matchingCopy(rd, mol);
    const matches: { atoms: number[] }[] = JSON.parse(
      matching.get_substruct_matches(
        query,
        JSON.stringify({ uniquify: false, maxMatches: 60 }),
      ),
    );
    matching.delete();
    for (const match of matches) {
      const selected = match.atoms.map((i) => points[i]),
        c = center(selected);
      for (const flip of [1, -1])
        for (let k = 0; k < 12; k++) {
          const angle = (k * Math.PI) / 6,
            cos = Math.cos(angle),
            sin = Math.sin(angle);
          const error = selected.reduce((n, [x, y], i) => {
            const dx = (x - c[0]) * flip,
              dy = y - c[1];
            return (
              n +
              (dx * cos - dy * sin - (ref[i][0] - rc[0])) ** 2 +
              (dx * sin + dy * cos - (ref[i][1] - rc[1])) ** 2
            );
          }, 0);
          if (!best || error < best.error - 1e-6) best = { error, flip, angle };
        }
    }
    if (best) {
      const { flip, angle } = best,
        cos = Math.cos(angle),
        sin = Math.sin(angle);
      return points.map(([x, y]): [number, number] => [
        x * flip * cos - y * sin,
        x * flip * sin + y * cos,
      ]);
    }
  } finally {
    query.delete();
  }
}

/** Score and save the same centred, quantized coordinates, including folded atoms. */
function savedCoordinates(
  fullPoints: [number, number][],
  original: number[],
  points: [number, number][],
  scale: number,
) {
  const expanded = fullPoints.map((p) => [...p] as [number, number]);
  original.forEach((a, i) => {
    expanded[a] = points[i];
  });
  const xs = expanded.map((p) => p[0]),
    ys = expanded.map((p) => p[1]),
    cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return expanded.map(([x, y]) => ({
    x: figureDimension(((x - cx) / 1.5) * scale),
    y: figureDimension((-(y - cy) / 1.5) * scale),
  }));
}

function nativeLabelCost(
  rd: Toolkit,
  mol: Mol,
  full: Mol,
  fullPoints: [number, number][],
  points: [number, number][],
  spec: StructureInput,
  style: FigureStyle,
) {
  const { original } = displayAtoms.get(mol)!;
  const saved = savedCoordinates(fullPoints, original, points, spec.scale ?? 1);
  const angle = ((spec.rot ?? 0) * Math.PI) / 180,
    fx = spec.flip === true || spec.flip === "h" ? -1 : 1,
    fy = spec.flip === "v" ? -1 : 1,
    placed = saved.map(({ x, y }): [number, number] => [
      1.5 * (x * fx * Math.cos(angle) + y * fy * Math.sin(angle)),
      1.5 * (x * fx * Math.sin(angle) - y * fy * Math.cos(angle)),
    ]),
    copy = withCoordinates(rd, full, placed),
    graph = graphOf(full),
    names = new Map(
      [...displayAtoms.get(mol)!.labels].map(([i, name]) => [
        original[i],
        name,
      ]),
    ),
    groups = abbreviatedGroups(rd, full, [...new Set(names.values())]).filter(
      (g) => names.has(g.atoms[0]),
    ),
    drawn = abbreviatedDrawing(
      rd,
      copy,
      new Set(groups.flatMap((g) => g.bonds)),
    ),
    atomLabels = Object.fromEntries(
      groups.map(({ atoms: [i], attachment: parent, name }) => {
        const left = placed[parent][0] - placed[i][0] > 0.2;
        return [
          i,
          abbreviationLabel(name, left, (graph.atoms[parent].z ?? 6) === 6),
        ];
      }),
    );
  for (const group of groups)
    for (const a of group.atoms.slice(1)) atomLabels[a] = "";
  try {
    const bond = parseFloat(style.values["--chemical-bond"]),
      svg = drawn.mol.get_svg_with_highlights(
        JSON.stringify({
          width: 800,
          height: 800,
          scalingFactor: bond / 1.5,
          fixedBondLength: bond / 1.5,
          fixedFontSize: parseFloat(style.values["--chemical-font"]),
          bondLineWidth: parseFloat(style.values["--chemical-line"]),
          scaleBondWidth: false,
          atoms: graph.atoms.map((_, i) => i),
          bonds: [],
          highlightRadius: 0.1,
          atomHighlightsAreCircles: true,
          fontFile: "BuiltinRobotoRegular",
          noFreetype: false,
          atomLabels,
          addChiralHs: true,
          additionalAtomLabelPadding: 0.066,
        }),
      ),
      boxes = new Map<number, FigureRect>(),
      glyphs = new Map<number, FigureRect[]>(),
      bonds: {
        contours: ReturnType<typeof pathContours>;
        atoms: number[];
        filled: boolean;
        width: number;
      }[] = [];
    const positions = new Map<number, { x: number; y: number }>();
    for (const match of svg.matchAll(/<ellipse\b[^>]*>/g)) {
      const atom = /class=['"]atom-(\d+)/.exec(match[0]);
      if (atom)
        positions.set(Number(atom[1]), {
          x: Number(/cx=['"]([^'"]+)/.exec(match[0])![1]),
          y: Number(/cy=['"]([^'"]+)/.exec(match[0])![1]),
        });
    }
    const rings: number[][] =
      JSON.parse(full.get_json()).molecules[0].extensions?.find(
        (extension: { name: string }) =>
          extension.name === "rdkitRepresentation",
      )?.atomRings ?? [];
    const hidden = new Set(groups.flatMap((group) => group.atoms.slice(1)));
    const visibleRings = rings.filter((ring) =>
      ring.every((atom) => !hidden.has(atom)),
    );
    for (const match of svg.matchAll(/<path\b[^>]*>/g)) {
      const cls = /class=['"]([^'"]*)/.exec(match[0])?.[1] ?? "",
        d = /\sd=['"]([^'"]*)/.exec(match[0])?.[1];
      if (!d) continue;
      const atom = /^atom-(\d+)$/.exec(cls);
      if (atom) {
        const i = Number(atom[1]),
          glyph = pathBox(d)!,
          b = unionBoxes([boxes.get(i) ?? null, glyph])!;
        boxes.set(i, rectangle(b.x, b.y, b.width, b.height));
        glyphs.set(i, [
          ...(glyphs.get(i) ?? []),
          rectangle(glyph.x, glyph.y, glyph.width, glyph.height),
        ]);
      } else if (cls.startsWith("bond-"))
        bonds.push({
          contours: pathContours(d),
          atoms: [...cls.matchAll(/atom-(\d+)/g)].map((m) => Number(m[1])),
          filled: !/fill:none/.test(match[0]),
          width: Number(/stroke-width:([\d.]+)/.exec(match[0])?.[1] ?? 0),
        });
    }
    // Keep the coarse terminal-label clearance (0.4 depiction units) when
    // measuring real ink, including adjacent unabridged atom labels.
    const clearance = (bond / 1.5) * 0.4;
    let score = 0,
      collisions = 0,
      maximumSpacingCost = 0;
    for (const [i, a] of boxes) {
      for (const [j, b] of boxes)
        if (j > i && (names.has(i) || names.has(j))) {
          if (
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.8 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.8
          )
            collisions++;
          maximumSpacingCost +=
            (Math.min(a.width, b.width) + clearance) *
            (Math.min(a.height, b.height) + clearance);
          score +=
            Math.max(
              0,
              Math.min(a.right, b.right) - Math.max(a.left, b.left) + clearance,
            ) *
            Math.max(
              0,
              Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) + clearance,
            );
        }
      // Crossing ink and occupying a ring take precedence over label spacing.
      const main = mainRowBox(glyphs.get(i)!);
      for (const b of bonds)
        if (
          inkIntersectsBox(
            b.contours,
            b.atoms.includes(i) ? main : a,
            b.width,
            b.filled,
          )
        )
          collisions++;
      const centre = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
      if (
        names.has(i) &&
        visibleRings.some(
          (ring) =>
            !ring.includes(i) &&
            insidePolygon(
              centre,
              ring.map((atom) => positions.get(atom)!),
            ),
        )
      )
        collisions++;
    }
    return collisions * (maximumSpacingCost + 1) + score;
  } finally {
    if (drawn.mol !== copy) drawn.mol.delete();
    copy.delete();
  }
}

/** Depict outward from the largest uncrowded anchor, preserving one core orientation. */
export function depictRoute(
  rd: Toolkit,
  compounds: Map<string, Structure | StructureInput>,
  input: FigureInput,
  variantName: (key: string) => string,
  style: FigureStyle,
) {
  const structures = new Map(
    [...compounds].filter(
      (pair): pair is [string, Structure] => "compound" in pair[1],
    ),
  );
  const links = new Map<string, string[]>(),
    add = (a: string, b?: string) => {
      if (!links.has(a)) links.set(a, []);
      if (b !== undefined) links.get(a)!.push(b);
    };
  const list = <T>(x: T | T[]) => (Array.isArray(x) ? x : [x]);
  const key = (x: string | number | { id: string | number }) =>
    String(typeof x === "object" ? x.id : x);
  for (const step of input.steps!) {
    const ins = list(step.from).map(key),
      outs = list(step.to).map(key);
    for (const o of outs) {
      add(ins[0], o);
      add(o, ins[0]);
    }
    for (const co of ins.slice(1)) {
      add(outs[0], co);
      add(co);
    }
  }
  const mols = new Map<string, Mol>(),
    fulls = new Map<string, Mol>(),
    expected = new Map<string, string>(),
    changed = new Set<string>();
  try {
    for (const [key, r] of structures) {
      const initial = openMolecule(rd, r.depiction.smiles);
      fulls.set(key, initial);
      const layout = r.variant
        ? r.compound.variants![r.variant]
        : r.compound.layout;
      const shown = contracted(
        rd,
        initial,
        layout.abbreviations,
        layout.abbreviationAtoms?.map((a) =>
          r.depiction.atoms.indexOf(r.compound.atomIds.indexOf(a)),
        ),
      );
      expected.set(key, graphSignature(rd, shown));
      const mol = free(rd, shown, r.spec.coordgen ?? input.coordgen ?? false);
      mols.set(key, mol);
    }
    if (input.anchor !== undefined && !structures.has(String(input.anchor)))
      throw new Error(`Unknown anchor ${input.anchor}`);
    const ranked = [...structures.keys()]
      .filter((k) => links.has(k))
      .sort(
        (a, b) => mols.get(b)!.get_num_atoms() - mols.get(a)!.get_num_atoms(),
      );
    const anchor =
      input.anchor === undefined
        ? (ranked.find((k) => !crowded(mols.get(k)!, 0.8)) ?? ranked[0])
        : String(input.anchor);
    const queue: [string, string | undefined][] = [
        ...(anchor ? [[anchor, undefined] as [string, undefined]] : []),
        ...[...links.keys()].map((k): [string, undefined] => [k, undefined]),
      ],
      done = new Set<string>();
    while (queue.length) {
      const [key, propagated] = queue.shift()!;
      if (done.has(key)) continue;
      const r = structures.get(key);
      let mol = mols.get(key);
      if (r && mol) {
        const refKey =
          typeof r.spec.align === "string" || typeof r.spec.align === "number"
            ? String(r.spec.align)
            : propagated;
        if (refKey !== undefined && !compounds.has(refKey))
          throw new Error(`Unknown alignment compound ${refKey}`);
        const reference =
          refKey && done.has(refKey) ? mols.get(refKey) : undefined;
        const coordgen = r.spec.coordgen ?? input.coordgen ?? false;
        if (reference && r.spec.align !== false) {
          const commonCore = common(rd, reference, mol, true);
          let aligned = false;
          if (
            commonCore.numAtoms >= 4 &&
            commonCore.numAtoms >=
              0.6 * Math.min(reference.get_num_atoms(), mol.get_num_atoms())
          ) {
            const core = alignCore(
              rd,
              mol,
              reference,
              commonCore.smarts,
              coordgen,
            );
            if (core) {
              mol.delete();
              mol = core;
              mols.set(key, mol);
              aligned = true;
            }
          }
          aligned = aligned && retainsStereo(rd, mol, expected.get(key)!);
          if (!aligned) {
            mol.delete();
            mol = free(
              rd,
              contracted(
                rd,
                fulls.get(key)!,
                (r.variant
                  ? r.compound.variants![r.variant]
                  : r.compound.layout
                ).abbreviations,
                (r.variant
                  ? r.compound.variants![r.variant]
                  : r.compound.layout
                ).abbreviationAtoms?.map((a) =>
                  r.depiction.atoms.indexOf(r.compound.atomIds.indexOf(a)),
                ),
              ),
              coordgen,
            );
            mols.set(key, mol);
            aligned =
              follow(rd, mol, reference, coordgen) &&
              retainsStereo(rd, mol, expected.get(key)!);
          }
          if (!aligned) {
            mol.delete();
            mol = free(
              rd,
              contracted(
                rd,
                fulls.get(key)!,
                (r.variant
                  ? r.compound.variants![r.variant]
                  : r.compound.layout
                ).abbreviations,
                (r.variant
                  ? r.compound.variants![r.variant]
                  : r.compound.layout
                ).abbreviationAtoms?.map((a) =>
                  r.depiction.atoms.indexOf(r.compound.atomIds.indexOf(a)),
                ),
              ),
              coordgen,
            );
            mols.set(key, mol);
            const coordinates = orient(rd, mol, reference);
            if (coordinates) {
              const rotated = withCoordinates(rd, mol, coordinates);
              mols.set(key, rotated);
              mol.delete();
            }
          }
        }
        let final = mols.get(key)!;
        final.normalize_depiction(0);
        const adopt = (coordinates: [number, number][] | undefined) => {
          if (!coordinates) return;
          const candidate = withCoordinates(rd, final, coordinates);
          if (!retainsStereo(rd, candidate, expected.get(key)!)) {
            candidate.delete();
            return;
          }
          mols.set(key, candidate);
          final.delete();
          final = candidate;
        };
        if (!(r.spec.arrows?.length && final.get_smiles().includes(".")))
          adopt(relaxedCoordinates(final));
        const fullPoints = expandedCoordinates(
          rd,
          final,
          fulls.get(key)!,
          coordgen,
        );
        adopt(
          relievedCoordinates(
            final,
            new Map(
              [...displayAtoms.get(final)!.labels].map(([i, name]) => [
                i,
                abbreviationLabel(name, false, true),
              ]),
            ),
            (points) =>
              nativeLabelCost(
                rd,
                final,
                fulls.get(key)!,
                fullPoints,
                points,
                r.spec,
                style,
              ),
          ),
        );
        // Propagated references include the author's final rot/flip, while the saved placement owns that transform.
        const coords = savedCoordinates(
          fullPoints,
          displayAtoms.get(final)!.original,
          xy(final),
          r.spec.scale ?? 1,
        );
        const layout = r.variant
          ? r.compound.variants![r.variant]
          : r.compound.layout;
        const variant = variantName(key);
        r.compound.variants ??= {};
        r.compound.variants[variant] = {
          ...structuredClone(layout),
          coords: Object.fromEntries(
            r.depiction.atoms.map((atom, i) => [
              r.compound.atomIds[atom],
              coords[i],
            ]),
          ),
        };
        delete r.compound.variants[variant].chargeAngles;
        // resolveStructure stages group/annotation settings before depiction.
        // Only the completed layout is a saved view of this source structure.
        if (r.variant && r.variant !== variant)
          delete r.compound.variants[r.variant];
        r.variant = variant;
        changed.add(r.compound.id);
        const angle = ((r.spec.rot ?? 0) * Math.PI) / 180,
          flipX = r.spec.flip === true || r.spec.flip === "h" ? -1 : 1,
          flipY = r.spec.flip === "v" ? -1 : 1;
        if (angle || flipX < 0 || flipY < 0) {
          const rotated = withCoordinates(
            rd,
            final,
            xy(final).map(([x, y]): [number, number] => [
              x * flipX * Math.cos(angle) - y * flipY * Math.sin(angle),
              x * flipX * Math.sin(angle) + y * flipY * Math.cos(angle),
            ]),
          );
          mols.set(key, rotated);
          final.delete();
        }
      }
      done.add(key);
      queue.unshift(
        ...(links.get(key) ?? [])
          .filter((n) => !done.has(n))
          .map((n): [string, string | undefined] => [
            n,
            structures.has(key) ? key : propagated,
          ]),
      );
    }
    return changed;
  } finally {
    for (const mol of mols.values()) mol.delete();
    for (const mol of fulls.values()) mol.delete();
  }
}
