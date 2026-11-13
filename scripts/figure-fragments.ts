import type { ChemicalGraph } from "../shared/chemical-library/chemistry.ts";
import type { Point } from "../shared/chemical-library/types.ts";
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const norm = (a: Point) => Math.hypot(a.x, a.y);
const dist = (a: Point, b: Point) => norm(sub(a, b));
const mean = (ids: number[], pos: Point[]) =>
  mul(
    ids.reduce((p, i) => add(p, pos[i]), { x: 0, y: 0 }),
    1 / ids.length,
  );
const turn = (p: Point, a: number) => ({
  x: p.x * Math.cos(a) - p.y * Math.sin(a),
  y: p.x * Math.sin(a) + p.y * Math.cos(a),
});

/** Port of arrows.place_fragments; coordinates use one bond as their unit, y upward. */
export function placeArrowFragments(
  graph: ChemicalGraph,
  input: Point[],
  links: [number, number][],
) {
  const pos = input.map((p) => ({ ...p }));
  const nb = (i: number) =>
    graph.bonds
      .filter((b) => b.atoms.includes(i))
      .map((b) => b.atoms.find((j) => j !== i)!);
  const component = (start: number, cut?: [number, number]) => {
    const found = new Set([start]),
      queue = [start];
    while (queue.length) {
      const i = queue.shift()!;
      for (const j of nb(i)) {
        if (found.has(j) || (cut && cut.includes(i) && cut.includes(j)))
          continue;
        found.add(j);
        queue.push(j);
      }
    }
    return [...found];
  };
  const frags: number[][] = [],
    of: number[] = [];
  for (let i = 0; i < pos.length; i++)
    if (of[i] === undefined) {
      const frag = component(i);
      for (const j of frag) of[j] = frags.length;
      frags.push(frag);
    }
  if (frags.length < 2) return input;
  const contacts = links
    .filter(([a, b]) => of[a] !== of[b])
    .map(([a, b]): [number, number] => (of[a] < of[b] ? [a, b] : [b, a]));
  const shortest = (a: number, b: number) => {
    const queue = [[a]],
      seen = new Set([a]);
    while (queue.length) {
      const path = queue.shift()!,
        i = path.at(-1)!;
      if (i === b) return path;
      for (const j of nb(i))
        if (!seen.has(j)) {
          seen.add(j);
          queue.push([...path, j]);
        }
    }
    return [];
  };
  // arrows._fold_together: fold the chain, then put its reacting edge level.
  for (let i = 0; i < contacts.length; i++)
    for (let j = i + 1; j < contacts.length; j++) {
      const [p1, q1] = contacts[i],
        [p2, q2] = contacts[j];
      for (const [a, b, x, y] of [
        [p1, p2, q1, q2],
        [q1, q2, p1, p2],
      ]) {
        if (
          a === b ||
          x === y ||
          of[a] !== of[b] ||
          of[x] !== of[y] ||
          of[x] === of[a]
        )
          continue;
        const path = shortest(a, b);
        if (path.length < 4) continue;
        let best: Point[] | undefined;
        for (let k = 1; k < path.length - 2; k++) {
          const u = path[k],
            v = path[k + 1],
            bond = graph.bonds.find(
              (z) => z.atoms.includes(u) && z.atoms.includes(v),
            )!;
          if ((bond.bo ?? 1) !== 1) continue;
          const side = component(v, [u, v]);
          if (side.includes(u)) continue;
          const axis = mul(
              sub(pos[v], pos[u]),
              1 / (dist(pos[v], pos[u]) || 1),
            ),
            candidate = pos.map((p) => ({ ...p }));
          for (const n of side) {
            const d = sub(pos[n], pos[u]),
              t = d.x * axis.x + d.y * axis.y;
            candidate[n] = add(pos[u], sub(mul(axis, 2 * t), d));
          }
          const rest = frags[of[a]].filter((n) => !side.includes(n));
          const clash = Math.min(
            9,
            ...side.flatMap((n) =>
              rest
                .filter((m) => !nb(n).includes(m))
                .map((m) => dist(candidate[n], candidate[m])),
            ),
          );
          if (
            clash > 0.6 &&
            dist(candidate[a], candidate[b]) <
              dist(pos[a], pos[b]) - 0.1 / 1.5 &&
            (!best || dist(candidate[a], candidate[b]) < dist(best[a], best[b]))
          )
            best = candidate;
        }
        if (best) {
          const mine = frags[of[a]],
            [lo, hi] = best[a].x <= best[b].x ? [a, b] : [b, a],
            angle = -Math.atan2(
              best[hi].y - best[lo].y,
              best[hi].x - best[lo].x,
            ),
            origin = best[lo];
          let transformed = best;
          for (const half of [0, Math.PI]) {
            transformed = best.map((p) => ({ ...p }));
            for (const n of mine)
              transformed[n] = add(
                origin,
                turn(sub(best[n], origin), angle + half),
              );
            if (
              mean(mine, transformed).y >=
              (transformed[a].y + transformed[b].y) / 2
            )
              break;
          }
          for (const n of mine) pos[n] = transformed[n];
        }
      }
    }
  // arrows._opening: widest gap, narrowed by labels and terminal hydrogens.
  function opening(i: number, at: (i: number) => Point) {
    const neighbors = nb(i),
      atom = graph.atoms[i];
    if (!neighbors.length) return;
    const tau = 2 * Math.PI;
    const dirs = neighbors.map((j) => ({
      angle: (Math.atan2(at(j).y - at(i).y, at(j).x - at(i).x) + tau) % tau,
      label: (graph.atoms[j].z ?? 6) !== 6,
    }));
    if (neighbors.length === 1 && (atom.z ?? 6) !== 6 && (atom.impHs ?? 0) > 0)
      dirs.push({
        angle: at(neighbors[0]).x >= at(i).x ? Math.PI : 0,
        label: true,
      });
    dirs.sort((a, b) => a.angle - b.angle);
    let best = -Infinity,
      angle = 0;
    for (let k = 0; k < dirs.length; k++) {
      const a = dirs[k],
        b = dirs[(k + 1) % dirs.length],
        width = (b.angle - a.angle + tau) % tau || tau,
        room =
          Math.round(
            (width - 0.6 * (Number(a.label) + Number(b.label))) * 1000,
          ) / 1000;
      if (room > best) {
        best = room;
        angle = a.angle + width / 2;
      }
    }
    return angle;
  }
  const placed = new Set([0]),
    gap = 2.3;
  for (let round = 0; round < frags.length; round++)
    for (let n = 1; n < frags.length; n++) {
      if (placed.has(n)) continue;
      const mine = contacts
        .filter(
          ([a, b]) =>
            (of[a] === n && placed.has(of[b])) ||
            (of[b] === n && placed.has(of[a])),
        )
        .map(([a, b]): [number, number] => (of[b] === n ? [a, b] : [b, a]));
      if (!mine.length) continue;
      const fixed = pos.map((_, i) => i).filter((i) => placed.has(of[i])),
        pair = mine
          .flatMap((a) => mine.map((b) => [a, b]))
          .find(([a, b]) => a[0] !== b[0] && a[1] !== b[1]);
      let bestScore = -Infinity,
        best: Map<number, Point> | undefined;
      const score = (value: number, candidate: Map<number, Point>) => {
        if (value > bestScore) {
          bestScore = value;
          best = candidate;
        }
      };
      if (pair) {
        const [[p1, q1], [p2, q2]] = pair,
          mp = mean([p1, p2], pos),
          mq = mean([q1, q2], pos),
          v = mul(sub(pos[p2], pos[p1]), 1 / (dist(pos[p1], pos[p2]) || 1)),
          fc = mean(fixed, pos);
        for (const sign of [1, -1]) {
          const normal = { x: -v.y * sign, y: v.x * sign },
            target = add(mp, mul(normal, gap));
          for (const flip of [1, -1]) {
            const d = sub(pos[q2], pos[q1]),
              angle = Math.atan2(v.y, v.x) - Math.atan2(d.y, d.x * flip),
              candidate = new Map<number, Point>();
            for (const i of frags[n]) {
              const p = sub(pos[i], mq);
              candidate.set(
                i,
                add(target, turn({ x: p.x * flip, y: p.y }, angle)),
              );
            }
            const clear = Math.min(
              ...[...candidate.values()].flatMap((p) =>
                fixed.map((j) => dist(p, pos[j])),
              ),
            );
            const behind =
                [...candidate.values()].reduce(
                  (s, p) =>
                    s +
                    (p.x - target.x) * normal.x +
                    (p.y - target.y) * normal.y,
                  0,
                ) / candidate.size,
              front = (fc.x - mp.x) * normal.x + (fc.y - mp.y) * normal.y;
            score(
              Math.min(clear, 2) * 2 + behind * 0.5 - front * 0.5,
              candidate,
            );
          }
        }
      } else {
        const [p, q] = mine[0],
          neighbors = nb(p),
          out = sub(
            pos[p],
            neighbors.length ? mean(neighbors, pos) : mean(fixed, pos),
          ),
          ringed = neighbors.length > 0 && norm(out) < 0.3;
        const base = ringed
          ? opening(p, (i) => pos[i])!
          : norm(out) > 1e-6
            ? Math.atan2(out.y, out.x)
            : 0;
        for (const da of [0, 30, -30, 60, -60, 90, -90]) {
          const d = base + (da * Math.PI) / 180,
            target = add(pos[p], {
              x: gap * Math.cos(d),
              y: gap * Math.sin(d),
            });
          for (const flip of [1, -1])
            for (let k = 0; k < 12; k++) {
              const candidate = new Map<number, Point>();
              for (const i of frags[n]) {
                const a = sub(pos[i], pos[q]);
                candidate.set(
                  i,
                  add(
                    target,
                    turn({ x: a.x * flip, y: a.y }, (k * Math.PI) / 6),
                  ),
                );
              }
              const clear = Math.min(
                  ...[...candidate.values()].flatMap((a) =>
                    fixed.map((j) => dist(a, pos[j])),
                  ),
                ),
                others =
                  3 *
                  mine
                    .slice(1)
                    .reduce(
                      (sum, [u, v]) =>
                        sum + Math.abs(dist(candidate.get(v)!, pos[u]) - gap),
                      0,
                    );
              const oq = Math.min(
                  gap * 2,
                  ...[...candidate]
                    .filter(([i]) => i !== q)
                    .map(([, a]) => dist(a, pos[p])),
                ),
                op = Math.min(
                  gap * 2,
                  ...fixed
                    .filter((i) => i !== p)
                    .map((i) => dist(target, pos[i])),
                );
              let value =
                Math.min(clear, gap) * 3 +
                Math.min(oq, gap * 1.5) * 2 +
                Math.min(op, gap * 1.5) -
                others -
                (Math.abs(da) * 0.01) / 1.5;
              if (clear < 1.25) value -= 20 * (1.25 - clear);
              const angle = opening(q, (i) => candidate.get(i)!);
              if (angle !== undefined)
                value +=
                  (2.5 / 1.5) *
                  Math.cos(
                    Math.atan2(pos[p].y - target.y, pos[p].x - target.x) -
                      angle,
                  );
              if (ringed) value += (2.5 / 1.5) * Math.cos((da * Math.PI) / 180);
              score(value, candidate);
            }
        }
      }
      for (const [i, p] of best!) pos[i] = p;
      placed.add(n);
    }
  return pos;
}
