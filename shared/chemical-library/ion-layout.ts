import type { ChemicalGraph } from "./chemistry.ts";
import type { Point } from "./types.ts";

export const ionPairDistance = 1.5;

export function counterionGroups(
  graph: ChemicalGraph,
  pinned: ReadonlySet<number>,
) {
  const neighbours = graph.atoms.map((): number[] => []);
  for (const {
    atoms: [a, b],
  } of graph.bonds) {
    neighbours[a].push(b);
    neighbours[b].push(a);
  }
  const visited = new Set<number>();
  const fragments: { atoms: number[]; charge: number }[] = [];
  for (const start of graph.atoms.keys()) {
    if (visited.has(start)) continue;
    const atoms: number[] = [],
      pending = [start];
    visited.add(start);
    while (pending.length) {
      const i = pending.pop()!;
      atoms.push(i);
      for (const j of neighbours[i]) {
        if (visited.has(j)) continue;
        visited.add(j);
        pending.push(j);
      }
    }
    fragments.push({
      atoms,
      charge: atoms.reduce((n, i) => n + (graph.atoms[i].chg ?? 0), 0),
    });
  }
  const charged = fragments
    .filter((f) => f.charge)
    .sort((a, b) => b.atoms.length - a.atoms.length);
  const parent = charged[0];
  // A charged mixture can contain a reactive ion as well as a counterion.
  // Its saved separation carries meaning; only pack charge-balanced salts.
  if (!parent || charged.reduce((sum, f) => sum + f.charge, 0) !== 0) return [];
  return charged.slice(1).flatMap((counterion) => {
    if (
      counterion.charge * parent.charge >= 0 ||
      counterion.atoms.some((i) => pinned.has(i))
    )
      return [];
    return [
      {
        atoms: counterion.atoms,
        pivot: counterion.atoms.find(
          (i) => (graph.atoms[i].chg ?? 0) * counterion.charge > 0,
        )!,
        centres: parent.atoms.filter(
          (i) => (graph.atoms[i].chg ?? 0) * counterion.charge < 0,
        ),
      },
    ];
  });
}

/** Move disconnected counterions as rigid fragments; bonded geometry stays saved. */
export function ionPairCoordinates(
  graph: ChemicalGraph,
  points: Point[],
  pinned: Set<number>,
) {
  const counterions = counterionGroups(graph, pinned);
  if (!counterions.length) return points;
  const result = points.map((p) => ({ ...p }));
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const segmentDistance = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
    );
    return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
  };
  for (const { atoms, pivot, centres } of counterions) {
    const moving = new Set(atoms);
    const fixed = [...graph.atoms.keys()].filter((i) => !moving.has(i));
    const fixedBonds = graph.bonds.filter(({ atoms: [i] }) => !moving.has(i));
    const movingBonds = graph.bonds.filter(({ atoms: [i] }) => moving.has(i));
    const origin = points[pivot];
    let best: Map<number, Point> | undefined,
      clearance = -Infinity;
    // Try the saved orientation first, then turn multi-atom ions about their charge.
    const orientations = atoms.length === 1 ? 1 : 12;
    for (let turn = 0; turn < orientations; turn++) {
      const rotation = (turn * 2 * Math.PI) / orientations;
      const cos = Math.cos(rotation),
        sin = Math.sin(rotation);
      const offsets = atoms.map((i) => {
        const x = points[i].x - origin.x,
          y = points[i].y - origin.y;
        return { x: x * cos - y * sin, y: x * sin + y * cos };
      });
      for (const centre of centres) {
        const anchor = result[centre];
        const angle = Math.atan2(origin.y - anchor.y, origin.x - anchor.x);
        for (let k = 0; k < 24; k++) {
          const a = angle + (k * Math.PI) / 12;
          const x = anchor.x + ionPairDistance * Math.cos(a),
            y = anchor.y + ionPairDistance * Math.sin(a);
          const candidate = new Map(
            atoms.map((i, j) => [
              i,
              { x: x + offsets[j].x, y: y + offsets[j].y },
            ]),
          );
          let score = Infinity;
          for (const p of candidate.values()) {
            for (const j of fixed)
              score = Math.min(score, distance(p, result[j]));
            for (const {
              atoms: [u, v],
            } of fixedBonds)
              score = Math.min(score, segmentDistance(p, result[u], result[v]));
          }
          for (const {
            atoms: [u, v],
          } of movingBonds)
            for (const j of fixed)
              score = Math.min(
                score,
                segmentDistance(
                  result[j],
                  candidate.get(u)!,
                  candidate.get(v)!,
                ),
              );
          if (score > clearance + 1e-8) {
            clearance = score;
            best = candidate;
          }
        }
      }
    }
    if (best) for (const [i, point] of best) result[i] = point;
  }
  return result;
}
