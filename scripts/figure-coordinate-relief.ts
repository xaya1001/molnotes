import type { Mol } from "@rdkit/rdkit";
import { graphOf } from "../shared/chemical-library/chemistry.ts";

type Point = [number, number];
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pairKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

/** Preserve bonds and ring angles while separating piled nonbonded atoms. */
export function relaxedCoordinates(mol: Mol): Point[] | undefined {
  const graph = graphOf(mol),
    original = graph.conformers![0].coords,
    bonded = new Set(graph.bonds.map((b) => pairKey(...b.atoms)));
  if (
    !original.some((p, i) =>
      original.some(
        (q, j) => j > i && !bonded.has(pairKey(i, j)) && distance(p, q) < 0.55,
      ),
    )
  )
    return;
  const rings: number[][] =
    JSON.parse(mol.get_json()).molecules[0].extensions?.find(
      (e: { name: string }) => e.name === "rdkitRepresentation",
    )?.atomRings ?? [];
  const neighbors = original.map(() => [] as number[]);
  const springs: { a: number; b: number; length: number; weight: number }[] =
    graph.bonds.map(({ atoms: [a, b] }) => {
      neighbors[a].push(b);
      neighbors[b].push(a);
      return { a, b, length: 1.5, weight: 1 };
    });
  const near = new Set(bonded);
  for (const [center, ns] of neighbors.entries())
    for (let p = 0; p < ns.length; p++)
      for (let q = p + 1; q < ns.length; q++) {
        const a = ns[p],
          b = ns[q],
          sizes = rings
            .filter((r) => r.includes(center) && r.includes(a) && r.includes(b))
            .map((r) => r.length),
          size = sizes.length ? Math.min(...sizes) : 0;
        springs.push({
          a,
          b,
          length: size
            ? 3 * Math.sin((Math.PI * (size - 2)) / size / 2)
            : Math.max(distance(original[a], original[b]), 1.8),
          weight: size ? 0.5 : 0.12,
        });
        near.add(pairKey(a, b));
      }
  for (const r of rings) {
    const n = r.length,
      R = 1.5 / (2 * Math.sin(Math.PI / n));
    for (let p = 0; p < n; p++)
      for (let q = p + 2; q < n; q++)
        if (q - p !== n - 1) {
          springs.push({
            a: r[p],
            b: r[q],
            length: 2 * R * Math.sin((Math.PI * (q - p)) / n),
            weight: 0.25,
          });
          near.add(pairKey(r[p], r[q]));
        }
  }
  const pairs: [number, number][] = [];
  for (let i = 0; i < original.length; i++)
    for (let j = i + 1; j < original.length; j++)
      if (!near.has(pairKey(i, j))) pairs.push([i, j]);
  const points = original.map(([x, y], i): Point => [
    x + 0.02 * Math.sin(i * 17 + 1),
    y + 0.02 * Math.cos(i * 31 + 1),
  ]);
  for (let step = 0; step < 600; step++) {
    const gradient = points.map((): Point => [0, 0]);
    const add = (a: number, b: number, f: number) => {
      const dx = points[a][0] - points[b][0],
        dy = points[a][1] - points[b][1];
      gradient[a][0] += f * dx;
      gradient[a][1] += f * dy;
      gradient[b][0] -= f * dx;
      gradient[b][1] -= f * dy;
    };
    for (const s of springs) {
      const d = distance(points[s.a], points[s.b]) + 1e-9;
      add(s.a, s.b, (s.weight * (d - s.length)) / d);
    }
    for (const [a, b] of pairs) {
      const d = distance(points[a], points[b]) + 1e-9;
      if (d < 1.275) add(a, b, (0.8 * (d - 1.275)) / d);
    }
    points.forEach((p, i) => {
      p[0] -= 0.25 * gradient[i][0];
      p[1] -= 0.25 * gradient[i][1];
    });
  }
  return points;
}

/** Swing wide terminal labels away from other labels, atom centres and bonds. */
export function relievedCoordinates(
  mol: Mol,
  labels: Map<number, string>,
): Point[] | undefined {
  const graph = graphOf(mol),
    points = graph.conformers![0].coords.map((p) => [...p] as Point),
    neighbors = points.map(() => [] as number[]);
  graph.bonds.forEach(({ atoms: [a, b] }) => {
    neighbors[a].push(b);
    neighbors[b].push(a);
  });
  const symbols = mol
    .get_v3Kmolblock()
    .split("M  V30 BEGIN ATOM\n")[1]
    .split("M  V30 END ATOM")[0]
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[3]);
  const terms = new Map<number, { parent: number; length: number }>();
  for (const [i, atom] of graph.atoms.entries()) {
    const length = labels.has(i)
      ? labels.get(i)!.replace(/<[^>]+>/g, "").length
      : (atom.z ?? 6) === 6 && !atom.chg
        ? 0
        : symbols[i].length +
          (atom.impHs ? 1 : 0) +
          ((atom.impHs ?? 0) > 1 ? 1 : 0);
    if (neighbors[i].length === 1 && length >= 2)
      terms.set(i, { parent: neighbors[i][0], length });
  }
  if (!terms.size) return;
  const box = (i: number, p: Point) => {
    const t = terms.get(i)!,
      w = t.length * 0.62;
    return p[0] - points[t.parent][0] >= -0.2
      ? [p[0] - 0.4, p[1] - 0.5, p[0] - 0.4 + w, p[1] + 0.5]
      : [p[0] + 0.4 - w, p[1] - 0.5, p[0] + 0.4, p[1] + 0.5];
  };
  const cost = (i: number, p: Point) => {
    const [x0, y0, x1, y1] = box(i, p),
      parent = terms.get(i)!.parent;
    let score = 0;
    for (const j of terms.keys())
      if (j !== i) {
        const [u0, v0, u1, v1] = box(j, points[j]);
        score +=
          3 *
          Math.max(0, Math.min(x1, u1) - Math.max(x0, u0)) *
          Math.max(0, Math.min(y1, v1) - Math.max(y0, v0));
      }
    points.forEach(([x, y], j) => {
      if (
        j !== i &&
        j !== parent &&
        x0 - 0.45 < x &&
        x < x1 + 0.45 &&
        y0 - 0.45 < y &&
        y < y1 + 0.45
      )
        score++;
    });
    for (const {
      atoms: [a, b],
    } of graph.bonds)
      if (a !== i && b !== i) {
        const x = (points[a][0] + points[b][0]) / 2,
          y = (points[a][1] + points[b][1]) / 2;
        if (x0 < x && x < x1 && y0 < y && y < y1) score += 0.6;
      }
    return score;
  };
  let changed = false;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const i of [...terms.keys()].sort(
      (a, b) => cost(b, points[b]) - cost(a, points[a]),
    )) {
      const base = cost(i, points[i]);
      if (base < 0.3) continue;
      const q = points[terms.get(i)!.parent],
        vx = points[i][0] - q[0],
        vy = points[i][1] - q[1];
      let best = base,
        chosen: Point | undefined;
      for (const deg of [20, -20, 40, -40, 60, -60, 80, -80]) {
        const a = (deg * Math.PI) / 180,
          p: Point = [
            q[0] + vx * Math.cos(a) - vy * Math.sin(a),
            q[1] + vx * Math.sin(a) + vy * Math.cos(a),
          ],
          score = cost(i, p) + Math.abs(deg) * 0.004;
        if (score < best - 0.05) {
          best = score;
          chosen = p;
        }
      }
      if (chosen) {
        points[i] = chosen;
        moved = true;
        changed = true;
      }
    }
    if (!moved) break;
  }
  return changed ? points : undefined;
}
