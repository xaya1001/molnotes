import { angleBetween } from "./geometry-collision.ts";
import type { Point } from "../../../shared/chemical-library/types.ts";
const point = (p: Point, angle: number, r: number) => ({
  x: p.x + Math.cos((angle * Math.PI) / 180) * r,
  y: p.y + Math.sin((angle * Math.PI) / 180) * r,
});
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

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
