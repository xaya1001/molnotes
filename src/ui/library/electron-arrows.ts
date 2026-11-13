import type {
  Point,
  ElectronArrow,
} from "../../../shared/chemical-library/types.ts";
import {
  crosses,
  polygonsOverlap,
  polygonHitsSegment,
  segmentDistance,
} from "./geometry-collision.ts";

export interface ArrowAtom {
  point: Point;
  labelled: boolean;
}
export interface ArrowEndpoint {
  kind: string;
  atoms: string[];
  point: Point;
  mark?: { point: Point; radius: number };
}
export interface ArrowIntent {
  arrow: ElectronArrow;
  from: ArrowEndpoint;
  to: ArrowEndpoint;
}
export interface ArrowBox {
  atom?: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (p: Point, k: number): Point => ({ x: p.x * k, y: p.y * k });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const norm = (a: Point) => Math.hypot(a.x, a.y);
const dist = (a: Point, b: Point) => norm(sub(a, b));
const unit = (a: Point) => mul(a, 1 / (norm(a) || 1));
const mid = (a: Point, b: Point) => mul(add(a, b), 0.5);
const compare = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};
const nearest = (a: Point[], b: Point[], otherwise: number) =>
  Math.min(otherwise, ...a.flatMap((p) => b.map((q) => dist(p, q))));
function sample(s: Point, c: Point, e: Point, lead?: Point) {
  return Array.from({ length: 21 }, (_, i) => {
    const t = i / 20,
      u = 1 - t;
    return lead
      ? add(
          add(mul(s, u ** 3), mul(lead, 3 * u * u * t)),
          add(mul(c, 3 * u * t * t), mul(e, t ** 3)),
        )
      : add(add(mul(s, u * u), mul(c, 2 * u * t)), mul(e, t * t));
  });
}
function* permutations<T>(items: T[]): Generator<T[]> {
  if (!items.length) {
    yield [];
    return;
  }
  for (let i = 0; i < items.length; i++)
    for (const rest of permutations(items.filter((_, j) => i !== j)))
      yield [items[i], ...rest];
}

