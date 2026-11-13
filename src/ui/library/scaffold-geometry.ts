import type {
  CompoundLayout,
  Point,
} from "../../../shared/chemical-library/types.ts";
import type { FigureNode } from "../../../shared/chemical-library/geometry.ts";
import type { FigureScene, FigureGroup } from "./scene-geometry.ts";
import { pathContours } from "./path-geometry.ts";

type Pair = [string, string];
const pairKey = (p: Pair) => [...p].sort().join("/");
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const minus = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
/** Depth changes line weight; stereochemical wedges retain their native shape. */
export function finishScaffoldGeometry(
  group: FigureGroup,
  layout: CompoundLayout,
  atomIds: string[],
  positions: Point[],
  ctx: FigureScene,
  mirror: boolean,
) {
  const scaffold = layout.scaffold;
  if (!scaffold) return;
  const core = new Map(scaffold.bonds.map((pair) => [pairKey(pair), pair]));
  const atoms = Object.fromEntries(atomIds.map((id, i) => [id, positions[i]]));
  const depth = (id: string) =>
      (scaffold.depths?.[id] ?? 0) * (mirror ? -1 : 1),
    zs = Object.keys(scaffold.depths ?? {}).map(depth),
    min = Math.min(...zs),
    max = Math.max(...zs),
    [lo, hi] = scaffold.depthWidth ?? [1, 1],
    stroke = ctx.token("--chemical-line");
  const width = (pair: Pair) =>
    scaffold.drawing === "flat"
      ? stroke
      : stroke *
        (lo +
          ((hi - lo) * ((depth(pair[0]) + depth(pair[1])) / 2 - min)) /
            Math.max(max - min, 1e-9));
  const gaps = new Map<string, { at: Point; radius: number }[]>();
  for (let i = 0; i < scaffold.bonds.length; i++)
    for (let j = i + 1; j < scaffold.bonds.length; j++) {
      const first = scaffold.bonds[i],
        second = scaffold.bonds[j];
      if (first.some((a) => second.includes(a))) continue;
      const p = atoms[first[0]],
        u = minus(atoms[first[1]], p),
        q = atoms[second[0]],
        v = minus(atoms[second[1]], q),
        den = cross(u, v);
      if (Math.abs(den) < 1e-8) continue;
      const t = cross(minus(q, p), v) / den,
        s = cross(minus(q, p), u) / den;
      if (t <= 0 || t >= 1 || s <= 0 || s >= 1) continue;
      let rear: Pair, front: Pair;
      if (scaffold.drawing === "flat") {
        const overpass = scaffold.overpasses?.find(
          ([a, b]) =>
            (pairKey(a) === pairKey(first) && pairKey(b) === pairKey(second)) ||
            (pairKey(b) === pairKey(first) && pairKey(a) === pairKey(second)),
        );
        if (!overpass) continue;
        [front, rear] = overpass;
      } else {
        const za = depth(first[0]) + t * (depth(first[1]) - depth(first[0])),
          zb = depth(second[0]) + s * (depth(second[1]) - depth(second[0]));
        [rear, front] = za < zb ? [first, second] : [second, first];
      }
      const key = pairKey(rear),
        holes = gaps.get(key) ?? [];
      holes.push({
        at: { x: p.x + t * u.x, y: p.y + t * u.y },
        radius: width(front) / 2 + stroke * 1.5,
      });
      gaps.set(key, holes);
    }
  const paths = ctx
    .nodes(group, (n) => n.kind === "path" && ctx.data(n, "bond") !== undefined)
    .filter(
      (n): n is Extract<FigureNode, { kind: "path" }> => n.kind === "path",
    );
  const parts = new Map<string, number>();
  for (const n of paths) {
    const id = ctx.data(n, "bond")!;
    parts.set(id, (parts.get(id) ?? 0) + 1);
  }
  for (const node of paths) {
    const owners = (ctx.data(node, "atoms") ?? "")
        .split(" ")
        .map((s) => s.slice(s.indexOf(":") + 1)),
      key = pairKey(owners as Pair),
      pair = core.get(key);
    if (!pair) continue;
    // Multiple lines and filled/hashed wedges keep their drawing semantics.
    if (
      scaffold.drawing === "perspective" &&
      node.paint.fill === "none" &&
      parts.get(ctx.data(node, "bond")!) === 1
    ) {
      ctx.setStyle(node, "strokeWidth", String(width(pair)));
      node.paint.lineCap = "round";
    }
    const holes = gaps.get(key);
    if (!holes?.length) continue;
    const p = atoms[pair[0]],
      q = atoms[pair[1]],
      v = minus(q, p),
      length = Math.hypot(v.x, v.y),
      fraction = (r: Point) =>
        ((r.x - p.x) * v.x + (r.y - p.y) * v.y) / length ** 2;
    let contours = pathContours(node.d).map((c) => c.points);
    if (node.paint.fill !== "none") {
      const clip = (polygon: Point[], limit: number, keepLow: boolean) => {
        const out: Point[] = [];
        for (let i = 0; i < polygon.length; i++) {
          const a = polygon[i],
            b = polygon[(i + 1) % polygon.length],
            ta = fraction(a) - limit,
            tb = fraction(b) - limit,
            ia = keepLow ? ta <= 0 : ta >= 0,
            ib = keepLow ? tb <= 0 : tb >= 0;
          if (ia) out.push(a);
          if (ia !== ib) {
            const t = ta / (ta - tb);
            out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
          }
        }
        return out;
      };
      for (const h of holes) {
        const t = fraction(h.at),
          r = h.radius / length;
        contours = contours
          .flatMap((c) => [clip(c, t - r, true), clip(c, t + r, false)])
          .filter((c) => c.length >= 3);
      }
      ctx.set(
        node,
        "d",
        contours
          .map((c) => `M${c.map((p) => `${p.x} ${p.y}`).join(" L")} Z`)
          .join(" "),
      );
    } else {
      const pieces: [Point, Point][] = [];
      for (const c of contours)
        for (let i = 1; i < c.length; i++) {
          const a = c[i - 1],
            b = c[i],
            w = minus(b, a),
            total = w.x * w.x + w.y * w.y,
            cuts: [number, number][] = [];
          for (const h of holes) {
            const off = minus(a, h.at),
              dot = off.x * w.x + off.y * w.y,
              disc =
                dot * dot - total * (off.x ** 2 + off.y ** 2 - h.radius ** 2);
            if (disc > 0) {
              const d = Math.sqrt(disc);
              cuts.push([
                Math.max(0, (-dot - d) / total),
                Math.min(1, (-dot + d) / total),
              ]);
            }
          }
          let start = 0;
          const at = (t: number) => ({ x: a.x + t * w.x, y: a.y + t * w.y });
          for (const [lo, hi] of cuts
            .filter(([lo, hi]) => hi > lo)
            .sort((a, b) => a[0] - b[0])) {
            if (lo > start) pieces.push([at(start), at(lo)]);
            start = Math.max(start, hi);
          }
          if (start < 1) pieces.push([at(start), b]);
        }
      ctx.set(
        node,
        "d",
        pieces.map(([a, b]) => `M${a.x} ${a.y} L${b.x} ${b.y}`).join(" "),
      );
    }
    if (!node.d.trim()) ctx.remove(node);
  }
}
