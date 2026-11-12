import { mainRowBox, rectangle } from "./geometry-math.ts";
import type { Point } from "../../../shared/chemical-library/types.ts";
import { type FigureGroup, type FigureScene } from "./scene-geometry.ts";
import type {
  FigureNode,
  FigureRect,
} from "../../../shared/chemical-library/geometry.ts";
import { inkIntersectsBox, pathContours, samplePath } from "./path-geometry.ts";

export const inkBox = (
  node: FigureNode,
  parent: FigureGroup,
  ctx: FigureScene,
) => ctx.inkBox(node, parent);
function bounds(points: Point[]): FigureRect {
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return rectangle(
    x,
    y,
    Math.max(...points.map((p) => p.x)) - x,
    Math.max(...points.map((p) => p.y)) - y,
  );
}
export function labelBoxes(parent: FigureGroup, ctx: FigureScene) {
  const boxes = new Map<string, FigureRect>();
  for (const node of ctx.nodes(
    parent,
    (node) => ctx.data(node, "label") !== undefined,
  )) {
    const b = ctx.inkBox(node, parent);
    if (!b.width) continue;
    const id = ctx.data(node, "chargeOwner") ?? ctx.data(node, "label"),
      prior = boxes.get(id);
    boxes.set(
      id,
      prior
        ? bounds([
            { x: prior.left, y: prior.top },
            { x: prior.right, y: prior.bottom },
            { x: b.left, y: b.top },
            { x: b.right, y: b.bottom },
          ])
        : b,
    );
  }
  return boxes;
}
export function bondTraces(parent: FigureGroup, ctx: FigureScene) {
  return ctx
    .nodes(parent)
    .filter((node) => node.kind === "path")
    .filter((node) => ctx.data(node, "bond") !== undefined)
    .map((el) => ({
      el,
      points: samplePath(el.d, 1.5, ctx.relativeMatrix(el, parent)),
      contours: pathContours(el.d, ctx.relativeMatrix(el, parent)),
      width:
        el.paint.stroke === "none"
          ? 0
          : el.paint.strokeWidth *
            Math.hypot(...ctx.relativeMatrix(el, parent).slice(0, 2)),
      filled: el.paint.fill !== "none",
    }));
}

