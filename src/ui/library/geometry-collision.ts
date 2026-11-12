import type { Point } from "../../../shared/chemical-library/types.ts";
export function insidePolygon(p: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
export function polygonHitsSegment(
  polygon: Point[],
  a: Point,
  b: Point,
  pad = 0,
) {
  return (
    insidePolygon(a, polygon) ||
    insidePolygon(b, polygon) ||
    polygon.some((p, i) => {
      const q = polygon[(i + 1) % polygon.length];
      return (
        crosses(a, b, p, q) ||
        Math.min(
          segmentDistance(a, p, q),
          segmentDistance(b, p, q),
          segmentDistance(p, a, b),
          segmentDistance(q, a, b),
        ) <= pad
      );
    })
  );
}
export function polygonsOverlap(a: Point[], b: Point[], pad = 0) {
  return (
    insidePolygon(a[0], b) ||
    b.some((p, i) => polygonHitsSegment(a, p, b[(i + 1) % b.length], pad))
  );
}

export function angleBetween(a: Point, b: Point) {
  return (
    (Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          (a.x * b.x + a.y * b.y) /
            (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)),
        ),
      ),
    ) *
      180) /
    Math.PI
  );
}
export function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function crosses(a: Point, b: Point, c: Point, d: Point) {
  const s = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return s(a, b, c) * s(a, b, d) < 0 && s(c, d, a) * s(c, d, b) < 0;
}
