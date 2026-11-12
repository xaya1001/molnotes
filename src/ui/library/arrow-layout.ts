import {
  angleBetween,
  polygonHitsSegment,
  polygonsOverlap,
  segmentDistance,
  crosses,
} from "./geometry-collision.ts";
import type {
  Point,
  ElectronArrow,
} from "../../../shared/chemical-library/types.ts";
type Rect = { left: number; right: number; top: number; bottom: number };
type Segment = [Point, Point, boolean];
const point = (p: Point, angle: number, r: number) => ({
  x: p.x + Math.cos((angle * Math.PI) / 180) * r,
  y: p.y + Math.sin((angle * Math.PI) / 180) * r,
});
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function routeConnection(
  from: Rect,
  to: Rect,
  fromRow: Rect,
  toRow: Rect,
  wrapped: boolean,
): Point[] {
  const a = {
      x: (from.left + from.right) / 2,
      y: (from.top + from.bottom) / 2,
    },
    b = { x: (to.left + to.right) / 2, y: (to.top + to.bottom) / 2 };
  const vertical = wrapped;
  const p = vertical
    ? { x: a.x, y: b.y > a.y ? from.bottom + 8 : from.top - 8 }
    : { x: b.x > a.x ? from.right + 8 : from.left - 8, y: a.y };
  const q = vertical
    ? { x: b.x, y: b.y > a.y ? to.top - 8 : to.bottom + 8 }
    : { x: b.x > a.x ? to.left - 8 : to.right + 8, y: b.y };
  const middle = vertical
    ? b.y > a.y
      ? (fromRow.bottom + toRow.top) / 2
      : (fromRow.top + toRow.bottom) / 2
    : (p.x + q.x) / 2;
  return vertical
    ? [p, { x: p.x, y: middle }, { x: q.x, y: middle }, q]
    : [p, { x: middle, y: p.y }, { x: middle, y: q.y }, q];
}

export function arrowHead(
  tip: Point,
  before: Point,
  B: number,
  half = false,
  control = before,
) {
  const angle = Math.atan2(tip.y - before.y, tip.x - before.x),
    back = point(tip, (angle * 180) / Math.PI + 180, B * 0.4),
    notch = point(tip, (angle * 180) / Math.PI + 180, B * 0.3),
    wing = (side: number) => ({
      x: back.x - Math.sin(angle) * B * 0.17 * side,
      y: back.y + Math.cos(angle) * B * 0.17 * side,
    });
  // Keep the open side of a fishhook outside the curve.
  const side = cross(before, tip, control) > 0 ? 1 : -1;
  return half ? [tip, wing(side), notch] : [tip, wing(1), notch, wing(-1)];
}
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const vector = (a: Point, b: Point) => ({ x: b.x - a.x, y: b.y - a.y });

/** Orient the head along the visible cutoff-to-tip chord. The shaft ends at
 * the rear notch; routing controls how little it turns over this final span. */
export function solidArrow(
  start: Point,
  tip: Point,
  B: number,
  controls?: readonly Point[],
  half = false,
) {
  const mix = (a: Point, b: Point, t: number): Point => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const extend = (origin: Point, control: Point) =>
    mix(origin, control, Math.max(1, (B * 0.6) / distance(origin, control)));
  const p1 = controls ? extend(start, controls[0]) : mix(start, tip, 1 / 3),
    p2 = controls ? extend(tip, controls[1]) : mix(start, tip, 2 / 3);
  const split = (t: number) => {
    const a = mix(start, p1, t),
      b = mix(p1, p2, t),
      c = mix(p2, tip, t),
      d = mix(a, b, t),
      e = mix(b, c, t);
    return [a, d, mix(d, e, t)];
  };
  let before = 0,
    after = 1;
  for (let i = 127; i >= 0; i--) {
    if (distance(split(i / 128)[2], tip) >= B * 0.3) {
      before = i / 128;
      break;
    }
    after = i / 128;
  }
  for (let i = 0; i < 32; i++) {
    const t = (before + after) / 2;
    if (distance(split(t)[2], tip) >= B * 0.3) before = t;
    else after = t;
  }
  const [c1, c2, end] = split(before);
  const vertices = arrowHead(tip, end, B, half, c2);
  const axis = vector(end, tip),
    tangent = vector(c2, end);
  const startT = Math.min(0.5, (B * 0.15) / (3 * distance(start, p1)));
  const [, nearControl, nearStart] = split(startT);
  const headAngle = angleBetween(axis, tangent);
  const startAngle = angleBetween(
    vector(start, p1),
    vector(nearControl, nearStart),
  );
  return {
    vertices,
    headAngle,
    startAngle,
    points: [start, c1, c2, end] as const,
    shaft: controls
      ? `M${start.x} ${start.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`
      : `M${start.x} ${start.y}L${end.x} ${end.y}`,
    head:
      vertices.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join("") + "Z",
  };
}

