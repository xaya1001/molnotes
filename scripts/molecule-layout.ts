// 2D layout of structures for drawing. RDKit's own depiction stacks atoms or
// lays bonds through atoms on bridged and caged skeletons; these helpers find
// such drawings and produce coordinates that draw cleanly, written as a
// CXSMILES coordinate block so the SMILES text and its atom order stay as
// authored.

import type { MainModule, Mol } from "@rdkit/rdkit";

const BOND = 1.5; // RDKit's depiction bond length

type Point = number[];
/** The parts of RDKit's JSON for one molecule that the layout reads. */
interface MolJson {
  atoms: { z?: number; chg?: number; impHs?: number; stereo?: string }[];
  bonds: { atoms: [number, number]; bo?: number }[];
  conformers?: { coords: Point[] }[];
}
/** A molecule as the layout sees it: atoms, bonds, neighbours and drawn coordinates. */
interface Graph {
  atoms: { element: number; charge: number; chiralH: boolean }[];
  bonds: [number, number][];
  order: number[];
  neighbours: number[][];
  fragment: number[];
  points: Point[];
  hydrogens?: Map<number, Point>;
}
type Problems = Record<
  "overlap" | "onBond" | "straight" | "hydrogen" | "branch" | "touching",
  number
>;
const molJson = (mol: Mol): MolJson => JSON.parse(mol.get_json()).molecules[0];

/** The SMILES text and its CXSMILES extension, without any coordinate block. */
function splitCx(smiles: string) {
  const match = /^(\S+)(?:\s+\|(.*)\|)?\s*$/.exec(smiles.trim());
  if (!match) throw new Error("无法解析 SMILES");
  const rest = (match[2] ?? "").replace(/^\([^)]*\),?/, "").replace(/,$/, "");
  return { base: match[1], rest };
}

