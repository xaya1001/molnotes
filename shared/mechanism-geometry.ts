import type { MechanismAnchor, MechanismFrame } from "./mechanism.ts";
export interface Point {
  x: number;
  y: number;
}
export interface MappedAtom extends Point {
  map: number;
  source: number;
}
export interface MechanismBond {
  a: number;
  b: number;
  order: number;
}
export interface Geometry {
  atoms: MappedAtom[];
  bonds: MechanismBond[];
}
export const interpolatePoint = (a: Point, b: Point, t: number): Point =>
  t === 1
    ? { x: b.x, y: b.y }
    : t === 0
      ? { x: a.x, y: a.y }
      : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
/** Assign on first appearance; a mapped atom retains its source after molecules merge. */
export function atomSources(frames: readonly MechanismFrame[]) {
  const result = new Map<number, number>();
  let source = 0;
  for (const f of frames)
    for (const m of f.molecules) {
      const origin = source;
      if (m.atomMap.some((id) => !result.has(id))) source++;
      for (const id of m.atomMap) if (!result.has(id)) result.set(id, origin);
    }
  return result;
}
export const edgeKey = (a: number, b: number) =>
  a < b ? `${a}-${b}` : `${b}-${a}`;
export function mappedPositions(a: Geometry, b: Geometry, t: number) {
  const target = new Map(b.atoms.map((p) => [p.map, p]));
  return new Map(
    a.atoms.map((p) => [p.map, interpolatePoint(p, target.get(p.map) ?? p, t)]),
  );
}
export function anchorPoint(
  end: MechanismAnchor,
  atoms: readonly MappedAtom[],
  frame: MechanismFrame,
  bondLength: number,
) {
  const get = (id: number) => atoms.find((a) => a.map === id)!;
  if ("bond" in end || "forming" in end) {
    const [a, b] = ("bond" in end ? end.bond : end.forming).map(get);
    return interpolatePoint(a, b, 0.5);
  }
  const id =
    "atom" in end ? end.atom : "lonePair" in end ? end.lonePair : end.charge;
  const a = get(id);
  if ("atom" in end) return a;
  const angle =
    "lonePair" in end
      ? frame.lonePairs!.find((p) => p.atom === id)!.angle
      : -45;
  const r = (angle * Math.PI) / 180,
    d = bondLength * ("charge" in end ? 0.82 : 0.48);
  return { x: a.x + Math.cos(r) * d, y: a.y + Math.sin(r) * d };
}
export function cubicPoint(a: Point, c: Point, d: Point, b: Point, t: number) {
  const u = 1 - t;
  return {
    x:
      u * u * u * a.x +
      3 * u * u * t * c.x +
      3 * u * t * t * d.x +
      t * t * t * b.x,
    y:
      u * u * u * a.y +
      3 * u * u * t * c.y +
      3 * u * t * t * d.y +
      t * t * t * b.y,
  };
}
function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
/** Score both sides of the cubic against labels and bonds, excluding endpoint contacts. */
export function curvedArrow(
  a: Point,
  b: Point,
  geometry: Geometry,
  bend?: number,
  clearance = 10,
) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const candidate = (curvature: number) => {
    const c = {
      x: a.x + dx / 3 - dy * curvature,
      y: a.y + dy / 3 + dx * curvature,
    };
    const d = {
      x: a.x + (2 * dx) / 3 - dy * curvature,
      y: a.y + (2 * dy) / 3 + dx * curvature,
    };
    let score = 0;
    for (let i = 2; i < 29; i++) {
      const p = cubicPoint(a, c, d, b, i / 30);
      for (const atom of geometry.atoms) {
        if (
          Math.hypot(atom.x - a.x, atom.y - a.y) < clearance ||
          Math.hypot(atom.x - b.x, atom.y - b.y) < clearance
        )
          continue;
        score +=
          Math.max(0, clearance - Math.hypot(atom.x - p.x, atom.y - p.y)) ** 2;
      }
      for (const bond of geometry.bonds) {
        const start = geometry.atoms.find((p) => p.map === bond.a)!,
          end = geometry.atoms.find((p) => p.map === bond.b)!;
        if (
          segmentDistance(a, start, end) < 1 ||
          segmentDistance(b, start, end) < 1
        )
          continue;
        score +=
          Math.max(0, clearance * 0.45 - segmentDistance(p, start, end)) ** 2;
      }
    }
    // Tip stops short of an atom label; the electron-source tail remains anchored.
    const vx = b.x - d.x,
      vy = b.y - d.y,
      len = Math.hypot(vx, vy) || 1;
    const tip = {
      x: b.x - (vx / len) * clearance * 0.7,
      y: b.y - (vy / len) * clearance * 0.7,
    };
    return {
      a,
      c,
      d,
      b: tip,
      score,
      bend: curvature,
      path: `M ${a.x} ${a.y} C ${c.x} ${c.y} ${d.x} ${d.y} ${tip.x} ${tip.y}`,
    };
  };
  return (
    bend === undefined ? [0.35, -0.35, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2] : [bend]
  )
    .map(candidate)
    .reduce((x, y) => (y.score < x.score ? y : x));
}
export function cycleLayout(count: number, radius: number) {
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / count;
    const next = -Math.PI / 2 + (2 * Math.PI * (i + 1)) / count;
    const middle = (angle + next) / 2;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      angle,
      next,
      arc: `M ${Math.cos(angle + 0.22) * radius} ${Math.sin(angle + 0.22) * radius} A ${radius} ${radius} 0 0 1 ${Math.cos(next - 0.22) * radius} ${Math.sin(next - 0.22) * radius}`,
      label: { x: Math.cos(middle) * radius, y: Math.sin(middle) * radius },
      branch: {
        x: Math.cos(middle) * (radius + 100),
        y: Math.sin(middle) * (radius + 100),
      },
    };
  });
}