/** A2 candidate arcs, including the forming edges when identifying ring corners. */
export function electronArrowShapes(
  intents: ArrowIntent[],
  atoms: Record<string, ArrowAtom>,
  bonds: [string, string][],
  boxes: ArrowBox[],
  B: number,
  atomFont: number,
  marks: Record<string, { point: Point; radius: number }> = {},
  ink: {
    points: Point[];
    width: number;
    filled: boolean;
    atoms?: string[];
  }[] = [],
) {
  const xy = (id: string) => atoms[id].point;
  const radius = (id: string) =>
    atoms[id].labelled ? atomFont * 0.44 : B * 0.18;
  const edges = [...bonds];
  for (const { to } of intents)
    if (
      to.kind === "formingBond" &&
      !edges.some((e) => e.every((id) => to.atoms.includes(id)))
    )
      edges.push([to.atoms[0], to.atoms[1]]);
  const neighbors = (id: string) =>
    edges.filter((e) => e.includes(id)).map((e) => e.find((a) => a !== id)!);
  // The shortest path with an edge removed gives its smallest ring, including forming bonds.
  const rings: string[][] = [];
  for (const [a, b] of edges) {
    const queue = [[a]],
      seen = new Set([a]);
    while (queue.length) {
      const path = queue.shift()!,
        last = path.at(-1)!;
      if (last === b) {
        rings.push(path);
        break;
      }
      for (const next of neighbors(last)) {
        if (
          (last === a && next === b) ||
          (last === b && next === a) ||
          seen.has(next)
        )
          continue;
        seen.add(next);
        queue.push([...path, next]);
      }
    }
  }
  const centre = mul(
    Object.values(atoms).reduce((p, a) => add(p, a.point), { x: 0, y: 0 }),
    1 / Object.keys(atoms).length,
  );
  const mids = bonds.map((e) => ({ point: mid(xy(e[0]), xy(e[1])), ends: e }));
  type Candidate = {
    s: Point;
    c: Point;
    e: Point;
    lead?: Point;
    points: Point[];
    clear: number;
  };
  function rayExit(origin: Point, direction: Point, box: ArrowBox) {
    let enter = -Infinity,
      exit = Infinity;
    for (const [start, delta, min, max] of [
      [origin.x, direction.x, box.left, box.right],
      [origin.y, direction.y, box.top, box.bottom],
    ]) {
      if (Math.abs(delta) < 1e-8) {
        if (start < min || start > max) return 0;
      } else {
        const a = (min - start) / delta,
          b = (max - start) / delta;
        enter = Math.max(enter, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
      }
    }
    return exit >= Math.max(enter, 0) ? exit : 0;
  }
  const labelRadius = (id: string, direction: Point, gap: number) =>
    Math.max(
      radius(id),
      ...boxes
        .filter((b) => b.atom === id)
        .map((box) => rayExit(xy(id), direction, box)),
    ) + gap;
  const ownerBox = (id: string) => {
    const parts = boxes.filter((b) => b.atom === id),
      mark = marks[id];
    if (mark)
      parts.push({
        left: mark.point.x - mark.radius,
        right: mark.point.x + mark.radius,
        top: mark.point.y - mark.radius,
        bottom: mark.point.y + mark.radius,
      });
    return parts.length
      ? {
          left: Math.min(...parts.map((b) => b.left)),
          right: Math.max(...parts.map((b) => b.right)),
          top: Math.min(...parts.map((b) => b.top)),
          bottom: Math.max(...parts.map((b) => b.bottom)),
        }
      : undefined;
  };
  const sourceRadius = (id: string, direction: Point, gap: number) => {
    const box = ownerBox(id);
    return (
      Math.max(radius(id), box ? rayExit(xy(id), direction, box) : 0) + gap
    );
  };
  function head(c: Candidate, single: boolean) {
    const angle = unit(sub(c.e, c.c)),
      normal = { x: -angle.y, y: angle.x };
    const run = c.points
        .slice(1)
        .reduce((sum, p, i) => sum + dist(c.points[i], p), 0),
      length = Math.max(B * 0.34, Math.min(B * 0.4, run * 0.3));
    const back = add(c.e, mul(angle, -length)),
      end = add(c.e, mul(angle, -length * 0.8)),
      left = add(back, mul(normal, length * 0.46)),
      right = add(back, mul(normal, -length * 0.46));
    const barb = dot(sub(c.points[10], c.e), normal) > 0 ? right : left;
    return {
      vertices: single ? [c.e, barb, back] : [c.e, left, back, right],
      end,
    };
  }
  const rectPoints = (b: ArrowBox) => [
    { x: b.left, y: b.top },
    { x: b.right, y: b.top },
    { x: b.right, y: b.bottom },
    { x: b.left, y: b.bottom },
  ];
  function shaft(c: Candidate, single: boolean) {
    const end = head(c, single).end;
    return [
      c.s,
      c.lead ?? add(c.s, mul(sub(c.c, c.s), 2 / 3)),
      c.lead ? c.c : add(end, mul(sub(c.c, end), 2 / 3)),
      end,
    ] as const;
  }
  function visiblePoints(c: Candidate, single: boolean) {
    const [a, b, d, e] = shaft(c, single),
      steps = Math.max(
        1,
        Math.ceil((3 * Math.max(dist(a, b), dist(b, d), dist(d, e))) / 1.5),
      );
    return Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps,
        u = 1 - t;
      return add(
        add(mul(a, u * u * u), mul(b, 3 * u * u * t)),
        add(mul(d, 3 * u * t * t), mul(e, t * t * t)),
      );
    });
  }
  function lonePair(c: Candidate, intent: ArrowIntent) {
    const source = intent.from;
    if (
      source.kind !== "lonePair" ||
      (source.mark &&
        !(
          intent.to.atoms.length === 2 &&
          intent.to.atoms.includes(source.atoms[0])
        ))
    )
      return;
    const direction = unit(sub(c.s, xy(source.atoms[0]))),
      radius = Math.max(1, B * 0.06);
    const originalDistance = sourceRadius(
        source.atoms[0],
        direction,
        atomFont * 0.18 + 1.5,
      ),
      maximumDistance = dist(source.point, c.s) - radius - 1.5;
    const dx = Math.abs(direction.y) * radius * 2 + radius,
      dy = Math.abs(direction.x) * radius * 2 + radius;
    const distances = [originalDistance];
    for (
      let r = originalDistance + B * 0.03;
      r < maximumDistance;
      r += B * 0.03
    )
      distances.push(r);
    if (maximumDistance > originalDistance) distances.push(maximumDistance);
    const candidates = distances.map((distance) => {
      const point = add(source.point, mul(direction, distance)),
        box = {
          left: point.x - dx,
          right: point.x + dx,
          top: point.y - dy,
          bottom: point.y + dy,
        },
        rectangle = rectPoints(box);
      const ownerBoxes = Object.keys(atoms).flatMap((id) => {
        const b = ownerBox(id);
        return b ? [b] : [];
      });
      let collisions = ownerBoxes.filter((b) =>
        polygonsOverlap(rectangle, rectPoints(b), 0.2),
      ).length;
      for (const mark of Object.values(marks))
        if (
          polygonsOverlap(
            rectangle,
            rectPoints({
              left: mark.point.x - mark.radius,
              right: mark.point.x + mark.radius,
              top: mark.point.y - mark.radius,
              bottom: mark.point.y + mark.radius,
            }),
            0.2,
          )
        )
          collisions++;
      for (const trace of ink)
        if (
          trace.filled
            ? polygonsOverlap(rectangle, trace.points)
            : trace.points
                .slice(1)
                .some((p, i) =>
                  polygonHitsSegment(
                    rectangle,
                    trace.points[i],
                    p,
                    trace.width / 2,
                  ),
                )
        )
          collisions++;
      return { point, direction, radius, box, collisions, distance };
    });
    candidates.sort(
      (a, b) => a.collisions - b.collisions || a.distance - b.distance,
    );
    return candidates[0];
  }
  function one(
    intent: ArrowIntent,
    drawn: Point[][],
    drawnHeads: Point[][],
    drawnPairs: ArrowBox[],
  ) {
    const { arrow, from, to } = intent,
      fa = from.atoms,
      ta = to.atoms;
    let s0 = from.point;
    const e0 = to.point,
      single = arrow.electrons === 1;
    if (
      single &&
      fa.length === 2 &&
      intents.filter(
        (z) =>
          z.arrow.electrons === 1 &&
          z.from.atoms.length === 2 &&
          z.from.atoms.every((a) => fa.includes(a)),
      ).length > 1
    ) {
      const near = [...fa].sort((a, b) => dist(xy(a), e0) - dist(xy(b), e0))[0];
      s0 = add(s0, mul(sub(xy(near), s0), atoms[near].labelled ? 0 : 0.3));
    }
    const fromMark =
      (from.kind === "lonePair" || from.kind === "charge") &&
      from.mark &&
      !(ta.length === 2 && ta.includes(fa[0]));
    if (fromMark) s0 = from.mark!.point;
    const chord = dist(e0, s0);
    if (chord < 1e-6) return { curve: null, score: [0, 0] };
    const u = unit(sub(e0, s0)),
      n = { x: -u.y, y: u.x };
    let h0 = Math.min(Math.max(0.55 * chord, B), 2 * B),
      forced: number | undefined;
    const shared = fa.filter((a) => ta.includes(a)),
      skip = new Set([...fa, ...ta]);
    if (shared.length && fa.length === 2) {
      forced = dot(sub(mid(s0, e0), xy(shared[0])), n) >= 0 ? 1 : -1;
      h0 = Math.max(0.9 * chord, 0.8 * B);
      if (ta.length === 1) {
        forced = undefined;
        h0 = 0.95 * B;
      }
    }
    let ringOut: number | undefined,
      ringH = 0;
    if (shared.length && fa.length === 2 && ta.length === 2 && !arrow.bend) {
      const ring = rings.find(
        (r) =>
          [...fa, ...ta].every((a) => r.includes(a)) &&
          neighbors(shared[0]).length === 2,
      );
      if (ring) {
        const rc = mul(
            ring.reduce((p, id) => add(p, xy(id)), { x: 0, y: 0 }),
            1 / ring.length,
          ),
          m = mid(s0, e0);
        ringOut = dot(sub(m, rc), n) >= 0 ? 1 : -1;
        ringH =
          2 *
          (Math.abs(dot(sub(xy(shared[0]), m), n)) +
            Math.max(0.3 * B, radius(shared[0]) + 0.2 * B));
        forced = undefined;
      }
    }
    const ownBond = fa.length === 1 && ta.length === 2 && ta.includes(fa[0]);
    function curve(side: number, k: number, lean: number): Candidate {
      const h = side === ringOut ? ringH : h0 * k;
      let s: Point, c: Point, e: Point, lead: Point | undefined;
      if (ownBond) {
        const a = xy(fa[0]),
          o = xy(ta.find((id) => id !== fa[0])!),
          v = unit(sub(a, o)),
          p = { x: -v.y * side, y: v.x * side };
        const d = add(
          mul(v, Math.cos((55 * Math.PI) / 180)),
          mul(p, Math.sin((55 * Math.PI) / 180)),
        );
        const r = sourceRadius(
          fa[0],
          d,
          (from.kind === "lonePair" ? atomFont * 0.18 : 0) + 2 + B * 0.22,
        );
        s = add(a, mul(d, r));
        e = add(e0, mul(p, B * 0.22));
        c = add(mid(s, e), mul(p, B * 0.75 * k));
      } else {
        c = add(mid(s0, e0), mul(n, h * side));
        if (fa.length === 1) {
          let r = sourceRadius(
            fa[0],
            unit(sub(c, s0)),
            (from.kind === "lonePair" ? atomFont * 0.18 : 0) +
              (from.kind === "lonePair" ? 2 + B * 0.22 : 2),
          );
          if (fromMark) {
            const mark = from.mark!,
              direction = unit(sub(c, s0));
            r =
              Math.max(
                mark.radius,
                rayExit(mark.point, direction, {
                  left: mark.point.x - mark.radius,
                  right: mark.point.x + mark.radius,
                  top: mark.point.y - mark.radius,
                  bottom: mark.point.y + mark.radius,
                }),
              ) + 1.5;
          }
          s = add(s0, mul(unit(sub(c, s0)), r));
        } else s = add(s0, mul(n, side * B * 0.16));
        c = add(mid(s, e0), mul(n, h * side));
        if (to.kind === "atom" && fa.includes(ta[0])) {
          const angle = (lean * Math.PI) / 180,
            v = unit(
              add(mul(n, side * Math.sin(angle)), mul(u, Math.cos(angle))),
            );
          e = add(e0, mul(v, labelRadius(ta[0], v, 3)));
          c = add(e, mul(v, h * 0.95));
          lead = add(s, mul(n, side * h * 1.1));
        } else if (to.kind === "atom")
          e = add(
            e0,
            mul(unit(sub(c, e0)), labelRadius(ta[0], unit(sub(c, e0)), 3)),
          );
        else if (to.kind === "bond" || to.kind === "pi") {
          e = add(e0, mul(n, side * B * 0.2));
          c = add(mid(s, e), mul(n, h * side));
        } else {
          e = e0;
          c = add(mid(s, e), mul(n, h * side));
        }
      }
      const points = sample(s, c, e, lead);
      let clear = nearest(
        ownBond ? points : points.slice(3, 18),
        Object.entries(atoms)
          .filter(([id]) => !skip.has(id))
          .map(([, a]) => a.point),
        B * 3,
      );
      if (!ownBond && !lead)
        clear = nearest(
          points.slice(2),
          mids
            .filter(
              (m) =>
                !m.ends.every((a) => fa.includes(a)) &&
                !m.ends.every((a) => ta.includes(a)),
            )
            .map((m) => m.point),
          clear,
        );
      const candidate = { s, c, e, lead, points, clear };
      const polygon = head(candidate, single).vertices;
      for (const box of boxes) {
        const rect = rectPoints(box);
        clear = Math.min(
          clear,
          ...polygon.flatMap((p) =>
            rect.map((q, i) =>
              segmentDistance(p, q, rect[(i + 1) % rect.length]),
            ),
          ),
          ...rect.flatMap((p) =>
            polygon.map((q, i) =>
              segmentDistance(p, q, polygon[(i + 1) % polygon.length]),
            ),
          ),
        );
      }
      return { ...candidate, clear };
    }
    function trouble(c: Candidate) {
      const pts = c.points,
        visible = visiblePoints(c, single),
        polygon = head(c, single).vertices;
      const pair = lonePair(c, intent);

      let count = 0;
      for (const box of boxes)
        if (
          visible.some(
            (p) =>
              p.x > box.left + 0.4 &&
              p.x < box.right - 0.4 &&
              p.y > box.top + 0.4 &&
              p.y < box.bottom - 0.4,
          )
        )
          count++;
      for (const trace of ink) {
        const owns = (endpoint: ArrowEndpoint) =>
          endpoint.kind === "bond" || endpoint.kind === "pi"
            ? endpoint.atoms.every((id) => trace.atoms?.includes(id))
            : endpoint.kind === "atom" ||
                endpoint.kind === "charge" ||
                endpoint.kind === "radical"
              ? trace.atoms?.includes(endpoint.atoms[0])
              : false;
        if (
          visible.slice(1).some((p, i) => {
            if (
              (owns(from) && dist(p, visible[0]) < B * 0.25) ||
              (owns(to) && dist(p, visible.at(-1)!) < B * 0.25)
            )
              return false;
            return trace.points
              .slice(1)
              .some((q, j) => crosses(visible[i], p, trace.points[j], q));
          })
        )
          count++;
      }
      if (pair) {
        const rectangle = rectPoints(pair.box);
        for (const box of [
          ...Object.keys(atoms).flatMap((id) => {
            const b = ownerBox(id);
            return b ? [b] : [];
          }),
          ...drawnPairs,
        ])
          if (polygonsOverlap(rectangle, rectPoints(box), 0.2)) count++;
        for (const trace of ink)
          if (
            trace.filled
              ? polygonsOverlap(rectangle, trace.points)
              : trace.points
                  .slice(1)
                  .some((p, i) =>
                    polygonHitsSegment(
                      rectangle,
                      trace.points[i],
                      p,
                      trace.width / 2,
                    ),
                  )
          )
            count++;
        for (const other of drawnHeads)
          if (polygonsOverlap(rectangle, other, 0.2)) count++;
      }
      for (const box of drawnPairs) {
        const rectangle = rectPoints(box);
        if (
          polygonsOverlap(polygon, rectangle, 0.5) ||
          pts
            .slice(1)
            .some((p, i) => polygonHitsSegment(rectangle, pts[i], p, B * 0.03))
        )
          count++;
      }
      for (const box of boxes)
        if (polygonsOverlap(polygon, rectPoints(box), 0.5)) count++;
      for (const mark of Object.values(marks))
        if (
          polygonsOverlap(
            polygon,
            rectPoints({
              left: mark.point.x - mark.radius,
              top: mark.point.y - mark.radius,
              right: mark.point.x + mark.radius,
              bottom: mark.point.y + mark.radius,
            }),
            0.5,
          )
        )
          count++;
      for (const trace of ink)
        if (
          trace.filled
            ? polygonsOverlap(polygon, trace.points)
            : trace.points
                .slice(1)
                .some((p, i) =>
                  polygonHitsSegment(
                    polygon,
                    trace.points[i],
                    p,
                    trace.width / 2,
                  ),
                )
        )
          count++;
      for (const other of drawnHeads)
        if (
          polygonsOverlap(polygon, other, 0.5) ||
          pts
            .slice(1)
            .some((p, i) => polygonHitsSegment(other, pts[i], p, B * 0.055))
        )
          count++;
      for (const other of drawn)
        if (
          other
            .slice(1)
            .some((p, i) => polygonHitsSegment(polygon, other[i], p, B * 0.055))
        )
          count++;

      for (const ends of bonds) {
        if (
          ends.every((a) => fa.includes(a)) ||
          ends.every((a) => ta.includes(a))
        )
          continue;
        const start = ends.some((a) => fa.includes(a)) ? 3 : 0;
        if (
          pts
            .slice(start + 1)
            .some((q, i) =>
              crosses(pts[start + i], q, xy(ends[0]), xy(ends[1])),
            )
        )
          count++;
      }
      for (const box of boxes) {
        const id = box.atom;
        if (
          id &&
          fa.length === 1 &&
          id === fa[0] &&
          !fromMark &&
          box.right - box.left > 2.6 * radius(id)
        ) {
          if (
            pts
              .slice(1, -1)
              .some(
                (p) =>
                  p.x > box.left &&
                  p.x < box.right &&
                  p.y > box.top &&
                  p.y < box.bottom,
              )
          )
            count++;
          continue;
        }
        if (
          id &&
          skip.has(id) &&
          !(fa.length === 2 && fa.includes(id) && !ta.includes(id))
        )
          continue;
        const run = id && skip.has(id) ? pts.slice(3, -1) : pts.slice(1, -1);
        if (
          run.some(
            (p) =>
              p.x > box.left - 1 &&
              p.x < box.right + 1 &&
              p.y > box.top - 1 &&
              p.y < box.bottom + 1,
          )
        )
          count++;
      }
      for (const [id, mark] of Object.entries(marks)) {
        if (fromMark && id === fa[0]) continue;
        const rect = rectPoints({
          left: mark.point.x - mark.radius,
          right: mark.point.x + mark.radius,
          top: mark.point.y - mark.radius,
          bottom: mark.point.y + mark.radius,
        });
        if (
          pts
            .slice(1)
            .some((p, i) => polygonHitsSegment(rect, pts[i], p, B * 0.03))
        )
          count++;
      }
      if (to.kind === "atom") {
        const t = ta[0],
          v = sub(c.c, xy(t)),
          angle = Math.atan2(v.y, v.x);
        for (const j of neighbors(t)) {
          if (fa.length === 2 && fa.includes(t) && fa.includes(j)) continue;
          const d = sub(xy(j), xy(t)),
            diff = angle - Math.atan2(d.y, d.x);
          if (
            Math.abs(Math.atan2(Math.sin(diff), Math.cos(diff))) <
            (28 * Math.PI) / 180
          )
            count++;
        }
      }
      for (const other of drawn) {
        if (
          pts
            .slice(1)
            .some((p, i) =>
              other.slice(1).some((q, j) => crosses(pts[i], p, other[j], q)),
            )
        )
          count++;
        if (nearest(pts.slice(4, 17), other.slice(4, 17), Infinity) < B * 0.22)
          count++;
      }
      return count;
    }
    const crowd = (c: Candidate) =>
      drawn.filter(
        (other) =>
          nearest(c.points.slice(3, 18), other.slice(3, 18), Infinity) <
          B * 0.6,
      ).length;
    const sides =
      arrow.bend || forced
        ? [forced ?? (arrow.bend === "right" ? 1 : -1)]
        : [1, -1];
    const ownAtom = to.kind === "atom" && fa.includes(ta[0]);
    const candidates: { score: number[]; side: number; curve: Candidate }[] =
      [];
    for (const [li, lean] of (ownAtom ? [53, 95, 15] : [53]).entries())
      for (const k of [1, 0.8, 0.6, 0.45])
        for (const side of sides) {
          const c = curve(side, k, lean);
          candidates.push({
            score: [
              trouble(c),
              Number(ringOut !== undefined && side !== ringOut),
              crowd(c),
              li,
              -k,
            ],
            side,
            curve: c,
          });
        }
    candidates.sort((a, b) => compare(a.score, b.score));
    let pick = candidates.filter(
      (c) => compare(c.score, candidates[0].score) === 0,
    );
    if (pick.length > 1) {
      const room = pick.map((c) => Math.min(c.curve.clear, B * 0.5)),
        away = pick.map((c) => dist(c.curve.c, centre)),
        tol = B * 0.05;
      if (
        Math.abs(room[0] - room[1]) > tol &&
        Math.round(room[0] / (B * 0.15)) !== Math.round(room[1] / (B * 0.15))
      )
        pick = [pick[room[0] > room[1] ? 0 : 1]];
      else if (Math.abs(away[0] - away[1]) > tol)
        pick = [pick[away[0] > away[1] ? 0 : 1]];
      else
        pick.sort((a, b) =>
          compare(
            Math.abs(n.y) > 0.1
              ? [-n.y * a.side, -n.x * a.side]
              : [0, -n.x * a.side],
            Math.abs(n.y) > 0.1
              ? [-n.y * b.side, -n.x * b.side]
              : [0, -n.x * b.side],
          ),
        );
    }
    const chosen = pick[0],
      c = chosen.curve;
    drawn.push(c.points);
    drawnHeads.push(head(c, single).vertices);
    const pair = lonePair(c, intent);
    if (pair) drawnPairs.push(pair.box);
    return { curve: c, score: [chosen.score[0], chosen.score[2]] };
  }
  const attempt = (order: number[]) => {
    const drawn: Point[][] = [],
      heads: Point[][] = [],
      pairs: ArrowBox[] = [],
      result: ReturnType<typeof one>[] = [];
    for (const i of order) result[i] = one(intents[i], drawn, heads, pairs);
    return {
      result,
      score: result.reduce(
        (s, c) => [s[0] + c.score[0], s[1] + c.score[1]],
        [0, 0],
      ),
    };
  };
  const natural = intents.map((_, i) => i);
  let best = attempt(natural);
  if (best.score[0] && intents.length > 1)
    for (const order of intents.length <= 5
      ? permutations(natural)
      : [[...natural].reverse()]) {
      if (order.every((n, i) => natural[i] === n)) continue;
      const got = attempt(order);
      if (compare(got.score, best.score) < 0) best = got;
      if (!best.score[0]) break;
    }
  return best.result.map(({ curve: c }, index) => {
    if (!c) return undefined;
    const { s } = c,
      { vertices, end } = head(c, intents[index].arrow.electrons === 1);
    const points = shaft(c, intents[index].arrow.electrons === 1),
      controls = [points[1], points[2]];
    const pair = lonePair(c, intents[index]);
    return {
      points: [s, controls[0], controls[1], end] as const,
      vertices,
      lonePair: pair,
      shaft: `M${s.x} ${s.y}C${controls[0].x} ${controls[0].y} ${controls[1].x} ${controls[1].y} ${end.x} ${end.y}`,
      head:
        vertices.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join("") + "Z",
    };
  });
}