/** Native endpoints clear individual glyphs; reserve the complete main row and final stroke. */
export function spaceBondEndpoints(parent: FigureGroup, ctx: FigureScene) {
  const labels = new Map<string, FigureRect[]>();
  for (const node of ctx.nodes(parent)) {
    const id = ctx.data(node, "label");
    if (id)
      labels.set(id, [...(labels.get(id) ?? []), inkBox(node, parent, ctx)]);
  }
  for (const trace of bondTraces(parent, ctx)) {
    if (trace.filled || trace.contours.some((c) => c.points.length !== 2))
      continue;
    const boxes = (ctx.data(trace.el, "atoms") ?? "")
      .split(" ")
      .flatMap((id) => (labels.has(id) ? [mainRowBox(labels.get(id)!)] : []));
    let changed = false;
    const segments = trace.contours.map((contour) => {
      const points = contour.points.map((p) => ({ ...p }));
      for (const box of boxes) {
        if (!inkIntersectsBox([contour], box, trace.width, false)) continue;
        const pad = trace.width / 2 + 0.1,
          left = box.x - pad,
          right = box.x + box.width + pad,
          top = box.y - pad,
          bottom = box.y + box.height + pad;
        for (const i of [0, 1]) {
          const p = points[i],
            q = points[1 - i];
          if (p.x < left || p.x > right || p.y < top || p.y > bottom) continue;
          const dx = q.x - p.x,
            dy = q.y - p.y;
          const t = Math.min(
            dx > 0 ? (right - p.x) / dx : dx < 0 ? (left - p.x) / dx : Infinity,
            dy > 0 ? (bottom - p.y) / dy : dy < 0 ? (top - p.y) / dy : Infinity,
          );
          if (t >= 1) continue;
          points[i] = { x: p.x + t * dx, y: p.y + t * dy };
          changed = true;
        }
      }
      return `M${points[0].x} ${points[0].y}L${points[1].x} ${points[1].y}`;
    });
    if (changed) {
      ctx.set(trace.el, "d", segments.join(" "));
      ctx.set(trace.el, "transform", "matrix(1 0 0 1 0 0)");
    }
  }
}
export function overlap(a: FigureRect, b: FigureRect) {
  return (
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left) - 0.5) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) - 0.5)
  );
}
export function contains(b: FigureRect, p: Point) {
  return (
    p.x > b.left + 0.5 &&
    p.x < b.right - 0.5 &&
    p.y > b.top + 0.5 &&
    p.y < b.bottom - 0.5
  );
}
/** Keep native atom-note placement when clear, then separate colliding outlined ink. */
export function spaceAtomNumber(
  note: FigureGroup,
  parent: FigureGroup,
  atom: Point,
  ctx: FigureScene,
) {
  const original = ctx.inkBox(note, parent),
    center = {
      x: original.x + original.width / 2,
      y: original.y + original.height / 2,
    },
    labels = [...labelBoxes(parent, ctx)]
      .filter(([id]) => id !== ctx.data(note, "label"))
      .map(([, b]) => b),
    traces = bondTraces(parent, ctx);
  const box = (p: Point) =>
    rectangle(
      p.x - original.width / 2,
      p.y - original.height / 2,
      original.width,
      original.height,
    );
  const collision = (b: FigureRect) =>
    labels.reduce((sum, other) => sum + 3 * overlap(b, other), 0) +
    traces.reduce(
      (sum, trace) => sum + trace.points.filter((p) => contains(b, p)).length,
      0,
    );
  const initial = collision(original);
  if (!initial) return;
  const radius = Math.hypot(center.x - atom.x, center.y - atom.y),
    angle = Math.atan2(center.y - atom.y, center.x - atom.x);
  let chosen = center,
    best = initial,
    bestDistance = 0;
  for (const extra of [0, original.height / 2, original.height])
    for (const degrees of [
      0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180,
    ]) {
      const a = angle + (degrees * Math.PI) / 180,
        p = {
          x: atom.x + (radius + extra) * Math.cos(a),
          y: atom.y + (radius + extra) * Math.sin(a),
        },
        score = collision(box(p)),
        distance = (p.x - center.x) ** 2 + (p.y - center.y) ** 2;
      if (
        score < best - 1e-6 ||
        (Math.abs(score - best) < 1e-6 && distance < bestDistance)
      ) {
        chosen = p;
        best = score;
        bestDistance = distance;
      }
    }
  ctx.set(
    note,
    "transform",
    `translate(${note.transform[4] + chosen.x - center.x} ${note.transform[5] + chosen.y - center.y})`,
  );
}
function crosses(a: Point, b: Point, c: Point, d: Point) {
  const side = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

// Only drawing-added H atoms may move. Rotate their native wedge rigidly,
// keeping bond length, wedge sense and the angular order of heavy ligands.
export function spaceChiralHydrogens(
  g: FigureGroup,
  positions: Point[],
  atomCount: number,
  nativeBonds: Map<number, [number, number]>,
  bonds: { atoms: number[] }[],
  ctx: FigureScene,
) {
  for (const [index, pair] of nativeBonds) {
    const h = pair.find((i) => i >= atomCount);
    const owner = pair.find((i) => i < atomCount);
    if (h === undefined || owner === undefined) continue;
    const glyphs = ctx.nodes(
      g,
      (node) =>
        (node.attributes.class ?? "").split(" ").includes(`atom-${h}`) &&
        ctx.data(node, "label") !== undefined,
    );
    const paths = ctx
      .nodes(g)
      .filter((node) => node.kind === "path")
      .filter(
        (node) =>
          (node.attributes.class ?? "").split(" ").includes(`bond-${index}`) &&
          ctx.data(node, "bond") !== undefined,
      );
    if (!glyphs.length || !paths.length) continue;
    const boxes = labelBoxes(g, ctx),
      traces = bondTraces(g, ctx);
    const id = ctx.data(glyphs[0], "label"),
      original = boxes.get(id)!;
    const origin = positions[owner],
      endpoint = positions[h];
    const angle = Math.atan2(endpoint.y - origin.y, endpoint.x - origin.x);
    const neighbours = bonds.flatMap((b) =>
      b.atoms.includes(owner)
        ? [positions[b.atoms.find((i) => i !== owner)!]]
        : [],
    );
    const offsets = neighbours.map((p) => {
      const a = Math.atan2(p.y - origin.y, p.x - origin.x) - angle;
      return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    });
    const positive = Math.min(...offsets),
      negative = Math.max(...offsets) - 2 * Math.PI;
    const own = new Set(paths);
    const score = (rotation: number) => {
      const cos = Math.cos(rotation),
        sin = Math.sin(rotation);
      const rotate = (p: Point) => ({
        x: origin.x + (p.x - origin.x) * cos - (p.y - origin.y) * sin,
        y: origin.y + (p.x - origin.x) * sin + (p.y - origin.y) * cos,
      });
      const end = rotate(endpoint),
        dx = end.x - endpoint.x,
        dy = end.y - endpoint.y;
      const box = rectangle(
        original.x + dx,
        original.y + dy,
        original.width,
        original.height,
      );
      let cost = 0;
      for (const {
        atoms: [a, b],
      } of bonds)
        if (
          a !== owner &&
          b !== owner &&
          crosses(origin, end, positions[a], positions[b])
        )
          return { cost: Infinity, end, dx, dy };
      for (const [a, b] of nativeBonds.values())
        if (
          a !== owner &&
          b !== owner &&
          crosses(origin, end, positions[a], positions[b])
        )
          return { cost: Infinity, end, dx, dy };
      for (const [other, b] of boxes) if (other !== id) cost += overlap(box, b);
      for (const trace of traces) {
        const contours = own.has(trace.el)
          ? trace.contours.map((contour) => {
              const points = contour.points.map(rotate);
              return { points, box: bounds(points) };
            })
          : trace.contours;
        cost += Number(
          inkIntersectsBox(contours, box, trace.width, trace.filled),
        );
        if (own.has(trace.el))
          for (const [other, b] of boxes)
            if (other !== id)
              cost += Number(
                inkIntersectsBox(contours, b, trace.width, trace.filled),
              );
      }
      return { cost, end, dx, dy };
    };
    let best = { rotation: 0, ...score(0) };
    if (best.cost === 0) continue;
    for (let degrees = 5; degrees < 180 && best.cost > 0; degrees += 5)
      for (const sign of [1, -1]) {
        const rotation = (sign * degrees * Math.PI) / 180;
        if (rotation >= positive - 0.05 || rotation <= negative + 0.05)
          continue;
        const candidate = score(rotation);
        if (candidate.cost < best.cost) best = { rotation, ...candidate };
        if (best.cost === 0) break;
      }
    if (!best.rotation) continue;
    const cos = Math.cos(best.rotation),
      sin = Math.sin(best.rotation);
    for (const p of paths)
      ctx.set(
        p,
        "transform",
        `matrix(${cos} ${sin} ${-sin} ${cos} ${origin.x - origin.x * cos + origin.y * sin} ${origin.y - origin.x * sin - origin.y * cos})`,
      );
    for (const glyph of glyphs)
      ctx.set(glyph, "transform", `translate(${best.dx} ${best.dy})`);
    positions[h] = best.end;
  }
}
