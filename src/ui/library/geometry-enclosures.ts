import type {
  Enclosure,
  Point,
} from "../../../shared/chemical-library/types.ts";
import type { FigureBox } from "../../../shared/chemical-library/geometry.ts";
import { unionBoxes } from "./geometry-math.ts";
import {
  parsedPath,
  pathContours,
  inkIntersectsBox,
  contoursCoverPoint,
} from "./path-geometry.ts";
import { createFigureScene, type FigureGroup } from "./scene-geometry.ts";
import { polylinesTouch } from "./geometry-collision.ts";
import { spaceBondEndpoints } from "./geometry-spacing.ts";

const key = (a: NonNullable<Enclosure["atoms"]>[number]) =>
  `${a.molecule}:${a.atom}`;
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function hull(points: Point[]) {
  const sorted = points.toSorted((a, b) => a.x - b.x || a.y - b.y);
  const half = (items: Point[]) => {
    const result: Point[] = [];
    for (const p of items) {
      while (result.length > 1 && cross(result.at(-2)!, result.at(-1)!, p) <= 0)
        result.pop();
      result.push(p);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.toReversed())];
}

/** Offset a convex boundary with circular joins, retaining the full clearance. */
function outline(points: Point[], gap: number) {
  const corners = hull(points);
  const normals = corners.map((p, i) => {
    const q = corners[(i + 1) % corners.length];
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    return { x: (q.y - p.y) / length, y: (p.x - q.x) / length };
  });
  const path =
    corners
      .map((p, i) => {
        const before = normals[(i + corners.length - 1) % corners.length];
        const after = normals[i];
        return `${i ? "L" : "M"}${p.x + gap * before.x} ${p.y + gap * before.y}A${gap} ${gap} 0 0 1 ${p.x + gap * after.x} ${p.y + gap * after.y}`;
      })
      .join("") + "Z";
  return parsedPath(path).unarc().toString();
}

/** Circle intent follows scene atoms; geometry is derived from their visible ink. */
export function drawEnclosure(
  enclosure: Enclosure,
  positions: Record<string, Point>,
  parent: FigureGroup,
  ctx: ReturnType<typeof createFigureScene>,
  connections: readonly [string, string][],
  emphasis: "primary" | "supporting" = "primary",
) {
  const remaining = new Set([
      ...(enclosure.atoms ?? []).map(key),
      ...(enclosure.bonds ?? []).flat().map(key),
    ]),
    parts: Set<string>[] = [];
  while (remaining.size) {
    const part = new Set<string>(),
      pending = [remaining.values().next().value!];
    while (pending.length) {
      const atom = pending.pop()!;
      if (!remaining.delete(atom)) continue;
      part.add(atom);
      for (const [a, b] of connections) {
        if (a === atom && remaining.has(b)) pending.push(b);
        if (b === atom && remaining.has(a)) pending.push(a);
      }
    }
    parts.push(part);
  }
  if (parts.length === 1 || (enclosure.shape && enclosure.shape !== "auto"))
    return [drawPart(enclosure, positions, parent, ctx, emphasis)].filter(
      (p) => p !== undefined,
    );
  return parts.flatMap((part, i) => {
    const node = drawPart(
      {
        ...enclosure,
        id: `${enclosure.id}:${i + 1}`,
        atoms: enclosure.atoms?.filter((a) => part.has(key(a))),
        bonds: enclosure.bonds?.filter((pair) =>
          pair.every((a) => part.has(key(a))),
        ),
      },
      positions,
      parent,
      ctx,
      emphasis,
    );
    return node ? [node] : [];
  });
}

