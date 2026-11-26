import type {
  Point,
  ElectronArrow,
} from "../../../shared/chemical-library/types.ts";
import {
  crosses,
  polygonsOverlap,
  polygonHitsSegment,
  segmentDistance,
  angleBetween,
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
export function lonePairDistance(
  origin: Point,
  direction: Point,
  radius: number,
  gap: number,
  boxes: ArrowBox[],
) {
  const pad = radius + gap;
  return Math.max(
    pad,
    ...[-1, 1].flatMap((sign) => {
      const offset = mul(
        { x: -direction.y, y: direction.x },
        sign * 2 * radius,
      );
      return boxes.map((box) =>
        rayExit(add(origin, offset), direction, {
          left: box.left - pad,
          top: box.top - pad,
          right: box.right + pad,
          bottom: box.bottom + pad,
        }),
      );
    }),
  );
}

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

/** Port of arrows.draw candidate arcs, including forming edges when identifying ring corners. */
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
    if (source.kind !== "lonePair" || source.mark) return;
    const direction = unit(sub(c.s, xy(source.atoms[0]))),
      radius = Math.max(1, B * 0.06);
    const nearestDistance = lonePairDistance(
      source.point,
      direction,
      radius,
      2,
      boxes.filter((box) => box.atom === source.atoms[0]),
    );
    const ownerBoxes = Object.keys(atoms).flatMap((id) => {
      const b = ownerBox(id);
      return b ? [b] : [];
    });
    const pairAt = (distance: number) => {
      const point = add(source.point, mul(direction, distance)),
        dx = Math.abs(direction.y) * radius * 2 + radius,
        dy = Math.abs(direction.x) * radius * 2 + radius,
        box = {
          left: point.x - dx,
          right: point.x + dx,
          top: point.y - dy,
          bottom: point.y + dy,
        },
        rectangle = rectPoints(box);
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
      return { point, direction, radius, box, collisions };
    };
    let best = pairAt(nearestDistance);
    const limit = dist(source.point, c.s) - radius - 1.5;
    for (
      let distance = nearestDistance + B * 0.03;
      best.collisions && distance <= limit;
      distance += B * 0.03
    ) {
      const pair = pairAt(distance);
      if (pair.collisions < best.collisions) best = pair;
    }
    return best;
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
      from.kind === "charge" ||
      from.kind === "lonePair" ||
      from.kind === "radical"
        ? from.mark
        : undefined;
    if (fromMark) s0 = fromMark.point;
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
    const markTail = (
      mark: NonNullable<ArrowEndpoint["mark"]>,
      direction: Point,
    ) => {
      const { point, radius } = mark;
      const distance = rayExit(point, direction, {
        left: point.x - radius,
        right: point.x + radius,
        top: point.y - radius,
        bottom: point.y + radius,
      });
      return add(point, mul(direction, distance + 1.5));
    };
    const ownBond =
      (to.kind === "bond" || to.kind === "pi") &&
      fa.length === 1 &&
      ta.includes(fa[0]);
    function curve(
      side: number,
      k: number,
      lean: number,
      skew = 0,
      arrival?: number,
    ): Candidate {
      const h = side === ringOut ? ringH * Math.max(1, k) : h0 * k;
      let s: Point, c: Point, e: Point, lead: Point | undefined;
      if (ownBond) {
        const a = xy(fa[0]),
          o = xy(ta.find((id) => id !== fa[0])!),
          v = unit(sub(a, o)),
          p = { x: -v.y * side, y: v.x * side };
        const d = add(
          mul(v, Math.cos((lean * Math.PI) / 180)),
          mul(p, Math.sin((lean * Math.PI) / 180)),
        );
        const r = sourceRadius(
          fa[0],
          d,
          (from.kind === "lonePair" ? atomFont * 0.18 : 0) + 2 + B * 0.22,
        );
        s = fromMark ? markTail(fromMark, d) : add(a, mul(d, r));
        e = add(e0, mul(p, B * 0.22));
        c = add(mid(s, e), mul(p, B * 0.75 * k));
      } else {
        c = add(mid(s0, e0), mul(n, h * side));
        if (fa.length === 1) {
          const direction = unit(sub(c, s0));
          s = fromMark
            ? markTail(fromMark, direction)
            : add(
                s0,
                mul(
                  direction,
                  sourceRadius(
                    fa[0],
                    direction,
                    from.kind === "lonePair"
                      ? atomFont * 0.18 + 2 + B * 0.22
                      : 2,
                  ),
                ),
              );
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
      if (!ownBond && !lead && skew) {
        c = add(c, mul(u, skew * chord));
        if (to.kind === "atom") {
          const direction = unit(sub(c, e0));
          e = add(e0, mul(direction, labelRadius(ta[0], direction, 3)));
        }
      }
      if (arrival !== undefined) {
        const landing = ownBond ? e : e0,
          angle = Math.atan2(c.y - landing.y, c.x - landing.x) + arrival,
          direction = { x: Math.cos(angle), y: Math.sin(angle) };
        lead = add(s, mul(unit(sub(c, s)), h * 0.8));
        e =
          to.kind === "atom"
            ? add(e0, mul(direction, labelRadius(ta[0], direction, 3)))
            : landing;
        c = add(e, mul(direction, h * 0.8));
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
        for (let pi = 0; pi < polygon.length; pi++) {
          const p = polygon[pi];
          for (let i = 0; i < rect.length; i++) {
            const d = segmentDistance(p, rect[i], rect[(i + 1) % rect.length]);
            if (d < clear) clear = d;
          }
        }
        for (let ri = 0; ri < rect.length; ri++) {
          const p = rect[ri];
          for (let i = 0; i < polygon.length; i++) {
            const d = segmentDistance(
              p,
              polygon[i],
              polygon[(i + 1) % polygon.length],
            );
            if (d < clear) clear = d;
          }
        }
      }
      return { ...candidate, clear };
    }
    const inkBounds = ink.map((trace) => {
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (let i = 0; i < trace.points.length; i++) {
        const p = trace.points[i];
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      return { minX, maxX, minY, maxY };
    });
    function trouble(c: Candidate) {
      const pts = c.points,
        visible = visiblePoints(c, single),
        polygon = head(c, single).vertices;
      const pair = lonePair(c, intent);

      let count = 0;
      const [p0, p1, p2, end] = shaft(c, single),
        t = Math.min(0.5, (B * 0.15) / (3 * dist(p0, p1))),
        v = 1 - t,
        departure = add(
          add(mul(sub(p1, p0), v * v), mul(sub(p2, p1), 2 * v * t)),
          mul(sub(end, p2), t * t),
        );
      if (angleBetween(sub(p1, p0), departure) >= 11.5) count++;
      const tip = polygon[0],
        chord = dist(c.s, tip);
      let length = dist(visible[visible.length - 1], tip);
      let vMinX = visible[0].x,
        vMaxX = visible[0].x,
        vMinY = visible[0].y,
        vMaxY = visible[0].y;
      for (let i = 1; i < visible.length; i++) {
        const p = visible[i];
        length += dist(visible[i - 1], p);
        if (p.x < vMinX) vMinX = p.x;
        if (p.x > vMaxX) vMaxX = p.x;
        if (p.y < vMinY) vMinY = p.y;
        if (p.y > vMaxY) vMaxY = p.y;
      }
      if (length < B * 1.25) count++;
      if (length > chord * 3.5) count++;
      if (chord < B * 1.2 || (fa.length === 2 && to.kind === "bond")) {
        let height = -Infinity;
        const denom = chord || 1;
        const dx = tip.x - c.s.x,
          dy = tip.y - c.s.y;
        for (let i = 0; i < visible.length; i++) {
          const p = visible[i];
          const hVal =
            Math.abs(dx * (p.y - c.s.y) - dy * (p.x - c.s.x)) / denom;
          if (hVal > height) height = hVal;
        }
        if (height < B * 0.36) count++;
      }
      for (const box of boxes) {
        if (
          vMaxX <= box.left + 0.4 ||
          vMinX >= box.right - 0.4 ||
          vMaxY <= box.top + 0.4 ||
          vMinY >= box.bottom - 0.4
        )
          continue;
        for (let i = 0; i < visible.length; i++) {
          const p = visible[i];
          if (
            p.x > box.left + 0.4 &&
            p.x < box.right - 0.4 &&
            p.y > box.top + 0.4 &&
            p.y < box.bottom - 0.4
          ) {
            count++;
            break;
          }
        }
      }
      const v0 = visible[0],
        vLast = visible[visible.length - 1],
        nearLimit = B * 0.25;
      for (let ti = 0; ti < ink.length; ti++) {
        const tb = inkBounds[ti];
        if (
          vMaxX < tb.minX ||
          vMinX > tb.maxX ||
          vMaxY < tb.minY ||
          vMinY > tb.maxY
        )
          continue;
        const trace = ink[ti];
        const owns = (endpoint: ArrowEndpoint) =>
          endpoint.kind === "bond" || endpoint.kind === "pi"
            ? endpoint.atoms.every((id) => trace.atoms?.includes(id))
            : endpoint.kind === "atom" ||
                endpoint.kind === "charge" ||
                endpoint.kind === "radical"
              ? trace.atoms?.includes(endpoint.atoms[0])
              : false;
        const ownsFrom = owns(from),
          ownsTo = owns(to),
          tpts = trace.points;
        let hit = false;
        for (let i = 1; i < visible.length && !hit; i++) {
          const p = visible[i],
            prev = visible[i - 1];
          if (
            (ownsFrom && dist(p, v0) < nearLimit) ||
            (ownsTo && dist(p, vLast) < nearLimit)
          )
            continue;
          const sMinX = prev.x < p.x ? prev.x : p.x,
            sMaxX = prev.x > p.x ? prev.x : p.x,
            sMinY = prev.y < p.y ? prev.y : p.y,
            sMaxY = prev.y > p.y ? prev.y : p.y;
          if (
            sMaxX < tb.minX ||
            sMinX > tb.maxX ||
            sMaxY < tb.minY ||
            sMinY > tb.maxY
          )
            continue;
          for (let j = 1; j < tpts.length; j++) {
            if (crosses(prev, p, tpts[j - 1], tpts[j])) {
              hit = true;
              break;
            }
          }
        }
        if (hit) count++;
      }
      if (pair) {
        const rectangle = rectPoints(pair.box);
        if (polygonsOverlap(polygon, rectangle, 0.5)) count++;
        if (
          visible
            .slice(1)
            .some((p, i) =>
              polygonHitsSegment(rectangle, visible[i], p, B * 0.03),
            )
        )
          count++;
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
        if (fromMark && from.kind !== "lonePair" && id === fa[0]) continue;
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
    for (const [li, lean] of (ownBond
      ? [55, 25, 85, 115, 145]
      : ownAtom
        ? [53, 95, 15]
        : [53]
    ).entries())
      for (const k of [1, 1.25, 1.5, 2, 3, 0.8, 0.6, 0.45])
        for (const side of sides) {
          const c = curve(side, k, lean);
          candidates.push({
            score: [
              trouble(c),
              Number(ringOut !== undefined && side !== ringOut),
              crowd(c),
              li,
              Math.abs(k - 1),
            ],
            side,
            curve: c,
          });
        }
    if (!ownBond && !ownAtom && candidates.every((c) => c.score[0]))
      for (const skew of [0.5, -0.5, 1, -1])
        for (const k of [1, 1.5, 2, 3])
          for (const side of sides) {
            const c = curve(side, k, 53, skew);
            candidates.push({
              score: [
                trouble(c),
                Number(ringOut !== undefined && side !== ringOut),
                crowd(c),
                0,
                Math.abs(k - 1) + Math.abs(skew),
              ],
              side,
              curve: c,
            });
          }
    if (
      (to.kind === "atom" || to.kind === "formingBond" || ownBond) &&
      candidates.every((c) => c.score[0])
    )
      for (const degrees of [0, 30, -30, 60, -60, 90, -90, 120, -120, 180])
        for (const [li, lean] of (ownBond
          ? [55, 25, 85, 115, 145]
          : [53]
        ).entries())
          for (const k of [1, 1.5, 2, 3])
            for (const side of sides) {
              const c = curve(side, k, lean, 0, (degrees * Math.PI) / 180);
              candidates.push({
                score: [
                  trouble(c),
                  Number(ringOut !== undefined && side !== ringOut),
                  crowd(c),
                  li,
                  1 + Math.abs(k - 1) + Math.abs(degrees) / 180,
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

/** Place circled charges in open sectors around their atom. */
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
  radicalIons: ReadonlySet<string> = new Set(),
) {
  const radius = atomFont * 0.3,
    placed: Record<string, { point: Point; radius: number; dot?: Point }> = {};
  for (const id of Object.keys(charges)) {
    const p = points[id],
      box = boxes[id] ?? {
        left: p.x - B * 0.1,
        right: p.x + B * 0.1,
        top: p.y - B * 0.1,
        bottom: p.y + B * 0.1,
      };
    const directions = bonds.flatMap(([a, b]) => {
      if (a !== id && b !== id) return [];
      const q = points[a === id ? b : a];
      return [Math.atan2(q.y - p.y, q.x - p.x)];
    });
    for (const [other, r] of Object.entries(boxes)) {
      if (other === id || other.startsWith("union:")) continue;
      const q = { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 };
      if (dist(p, q) < B) directions.push(Math.atan2(q.y - p.y, q.x - p.x));
    }
    const circular = directions
      .map((a) => (a + 2 * Math.PI) % (2 * Math.PI))
      .sort((a, b) => a - b);
    const gaps = circular.map((a, i) => {
      const size = (circular[i + 1] ?? circular[0] + 2 * Math.PI) - a;
      return { angle: a + size / 2, size };
    });
    const defaultAngle = -Math.PI / 4;
    const blocked = directions.some(
      (a) =>
        Math.abs(
          Math.atan2(Math.sin(a - defaultAngle), Math.cos(a - defaultAngle)),
        ) <=
        Math.PI / 6,
    );
    const preferred = (a: number) => {
      const x = Math.cos(a),
        y = Math.sin(a);
      return y < 0 ? (x >= 0 ? 3 : 2) : x >= 0 ? 1 : 0;
    };
    gaps.sort((a, b) =>
      Math.abs(a.size - b.size) > Math.PI / 36
        ? b.size - a.size
        : preferred(b.angle) - preferred(a.angle),
    );
    const aim = aims[id];
    const fallback = aim
      ? gaps.length
        ? gaps.map((gap) => gap.angle)
        : [Math.atan2(aim.y - p.y, aim.x - p.x)]
      : blocked
        ? gaps.map((gap) => gap.angle)
        : [defaultAngle, ...gaps.map((gap) => gap.angle)];
    const candidates =
      angles[id] !== undefined
        ? [(angles[id] * Math.PI) / 180, ...fallback]
        : fallback;
    let bestScore = -Infinity,
      bestCollisions = Infinity,
      best: (typeof placed)[string] | undefined;
    for (const [index, a] of candidates.entries()) {
      const dx = Math.cos(a),
        dy = Math.sin(a);
      const kx = dx > 0 ? box.right - p.x : p.x - box.left,
        ky = dy > 0 ? box.bottom - p.y : p.y - box.top;
      const outer = radius + 0.8;
      let k =
        Math.min(
          Math.abs(dx) > 1e-6 ? kx / Math.abs(dx) : 1e9,
          Math.abs(dy) > 1e-6 ? ky / Math.abs(dy) : 1e9,
        ) +
        radius +
        B * 0.09;
      if (
        Math.min(p.x + dx * k + outer, box.right) -
          Math.max(p.x + dx * k - outer, box.left) >
          0.7 &&
        Math.min(p.y + dy * k + outer, box.bottom) -
          Math.max(p.y + dy * k - outer, box.top) >
          0.7
      ) {
        const clearance = outer + B * 0.03;
        k = Math.max(
          k,
          Math.min(
            Math.abs(dx) > 1e-6 ? (kx + clearance) / Math.abs(dx) : 1e9,
            Math.abs(dy) > 1e-6 ? (ky + clearance) / Math.abs(dy) : 1e9,
          ),
        );
      }
      const point = add(p, { x: dx * k, y: dy * k });
      const facing = aim ? dot({ x: dx, y: dy }, unit(sub(aim, p))) : 0;
      const score =
        index === 0 && angles[id] !== undefined ? 2 : aim ? facing : -index;
      const dotPoint = radicalIons.has(id)
          ? {
              x: point.x + (dx >= 0 ? 1 : -1) * (radius + B * 0.07),
              y: point.y,
            }
          : undefined,
        left = Math.min(
          point.x - outer,
          dotPoint ? dotPoint.x - B * 0.04 : Infinity,
        ),
        right = Math.max(
          point.x + outer,
          dotPoint ? dotPoint.x + B * 0.04 : -Infinity,
        ),
        rectangle = [
          { x: left, y: point.y - outer },
          { x: right, y: point.y - outer },
          { x: right, y: point.y + outer },
          { x: left, y: point.y + outer },
        ];
      let collisions = 0;
      for (const mark of Object.values(placed))
        if (dist(point, mark.point) < radius + mark.radius + 1.6) collisions++;
      for (const [other, b] of Object.entries(boxes))
        if (
          other !== id &&
          Math.min(right, b.right) - Math.max(left, b.left) > 0.7 &&
          Math.min(point.y + outer, b.bottom) -
            Math.max(point.y - outer, b.top) >
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
        best = { point, radius, ...(dotPoint ? { dot: dotPoint } : {}) };
      }
    }
    placed[id] = best!;
  }
  return placed;
}
