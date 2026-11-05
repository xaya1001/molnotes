import type { ChemicalGraph } from "./chemistry.ts";
import type { Point } from "./types.ts";

/** Move disconnected counterions as rigid fragments; bonded geometry stays saved. */
export function ionPairCoordinates(
  graph: ChemicalGraph,
  points: Point[],
  pinned: Set<number>,
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
  if (!parent || charged.reduce((sum, f) => sum + f.charge, 0) !== 0)
    return points;
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
  for (const counterion of charged.slice(1)) {
    if (
      counterion.charge * parent.charge >= 0 ||
      counterion.atoms.some((i) => pinned.has(i))
    )
      continue;
    const moving = new Set(counterion.atoms);
    const fixed = [...graph.atoms.keys()].filter((i) => !moving.has(i));
    const pivot = counterion.atoms.find(
      (i) => (graph.atoms[i].chg ?? 0) * counterion.charge > 0,
    )!;
    let best: Point | undefined,
      clearance = -Infinity;
    for (const centre of parent.atoms.filter(
      (i) => (graph.atoms[i].chg ?? 0) * counterion.charge < 0,
    )) {
      const angle = Math.atan2(
        points[pivot].y - result[centre].y,
        points[pivot].x - result[centre].x,
      );
      for (let k = 0; k < 24; k++) {
        const a = angle + (k * Math.PI) / 12;
        const shift = {
          x: result[centre].x + 1.5 * Math.cos(a) - points[pivot].x,
          y: result[centre].y + 1.5 * Math.sin(a) - points[pivot].y,
        };
        let score = Infinity;
        for (const i of counterion.atoms) {
          const p = { x: points[i].x + shift.x, y: points[i].y + shift.y };
          for (const j of fixed)
            score = Math.min(score, distance(p, result[j]));
          for (const {
            atoms: [u, v],
          } of graph.bonds) {
            if (moving.has(u)) continue;
            score = Math.min(score, segmentDistance(p, result[u], result[v]));
          }
        }
        if (score > clearance + 1e-8) {
          clearance = score;
          best = shift;
        }
      }
    }
    if (best)
      for (const i of counterion.atoms)
        result[i] = { x: points[i].x + best.x, y: points[i].y + best.y };
  }
  return result;
}