function drawPart(
  enclosure: Enclosure,
  positions: Record<string, Point>,
  parent: FigureGroup,
  ctx: ReturnType<typeof createFigureScene>,
  emphasis: "primary" | "supporting",
) {
  const selected = new Set([
    ...(enclosure.atoms ?? []).map(key),
    ...(enclosure.bonds ?? []).flatMap((b) => b.map(key)),
  ]);
  const boxes: FigureBox[] = [...selected].map((id) => {
    const p = positions[id];
    if (!p) throw new Error(`Unknown enclosure atom ${id}`);
    return { x: p.x - 1, y: p.y - 1, width: 2, height: 2 };
  });
  for (const node of ctx.nodes(parent)) {
    const atoms = (ctx.data(node, "atoms") ?? "").split(" ");
    if (
      ctx.data(node, "bond") !== undefined &&
      atoms.every((a) => selected.has(a)) &&
      node.kind === "path"
    ) {
      // Use the actual bond contour, not its axis-aligned rectangle: those
      // rectangles introduce artificial corners into an otherwise smooth hull.
      const half =
        node.paint.stroke === "none" ? 0 : node.paint.strokeWidth / 2;
      for (const contour of pathContours(
        node.d,
        ctx.relativeMatrix(node, parent),
      ))
        for (const p of contour.points)
          boxes.push({
            x: p.x - half,
            y: p.y - half,
            width: 2 * half,
            height: 2 * half,
          });
    } else if (
      selected.has(ctx.data(node, "label") ?? "") ||
      selected.has(ctx.data(node, "chargeOwner") ?? "")
    ) {
      const box = ctx.inkBox(node, parent);
      boxes.push(box);
    }
  }
  const bounds = unionBoxes(boxes)!;
  let shape =
    enclosure.shape && enclosure.shape !== "auto" ? enclosure.shape : "circle";
  const gap = ctx.token("--chemical-enclose-gap");
  const points = boxes.flatMap((b) => [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ]);
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const rect = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ];
  const path = (kind: "circle" | "rect" | "outline", padding: number) => {
    if (kind !== "circle")
      return outline(kind === "rect" ? rect : points, padding);
    const r =
      Math.max(
        ...points.map((p) => Math.hypot(p.x - center.x, p.y - center.y)),
      ) + padding;
    return parsedPath(
      `M${center.x - r} ${center.y}A${r} ${r} 0 1 0 ${center.x + r} ${center.y}A${r} ${r} 0 1 0 ${center.x - r} ${center.y}Z`,
    )
      .unarc()
      .toString();
  };
  const obstacles = ctx
    .nodes(parent)
    .filter((node) => {
      const id = ctx.data(node, "chargeOwner") ?? ctx.data(node, "label");
      return id && !selected.has(id);
    })
    .map((node) => ctx.inkBox(node, parent));
  const otherBonds = ctx
    .nodes(parent)
    .filter(
      (node) =>
        node.kind === "path" &&
        ctx.data(node, "bond") !== undefined &&
        !(ctx.data(node, "atoms") ?? "")
          .split(" ")
          .some((id) => selected.has(id)),
    );
  const width = ctx.token("--chemical-enclose-line");
  const automatic = !enclosure.shape || enclosure.shape === "auto";
  const visible = new Set(
    ctx
      .nodes(parent)
      .flatMap((node) => [
        ...(ctx.data(node, "atoms") ?? "").split(" "),
        ctx.data(node, "label") ?? "",
      ]),
  );
  const otherAtoms = Object.entries(positions)
    .filter(([id]) => visible.has(id) && !selected.has(id))
    .map(([, point]) => point);
  const touches = (d: string) => {
    const contours = pathContours(d);
    return (
      obstacles.some((box) =>
        inkIntersectsBox(contours, box, width + 2 * gap, true),
      ) ||
      otherAtoms.some((point) =>
        contoursCoverPoint(contours, point, width + 2 * gap),
      ) ||
      otherBonds.some(
        (node) =>
          node.kind === "path" &&
          pathContours(node.d, ctx.relativeMatrix(node, parent)).some((bond) =>
            contours.some((outline) =>
              polylinesTouch(
                outline.points,
                bond.points,
                (width + node.paint.strokeWidth) / 2,
              ),
            ),
          ),
      )
    );
  };
  let d = path(shape, gap);
  if (automatic) {
    for (const candidate of ["circle", "rect", "outline"] as const) {
      shape = candidate;
      d = path(candidate, gap);
      if (!touches(d)) break;
    }
    if (touches(d)) {
      const atoms = new Set(enclosure.atoms?.map(key));
      const bonds = new Set(
        enclosure.bonds?.map((pair) => pair.map(key).sort().join("/")),
      );
      const color =
        emphasis === "primary"
          ? "var(--chemical-focus)"
          : "var(--chemical-support)";
      const line =
        emphasis === "primary"
          ? "var(--chemical-focus-line)"
          : "var(--chemical-support-line)";
      for (const node of ctx.nodes(parent)) {
        if (
          ctx.data(node, "bond") !== undefined &&
          bonds.has((ctx.data(node, "atoms") ?? "").split(" ").sort().join("/"))
        ) {
          if (node.paint.fill !== "none") ctx.setStyle(node, "fill", color);
          else {
            ctx.setStyle(node, "stroke", color);
            ctx.setStyle(node, "strokeWidth", line);
          }
        } else if (
          atoms.has(
            ctx.data(node, "chargeOwner") ?? ctx.data(node, "label") ?? "",
          )
        ) {
          ctx.setStyle(node, "fill", color);
        }
      }
      const molecules = new Set(
        [...(enclosure.atoms ?? []), ...(enclosure.bonds ?? []).flat()].map(
          (a) => a.molecule,
        ),
      );
      for (const group of [parent, ...ctx.nodes(parent)])
        if (
          group.kind === "group" &&
          molecules.has(ctx.data(group, "molecule"))
        )
          spaceBondEndpoints(group, ctx);
      return;
    }
  }
  const node = ctx.element("path", { d });
  node.paint.lineCap = "round";
  node.paint.lineJoin = "round";
  ctx.setStyle(node, "fill", "none");
  ctx.setStyle(node, "stroke", "var(--chemical-focus)");
  ctx.setStyle(node, "strokeWidth", "var(--chemical-enclose-line)");
  ctx.set(node, "stroke-dasharray", ctx.value("--chemical-enclose-dash"));
  ctx.setData(node, "enclose", enclosure.id);
  ctx.setData(node, "encloseShape", shape);
  ctx.setData(node, "encloseAtoms", [...selected].join(" "));
  ctx.append(parent, node);
  return node;
}