function cubicPoints(a: Point, b: Point, c: Point, d: Point) {
  return Array.from({ length: 25 }, (_, i) => {
    const t = i / 24,
      u = 1 - t;
    return {
      x:
        u * u * u * a.x +
        3 * u * u * t * b.x +
        3 * u * t * t * c.x +
        t * t * t * d.x,
      y:
        u * u * u * a.y +
        3 * u * u * t * b.y +
        3 * u * t * t * c.y +
        t * t * t * d.y,
    };
  });
}

/** Route in the rendered coordinate system, so glyph metrics and existing ink
 * participate in the same decision. Authored curves remain optional overrides. */
export function routeElectronArrow(
  from: Point,
  to: Point,
  B: number,
  parent: SVGGraphicsElement,
  clearance: (end: "from" | "to", angle: number) => number,
  bend?: "left" | "right",
  directions?: {
    from?: number[];
    to?: number[];
    compact?: boolean;
    half?: boolean;
  },
): NonNullable<ElectronArrow["curve"]> {
  const inverse = parent.getCTM()!.inverse();
  const boxes: Rect[] = [
    ...parent.querySelectorAll<SVGGraphicsElement>("[data-label]"),
  ].map((e) => {
    const r = e.getBBox(),
      m = inverse.multiply(e.getCTM()!);
    const p = new DOMPoint(r.x, r.y).matrixTransform(m),
      q = new DOMPoint(r.x + r.width, r.y + r.height).matrixTransform(m);
    return {
      left: p.x - 1.2,
      right: q.x + 1.2,
      top: p.y - 1.2,
      bottom: q.y + 1.2,
    };
  });
  const heads = [
    ...parent.querySelectorAll<SVGPathElement>("[data-head-points]"),
  ].map((e) => {
    const m = inverse.multiply(e.getCTM()!);
    return (JSON.parse(e.dataset.headPoints!) as Point[]).map((p) =>
      new DOMPoint(p.x, p.y).matrixTransform(m),
    );
  });
  const segments: Segment[] = [];
  for (const e of parent.querySelectorAll<SVGPathElement>(
    "[data-bond],[data-electron-arrow]",
  )) {
    const length = e.getTotalLength();
    if (!length) continue;
    const m = inverse.multiply(e.getCTM()!),
      n = Math.max(2, Math.ceil(length / 4));
    let p = e.getPointAtLength(0).matrixTransform(m);
    for (let i = 1; i <= n; i++) {
      const q = e.getPointAtLength((length * i) / n).matrixTransform(m);
      segments.push([p, q, e.hasAttribute("data-electron-arrow")]);
      p = q;
    }
  }
  return routeElectronArrowGeometry(
    from,
    to,
    B,
    { boxes, heads, segments },
    clearance,
    bend,
    directions,
  );
}