/** A2 circled charges: eight positions, free space first, then the arrow destination. */
export function chargeMarks(
  points: Record<string, Point>,
  bonds: [string, string][],
  boxes: Record<string, ArrowBox>,
  charges: Record<string, number>,
  aims: Record<string, Point>,
  B: number,
  atomFont: number,
  angles: Record<string, number> = {},
  ink: { points: Point[]; width: number; filled: boolean }[] = [],
) {
  const radius = atomFont * 0.3,
    placed: Record<string, { point: Point; radius: number }> = {};
  const obstacles = Object.entries(points).map(([id, point]) => ({
    point,
    id,
  }));
  for (const [a, b] of bonds)
    for (const fraction of [0.3, 0.5, 0.7])
      obstacles.push({
        point: add(points[a], mul(sub(points[b], points[a]), fraction)),
        id: "",
      });
  for (const id of Object.keys(charges)) {
    const p = points[id],
      box = boxes[id] ?? {
        left: p.x - B * 0.1,
        right: p.x + B * 0.1,
        top: p.y - B * 0.1,
        bottom: p.y + B * 0.1,
      };
    let bestScore = -Infinity,
      bestCollisions = Infinity,
      best: Point | undefined;
    for (const [index, degrees] of (angles[id] === undefined
      ? [-45, -135, 45, 135, -90, 90, 0, 180]
      : [angles[id]]
    ).entries()) {
      const a = (degrees * Math.PI) / 180,
        dx = Math.cos(a),
        dy = Math.sin(a);
      const kx = dx > 0 ? box.right - p.x : p.x - box.left,
        ky = dy > 0 ? box.bottom - p.y : p.y - box.top;
      const k =
        Math.min(
          Math.abs(dx) > 1e-6 ? kx / Math.abs(dx) : 1e9,
          Math.abs(dy) > 1e-6 ? ky / Math.abs(dy) : 1e9,
        ) +
        radius +
        1;
      const point = add(p, { x: dx * k, y: dy * k });
      let clear = Math.min(
        ...obstacles
          .filter((o) => o.id !== id)
          .map((o) => dist(point, o.point)),
        ...Object.values(placed).map((z) => dist(point, z.point) - z.radius),
      );
      for (const [other, r] of Object.entries(boxes))
        if (
          other !== id &&
          point.x > r.left - radius &&
          point.x < r.right + radius &&
          point.y > r.top - radius &&
          point.y < r.bottom + radius
        )
          clear = 0;
      let score = Math.min(clear, B * 0.8) - index * B * 0.012;
      if (aims[id])
        score += dot({ x: dx, y: dy }, unit(sub(aims[id], p))) * B * 0.2;
      const outer = radius + 0.8,
        rectangle = [
          { x: point.x - outer, y: point.y - outer },
          { x: point.x + outer, y: point.y - outer },
          { x: point.x + outer, y: point.y + outer },
          { x: point.x - outer, y: point.y + outer },
        ];
      const combined = {
        left: Math.min(box.left, point.x - outer),
        right: Math.max(box.right, point.x + outer),
        top: Math.min(box.top, point.y - outer),
        bottom: Math.max(box.bottom, point.y + outer),
      };
      let collisions = 0;
      for (const [other, b] of Object.entries(boxes))
        if (
          other !== id &&
          Math.min(combined.right, b.right) - Math.max(combined.left, b.left) >
            0.7 &&
          Math.min(combined.bottom, b.bottom) - Math.max(combined.top, b.top) >
            0.7
        )
          collisions++;
      for (const trace of ink)
        if (
          trace.filled
            ? polygonsOverlap(rectangle, trace.points)
            : trace.points
                .slice(1)
                .some((p, i) =>
                  polygonHitsSegment(
                    rectangle,
                    trace.points[i],
                    p,
                    trace.width / 2,
                  ),
                )
        )
          collisions++;
      if (
        collisions < bestCollisions ||
        (collisions === bestCollisions && score > bestScore)
      ) {
        bestCollisions = collisions;
        bestScore = score;
        best = point;
      }
    }
    placed[id] = { point: best!, radius };
  }
  return placed;
}