/** SMILES text with the given heavy-atom coordinates, other CX fields kept. */
export function withCoordinates(smiles: string, points: Point[]) {
  const { base, rest } = splitCx(smiles);
  const block = points
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)},`)
    .join(";");
  return `${base} |(${block})${rest ? `,${rest}` : ""}|`;
}

/** RDKit's JSON for a molecule, with 2D coordinates (computed when it has none). */
function described(mol: Mol, coordgen = false) {
  let json = molJson(mol);
  if (!json.conformers) {
    mol.set_new_coords(coordgen);
    json = molJson(mol);
  }
  return json;
}
// Only called on molecules that have coordinates.
const coordinatesOf = (json: MolJson): Point[] =>
  json.conformers![0].coords.map(([x, y]) => [x, y]);

/** Bonds that lie on a ring: every bond that is not a bridge of the graph. */
function ringBonds(count: number, pairs: [number, number][]) {
  const adjacent = Array.from({ length: count }, (): number[][] => []);
  pairs.forEach(([a, b], k) => {
    adjacent[a].push([b, k]);
    adjacent[b].push([a, k]);
  });
  const order = new Array(count).fill(-1);
  const low = new Array(count).fill(0);
  const ring = new Array(pairs.length).fill(true);
  let time = 0;
  function visit(atom: number, via: number) {
    order[atom] = low[atom] = time++;
    for (const [next, bond] of adjacent[atom]) {
      if (bond === via) continue;
      if (order[next] < 0) {
        visit(next, bond);
        low[atom] = Math.min(low[atom], low[next]);
        if (low[next] > order[atom]) ring[bond] = false;
      } else low[atom] = Math.min(low[atom], order[next]);
    }
  }
  for (let atom = 0; atom < count; atom++) if (order[atom] < 0) visit(atom, -1);
  return ring;
}

/**
 * The layout RDKit draws for a SMILES without coordinates: it adds the H atoms
 * of the stereocentres it marks with one, then lays out the molecule with
 * them. Returns heavy-atom coordinates and each such centre's H position.
 */
function drawnLayout(toolkit: MainModule, base: string, centres: Set<number>) {
  // The graph parsed the same SMILES, so RDKit accepts it.
  const mol = toolkit.get_mol(base)!;
  try {
    const heavy = mol.get_num_atoms();
    mol.add_hs_in_place();
    const lines = mol.get_v2Kmolblock().split("\n");
    const atomCount = Number(lines[3].slice(0, 3));
    const bondCount = Number(lines[3].slice(3, 6));
    const atomLines = lines.slice(4, 4 + atomCount);
    const bondLines = lines.slice(4 + atomCount, 4 + atomCount + bondCount);
    const ends = (line: string) => [
      Number(line.slice(0, 3)) - 1,
      Number(line.slice(3, 6)) - 1,
    ];
    const owner = new Map<number, number>();
    for (const line of bondLines) {
      const [a, b] = ends(line);
      if (a >= heavy && centres.has(b)) owner.set(a, b);
      if (b >= heavy && centres.has(a)) owner.set(b, a);
    }
    const kept = [...atomLines.keys()].filter((i) => i < heavy || owner.has(i));
    const index = new Map(kept.map((atom, i) => [atom, i]));
    const bonds = bondLines
      .filter((line) => ends(line).every((atom) => index.has(atom)))
      .map((line) => {
        const [a, b] = ends(line);
        return `${String(index.get(a)! + 1).padStart(3)}${String(index.get(b)! + 1).padStart(3)}${line.slice(6)}`;
      });
    const block = [
      ...lines.slice(0, 3),
      `${String(kept.length).padStart(3)}${String(bonds.length).padStart(3)}${lines[3].slice(6)}`,
      ...kept.map((i) => atomLines[i]),
      ...bonds,
      ...lines.slice(4 + atomCount + bondCount),
    ].join("\n");
    const withH = toolkit.get_mol(block, JSON.stringify({ removeHs: false }))!;
    try {
      withH.set_new_coords(false);
      const points = coordinatesOf(molJson(withH));
      const hydrogens = new Map(
        kept
          .slice(heavy)
          .map((atom, i): [number, Point] => [
            owner.get(atom)!,
            points[heavy + i],
          ]),
      );
      return { points: points.slice(0, heavy), hydrogens };
    } finally {
      withH.delete();
    }
  } finally {
    mol.delete();
  }
}

/**
 * Atoms, bonds and drawn coordinates (the SMILES' own, or RDKit's layout),
 * and the stereocentres RDKit draws with an explicit H: those with one H
 * whose three bonds all lie on rings.
 */
function graph(toolkit: MainModule, smiles: string): Graph {
  const mol = toolkit.get_mol(smiles);
  if (!mol) throw new Error("无法解析 SMILES");
  let json;
  try {
    json = molJson(mol);
  } finally {
    mol.delete();
  }
  const pairs = json.bonds.map((bond) => bond.atoms);
  const order = json.bonds.map((bond) => bond.bo ?? 1);
  const ring = ringBonds(json.atoms.length, pairs);
  const neighbours = json.atoms.map((): number[] => []);
  const ringDegree = json.atoms.map(() => 0);
  pairs.forEach(([a, b], k) => {
    neighbours[a].push(b);
    neighbours[b].push(a);
    if (ring[k]) (ringDegree[a]++, ringDegree[b]++);
  });
  const atoms = json.atoms.map((atom, i) => ({
    element: atom.z ?? 6,
    charge: atom.chg ?? 0,
    chiralH:
      (atom.impHs ?? 0) === 1 &&
      (atom.stereo ?? "unspecified") !== "unspecified" &&
      ringDegree[i] === 3,
  }));
  const fragment = json.atoms.map(() => -1);
  for (let start = 0; start < fragment.length; start++) {
    if (fragment[start] >= 0) continue;
    const stack = [start];
    fragment[start] = start;
    while (stack.length)
      for (const next of neighbours[stack.pop()!])
        if (fragment[next] < 0) ((fragment[next] = start), stack.push(next));
  }
  const g = { atoms, bonds: pairs, order, neighbours, fragment };
  if (json.conformers) return { ...g, points: coordinatesOf(json) };
  const centres = new Set(
    atoms.flatMap((atom, i) => (atom.chiralH ? [i] : [])),
  );
  const { points, hydrogens } = drawnLayout(
    toolkit,
    splitCx(smiles).base,
    centres,
  );
  return { ...g, points, hydrogens };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}
const distance = (p: Point, q: Point) => Math.hypot(p[0] - q[0], p[1] - q[1]);
function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function crosses(p: Point, q: Point, r: Point, s: Point) {
  const side = (a: Point, b: Point, c: Point) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return side(p, q, r) * side(p, q, s) < 0 && side(r, s, p) * side(r, s, q) < 0;
}
/** How close two segments come; zero when they cross. */
function segmentsDistance(p: Point, q: Point, r: Point, t: Point) {
  if (crosses(p, q, r, t)) return 0;
  return Math.min(
    segmentDistance(p, r, t),
    segmentDistance(q, r, t),
    segmentDistance(r, p, q),
    segmentDistance(t, p, q),
  );
}
function cosine(centre: Point, a: Point, b: Point) {
  const u = [a[0] - centre[0], a[1] - centre[1]];
  const v = [b[0] - centre[0], b[1] - centre[1]];
  return (u[0] * v[0] + u[1] * v[1]) / Math.hypot(...u) / Math.hypot(...v);
}

/**
 * Where RDKit puts a stereocentre's H: across the widest gap between its
 * bonds, one bond length out. Null when two gaps are nearly equal, as at a
 * regular ring fusion, since RDKit's choice between them is not predictable.
 */
function hydrogen(
  points: Point[],
  neighbours: number[][],
  centre: number,
  length: number,
): Point | null {
  const at = points[centre];
  const angles = neighbours[centre]
    .map((n) => Math.atan2(points[n][1] - at[1], points[n][0] - at[0]))
    .sort((a, b) => a - b);
  const gaps = angles
    .map((angle, i) => {
      let gap = angles[(i + 1) % angles.length] - angle;
      if (gap <= 0) gap += 2 * Math.PI;
      return [gap, angle + gap / 2];
    })
    .sort((a, b) => b[0] - a[0]);
  if (gaps[0][0] - gaps[1][0] < 0.1) return null;
  const middle = gaps[0][1];
  return [at[0] + length * Math.cos(middle), at[1] + length * Math.sin(middle)];
}

/** A carbon drawn between two bonds in a straight line, which RDKit labels "C". */
function straight(g: Graph, points: Point[], i: number) {
  const n = g.neighbours[i];
  if (g.atoms[i].element !== 6 || g.atoms[i].charge || n.length !== 2)
    return false;
  const orders = g.bonds
    .map((bond, k) => (bond.includes(i) ? g.order[k] : 0))
    .filter(Boolean);
  if (orders.includes(3) || orders.filter((o) => o === 2).length === 2)
    return false;
  return cosine(points[i], points[n[0]], points[n[1]]) < -0.966;
}

/** Problems a reader would see in the drawing of these coordinates. */
function problemsAt(
  g: Graph,
  points: Point[],
  hydrogens?: Map<number, Point>,
): Problems {
  const found: Problems = {
    overlap: 0,
    onBond: 0,
    straight: 0,
    hydrogen: 0,
    branch: 0,
    touching: 0,
  };
  if (!g.bonds.length) return found;
  const length = median(
    g.bonds.map(([a, b]) => distance(points[a], points[b])),
  );
  const bonded = new Set(
    g.bonds.flatMap(([a, b]) => [`${a},${b}`, `${b},${a}`]),
  );
  // The drawing sets separate molecules apart, so only parts of one molecule can collide.
  const together = (a: number, b: number) => g.fragment[a] === g.fragment[b];
  const n = g.atoms.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (
        together(i, j) &&
        !bonded.has(`${i},${j}`) &&
        distance(points[i], points[j]) < 0.4 * length
      )
        found.overlap++;
  for (let i = 0; i < n; i++)
    for (const [a, b] of g.bonds)
      if (
        a !== i &&
        b !== i &&
        together(i, a) &&
        segmentDistance(points[i], points[a], points[b]) < 0.2 * length
      )
        found.onBond++;
  for (let i = 0; i < n; i++) if (straight(g, points, i)) found.straight++;
  // A bridge drawn across a ring is the usual picture; a substituent across
  // a bond, or two bonds running along each other, is not.
  for (const [k, [a, b]] of g.bonds.entries())
    for (const [c, d] of g.bonds.slice(k + 1)) {
      if (a === c || a === d || b === c || b === d || !together(a, c)) continue;
      if (
        [a, b, c, d].some((x) => g.neighbours[x].length === 1) &&
        crosses(points[a], points[b], points[c], points[d])
      )
        found.branch++;
      else if (
        !crosses(points[a], points[b], points[c], points[d]) &&
        segmentsDistance(points[a], points[b], points[c], points[d]) <
          0.2 * length
      )
        found.touching++;
    }
  const hs: Point[] = [];
  for (let c = 0; c < n; c++) {
    if (!g.atoms[c].chiralH || g.neighbours[c].length !== 3) continue;
    const h = hydrogens
      ? hydrogens.get(c)
      : hydrogen(points, g.neighbours, c, length);
    if (!h) continue;
    const hit =
      points.some(
        (p, i) => i !== c && together(i, c) && distance(h, p) < 0.45 * length,
      ) ||
      g.bonds.some(
        ([a, b]) =>
          a !== c &&
          b !== c &&
          together(a, c) &&
          (segmentDistance(h, points[a], points[b]) < 0.25 * length ||
            segmentsDistance(points[c], h, points[a], points[b]) <
              0.15 * length),
      ) ||
      hs.some((other) => distance(h, other) < 0.5 * length);
    if (hit) found.hydrogen++;
    hs.push(h);
  }
  return found;
}

function describe(found: Problems) {
  return [
    found.overlap && `${found.overlap} 处原子重叠`,
    found.onBond && `${found.onBond} 个原子压在键上`,
    found.straight && `${found.straight} 个碳排成直线会显示成“C”`,
    found.branch && `${found.branch} 处取代基与键交叉`,
    found.touching && `${found.touching} 处两根键贴在一起`,
    found.hydrogen && `${found.hydrogen} 个手性中心的 H 压在别的原子或键上`,
  ].filter((problem) => typeof problem === "string");
}

/** What is wrong with the drawing of this SMILES, in its own or RDKit's coordinates. */
export function layoutProblems(toolkit: MainModule, smiles: string) {
  const g = graph(toolkit, smiles);
  return describe(problemsAt(g, g.points, g.hydrogens));
}

/**
 * Coordinates that keep bonds near one length, keep atoms, labels and the
 * stereocentres' H apart and stay close to the starting layout.
 */
function polish(
  g: Graph,
  start: Point[],
  iterations: number,
  random: () => number,
) {
  if (!g.bonds.length) return start;
  const n = g.atoms.length;
  const scale =
    BOND / median(g.bonds.map(([a, b]) => distance(start[a], start[b])));
  const origin = start.map(([x, y]) => [x * scale, y * scale]);
  const points = origin.map((p) => [...p]);
  const bonded = new Set(g.bonds.flatMap(([a, b]) => [a * n + b, b * n + a]));
  const centres = g.atoms
    .map((atom, i) => (atom.chiralH && g.neighbours[i].length === 3 ? i : -1))
    .filter((i) => i >= 0);
  const L = BOND;

  // Every term that involves atom i, so a move of i changes the energy by
  // exactly the change in this sum.
  function local(i: number) {
    let e = 0;
    const p = points[i];
    e +=
      (0.5 * ((p[0] - origin[i][0]) ** 2 + (p[1] - origin[i][1]) ** 2)) /
      L ** 2;
    for (const j of g.neighbours[i])
      e += 20 * (distance(p, points[j]) / L - 1) ** 2;
    for (let j = 0; j < n; j++) {
      if (j === i || bonded.has(i * n + j)) continue;
      const d = distance(p, points[j]) / L;
      if (d < 0.95) e += 60 * (0.95 - d) ** 2;
    }
    for (const [a, b] of g.bonds) {
      if (a === i || b === i) {
        for (let j = 0; j < n; j++) {
          if (j === a || j === b) continue;
          const d = segmentDistance(points[j], points[a], points[b]) / L;
          if (d < 0.5) e += 80 * (0.5 - d) ** 2;
        }
        for (const [c, d] of g.bonds)
          if (
            c !== a &&
            c !== b &&
            d !== a &&
            d !== b &&
            crosses(points[a], points[b], points[c], points[d])
          )
            e += [a, b, c, d].some((x) => g.neighbours[x].length === 1)
              ? 20
              : 3;
      } else {
        const d = segmentDistance(p, points[a], points[b]) / L;
        if (d < 0.5) e += 80 * (0.5 - d) ** 2;
      }
    }
    for (const c of [i, ...g.neighbours[i]]) {
      const ns = g.neighbours[c];
      if (ns.length === 2 && straight(g, points, c)) e += 10;
      if (ns.length === 2 || ns.length === 3)
        for (let x = 0; x < ns.length; x++)
          for (let y = x + 1; y < ns.length; y++)
            e +=
              (ns.length === 2 ? 1 : 0.3) *
              (cosine(points[c], points[ns[x]], points[ns[y]]) + 0.5) ** 2;
    }
    const hs = centres.map((c) => hydrogen(points, g.neighbours, c, L));
    for (const [k, c] of centres.entries()) {
      const moved = c === i || g.neighbours[c].includes(i);
      const h = hs[k];
      if (!h) {
        if (moved) e += 2;
        continue;
      }
      for (let j = 0; j < n; j++) {
        if (j === c || (!moved && j !== i)) continue;
        const d = distance(h, points[j]) / L;
        if (d < 0.8) e += 30 * (0.8 - d) ** 2;
      }
      for (const [a, b] of g.bonds) {
        if (a === c || b === c || (!moved && a !== i && b !== i)) continue;
        const d = segmentDistance(h, points[a], points[b]) / L;
        if (d < 0.45) e += 40 * (0.45 - d) ** 2;
        if (crosses(points[c], h, points[a], points[b])) e += 20;
      }
      if (moved)
        for (const [m, other] of hs.entries())
          if (m !== k && other) {
            const d = distance(h, other) / L;
            if (d < 0.8) e += 30 * (0.8 - d) ** 2;
          }
    }
    return e;
  }

  let temperature = 0.3;
  for (let step = 0; step < iterations; step++) {
    const i = Math.floor(random() * n);
    const size = (0.15 * (1 - step / iterations) + 0.02) * L;
    const before = local(i);
    const old = points[i];
    points[i] = [
      old[0] + (random() - 0.5) * size,
      old[1] + (random() - 0.5) * size,
    ];
    const delta = local(i) - before;
    if (delta > 0 && random() >= Math.exp(-delta / temperature))
      points[i] = old;
    temperature *= 0.9999;
  }
  return points;
}

/** Heavy-atom coordinates of `source` moved onto the atom order of `smiles`. */
function mapped(toolkit: MainModule, smiles: string, source: string) {
  // Callers pass a SMILES that already parsed.
  const mol = toolkit.get_mol(smiles)!;
  const query = toolkit.get_mol(source, JSON.stringify({ removeHs: true }));
  try {
    if (!query || query.get_num_atoms() !== mol.get_num_atoms()) return null;
    const match = JSON.parse(mol.get_substruct_match(query) || "{}").atoms;
    if (!match) return null;
    const points = coordinatesOf(described(query));
    const out: Point[] = [];
    match.forEach((target: number, k: number) => (out[target] = points[k]));
    return out;
  } finally {
    mol.delete();
    query?.delete();
  }
}

/** Coordinates aligned on a template's matching atoms, the rest placed by RDKit. */
function aligned(toolkit: MainModule, smiles: string, template: string) {
  const mol = toolkit.get_mol(splitCx(smiles).base)!;
  const reference = toolkit.get_mol(template);
  try {
    if (!reference) throw new Error("无法解析模板");
    const result = mol.generate_aligned_coords(
      reference,
      JSON.stringify({ acceptFailure: false }),
    );
    if (!result) return null;
    return coordinatesOf(molJson(mol));
  } finally {
    mol.delete();
    reference?.delete();
  }
}

function coordgen(toolkit: MainModule, smiles: string) {
  const mol = toolkit.get_mol(splitCx(smiles).base)!;
  try {
    return coordinatesOf(described(mol, true));
  } finally {
    mol.delete();
  }
}

/** A seeded generator, so a layout is reproducible. */
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

function crossingCount(g: Graph, points: Point[]) {
  let count = 0;
  for (let i = 0; i < g.bonds.length; i++)
    for (let j = i + 1; j < g.bonds.length; j++) {
      const [a, b] = g.bonds[i];
      const [c, d] = g.bonds[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (crosses(points[a], points[b], points[c], points[d])) count++;
    }
  return count;
}

/**
 * Candidate layouts for a SMILES, each polished and judged, best first.
 * `starts` maps a candidate name to heavy-atom coordinates in the SMILES' atom
 * order (or null when that source has none); RDKit's and CoordGen's layouts
 * are always tried, and a `template` CXSMILES adds a layout aligned on it.
 */
export function layoutCandidates(
  toolkit: MainModule,
  smiles: string,
  {
    starts = {},
    template,
    iterations,
  }: {
    starts?: Record<string, Point[] | null>;
    template?: string;
    iterations?: number;
  } = {},
) {
  const g = graph(toolkit, splitCx(smiles).base);
  const all: Record<string, Point[] | null> = {
    rdkit: g.points,
    coordgen: coordgen(toolkit, smiles),
    ...(template ? { template: aligned(toolkit, smiles, template) } : {}),
    ...starts,
  };
  const steps =
    iterations ?? Math.max(20000, Math.min(80000, 400 * g.atoms.length));
  const candidates: {
    name: string;
    smiles: string;
    problems: string[];
    crossings: number;
    faults: number;
  }[] = [];
  for (const [name, start] of Object.entries(all)) {
    if (!start) continue;
    const points = polish(
      g,
      start,
      steps,
      generator(g.atoms.length * 7919 + name.length),
    );
    const found = problemsAt(g, points);
    const crossings = crossingCount(g, points);
    candidates.push({
      name,
      smiles: withCoordinates(smiles, points),
      problems: describe(found),
      crossings,
      faults: Object.values(found).reduce((a, b) => a + b, 0),
    });
  }
  // A layout someone chose or a published drawing reads as the familiar
  // picture, so on a tie it wins over a computed one.
  const rank = ["template", ...Object.keys(starts), "coordgen", "rdkit"];
  return candidates.sort(
    (a, b) =>
      a.faults - b.faults ||
      a.crossings - b.crossings ||
      rank.indexOf(a.name) - rank.indexOf(b.name),
  );
}

/** Heavy-atom coordinates from a 2D molblock (for example PubChem's), in the SMILES' atom order. */
export function coordinatesFrom(
  toolkit: MainModule,
  smiles: string,
  molblock: string,
) {
  return mapped(toolkit, splitCx(smiles).base, molblock);
}