export function routeElectronArrowGeometry(
  from: Point,
  to: Point,
  B: number,
  obstacles: { boxes: Rect[]; heads: Point[][]; segments: Segment[] },
  clearance: (end: "from" | "to", angle: number) => number,
  bend?: "left" | "right",
  directions?: {
    from?: number[];
    to?: number[];
    compact?: boolean;
    half?: boolean;
  },
): NonNullable<ElectronArrow["curve"]> {
  const { boxes, heads, segments } = obstacles;

  const direction = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  const length = Math.max(B * 1.25, distance(from, to) * 0.5);
  let best: NonNullable<ElectronArrow["curve"]> | undefined,
    bestScore = Infinity;
  const angles =
    distance(from, to) < B * 1.2
      ? [-110, -90, -70, 70, 90, 110]
      : [-140, -100, -60, -25, 25, 60, 100, 140];
  for (const exitAngle of directions?.from ?? angles.map((a) => direction + a))
    for (const entryAngle of directions?.to ?? angles.map((a) => direction + a))
      for (const reach of [0.5, 0.75, 1.1, 1.5, 2, 2.6, 3.4])
        for (const ratio of [1, 0.65, 1.5]) {
          const exit = ((exitAngle - direction + 540) % 360) - 180,
            entry = ((entryAngle - direction + 540) % 360) - 180;
          if (exit * entry >= 0) continue;
          const a = point(from, exitAngle, clearance("from", exitAngle)),
            d = point(to, entryAngle + 180, clearance("to", entryAngle + 180));
          const fromReach = Math.max(B * 0.6, length * reach),
            toReach = Math.max(B * 0.6, length * reach * ratio);
          const b = point(a, exitAngle, fromReach),
            c = point(d, entryAngle + 180, toReach);
          const visible = solidArrow(a, d, B, [b, c], directions?.half);
          if (visible.headAngle >= 5 || visible.startAngle >= 5) continue;
          const cross = (p: Point) =>
            (d.x - a.x) * (p.y - a.y) - (d.y - a.y) * (p.x - a.x);
          // Both controls stay on the same side of the clipped endpoint chord.
          // Otherwise label clearance can turn a nominal arc into an S or cusp.
          if (cross(b) * cross(c) < 0) continue;
          const points = cubicPoints(a, b, c, d);
          // Converging endpoint normals may cross as controls while still
          // producing a smooth arch. Reject actual loops, not control crossings.
          if (
            points
              .slice(1)
              .some((p, i) =>
                points
                  .slice(i + 3)
                  .some((q, j) => crosses(points[i], p, points[i + j + 2], q)),
              )
          )
            continue;
          let score = 0;
          const head = visible.vertices;
          for (const r of boxes) {
            const box = [
              { x: r.left, y: r.top },
              { x: r.right, y: r.top },
              { x: r.right, y: r.bottom },
              { x: r.left, y: r.bottom },
            ];
            if (polygonsOverlap(head, box)) score += 1000000;
          }
          for (const [u, v] of segments)
            if (polygonHitsSegment(head, u, v, B * 0.055)) score += 1000000;
          for (const previous of heads)
            if (polygonsOverlap(head, previous, B * 0.055)) score += 1000000;
          for (let i = 1; i < points.length - 1; i++) {
            const a = points[i - 1],
              p = points[i],
              b = points[i + 1];
            const turn = Math.acos(
              Math.max(
                -1,
                Math.min(
                  1,
                  ((p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)) /
                    (distance(a, p) * distance(p, b) || 1),
                ),
              ),
            );
            score += turn * turn * 120;
          }
          for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (
              i &&
              heads.some((head) =>
                polygonHitsSegment(head, points[i - 1], p, B * 0.055),
              )
            )
              score += 1000000;
            for (const r of boxes)
              if (
                p.x > r.left &&
                p.x < r.right &&
                p.y > r.top &&
                p.y < r.bottom
              )
                score += 10000;
            if (i) {
              const prev = points[i - 1];
              score += distance(prev, p) / B;
              for (const [u, v, arrow] of segments) {
                if (
                  Math.min(distance(p, from), distance(p, to)) > B * 0.12 &&
                  segmentDistance(p, u, v) < B * 0.1
                )
                  score += arrow ? 500 : 80;
                if (
                  !arrow &&
                  Math.min(
                    distance(p, from),
                    distance(p, to),
                    distance(prev, from),
                    distance(prev, to),
                  ) <
                    B * 0.23
                )
                  continue;
                if (crosses(prev, p, u, v)) score += arrow ? 20000 : 10000;
              }
            }
          }
          const shaft = cubicPoints(...visible.points);
          const arc = Math.max(
            ...shaft.map((p) => Math.abs(cross(p)) / distance(a, d)),
          );
          const short = directions?.compact || distance(a, d) < B * 1.2;
          const arcLength = points
            .slice(1)
            .reduce((sum, p, i) => sum + distance(points[i], p), 0);
          if (arc < B * (short ? 0.45 : 0.3) || arcLength < B * 1.2) continue;
          // Prefer an open, readable bond-transfer arc when space permits.
          // Collision penalties still win in constrained rings.
          if (directions?.compact)
            score +=
              ((Math.max(0, B * 0.7 - arc) + Math.max(0, B * 1.6 - arcLength)) /
                B) *
              500;
          const side =
            (to.x - from.x) * (points[12].y - from.y) -
            (to.y - from.y) * (points[12].x - from.x);
          if (bend && (bend === "left") !== side < 0) score += 10000;
          // Prefer a smooth arc over a loop when both avoid the same obstacles.
          score += Math.abs(exit + entry) * 0.008;
          if (score < bestScore) {
            const visibleLength = shaft
              .slice(1)
              .reduce(
                (sum, p, i) => sum + distance(shaft[i], p),
                distance(shaft.at(-1)!, d),
              );
            if (visibleLength < B * 1.2 + 0.2) continue;
            bestScore = score;
            best = {
              exitAngle,
              entryAngle,
              reach: [fromReach / B, toReach / B],
            };
          }
        }
  if (!best)
    throw new Error(
      "No curve satisfies the endpoint tangents; adjust relative placement",
    );
  return best;
}
