type XY = [number, number];
const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0];
/** Cut the rear shaft at each foreground crossing; the gap contains no ink. */
export function visibleSegments(
  p: XY,
  q: XY,
  foreground: [XY, XY][],
  gap: number,
): [XY, XY][] {
  const v: XY = [q[0] - p[0], q[1] - p[1]],
    cuts: [number, number][] = [];
  for (const [a, b] of foreground) {
    const w: XY = [b[0] - a[0], b[1] - a[1]],
      off: XY = [a[0] - p[0], a[1] - p[1]],
      den = cross(v, w);
    if (Math.abs(den) < 1e-9) continue;
    const t = cross(off, w) / den,
      u = cross(off, v) / den;
    if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) {
      const m = gap / Math.hypot(...v);
      cuts.push([Math.max(0, t - m), Math.min(1, t + m)]);
    }
  }
  const result: [XY, XY][] = [],
    at = (t: number): XY => [p[0] + t * v[0], p[1] + t * v[1]];
  let start = 0;
  for (const [lo, hi] of cuts.sort((a, b) => a[0] - b[0])) {
    if (lo > start) result.push([at(start), at(lo)]);
    start = Math.max(start, hi);
  }
  if (start < 1) result.push([at(start), q]);
  return result;
}
