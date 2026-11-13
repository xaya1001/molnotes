import svgpath from "svgpath";
import { svgPathProperties } from "svg-path-properties";
import type { Point } from "../../../shared/chemical-library/types.ts";
import type {
  FigureBox,
  FigureMatrix,
} from "../../../shared/chemical-library/geometry.ts";
import { identityMatrix, pointsBox, transformPoint } from "./geometry-math.ts";
import {
  insidePolygon,
  polygonHitsSegment,
  polygonsOverlap,
  polylinesTouch,
} from "./geometry-collision.ts";

export function parsedPath(d: string) {
  const path = svgpath(d);
  if ("err" in path && path.err)
    throw new Error(`Invalid figure path: ${String(path.err)}`);
  return path;
}

export function transformPath(d: string, matrix: FigureMatrix) {
  return parsedPath(d).matrix(matrix).toString();
}

/** Use the SVG transform parser already used for native path transforms. */
export function svgTransform(value: string): FigureMatrix {
  const points: Point[] = [];
  parsedPath("M0 0L1 0L0 1")
    .transform(value)
    .abs()
    .iterate((s) => {
      if (s[0] === "M" || s[0] === "L") points.push({ x: s[1], y: s[2] });
    });
  const [origin, x, y] = points;
  return [
    x.x - origin.x,
    x.y - origin.y,
    y.x - origin.x,
    y.y - origin.y,
    origin.x,
    origin.y,
  ];
}

/** Bounds of the actual line/quadratic/cubic ink, without stroke expansion. */
export function pathBox(d: string) {
  const points: Point[] = [];
  const path = parsedPath(d).abs().unshort();
  let subpath: Point = { x: 0, y: 0 };
  path.iterate((s, _index, x, y) => {
    const start = { x, y };
    if (s[0] === "M") {
      subpath = { x: s[1], y: s[2] };
      // A moveto alone has no ink; the next drawn segment includes its start.
    } else if (s[0] === "L") points.push(start, { x: s[1], y: s[2] });
    else if (s[0] === "H") points.push(start, { x: s[1], y });
    else if (s[0] === "V") points.push(start, { x, y: s[1] });
    else if (s[0] === "Z" || s[0] === "z") points.push(start, subpath);
    else if (s[0] === "Q") {
      const control = { x: s[1], y: s[2] },
        end = { x: s[3], y: s[4] };
      points.push(start, end);
      for (const axis of ["x", "y"] as const) {
        const denominator = start[axis] - 2 * control[axis] + end[axis];
        if (denominator === 0) continue;
        const t = (start[axis] - control[axis]) / denominator;
        if (t > 0 && t < 1)
          points.push({
            x: (1 - t) ** 2 * x + 2 * (1 - t) * t * control.x + t * t * end.x,
            y: (1 - t) ** 2 * y + 2 * (1 - t) * t * control.y + t * t * end.y,
          });
      }
    } else if (s[0] === "C") {
      const p = [
        start,
        { x: s[1], y: s[2] },
        { x: s[3], y: s[4] },
        { x: s[5], y: s[6] },
      ];
      points.push(p[0], p[3]);
      for (const axis of ["x", "y"] as const) {
        const a = -p[0][axis] + 3 * p[1][axis] - 3 * p[2][axis] + p[3][axis];
        const b = 2 * (p[0][axis] - 2 * p[1][axis] + p[2][axis]);
        const c = p[1][axis] - p[0][axis];
        const discriminant = b * b - 4 * a * c;
        const roots =
          a === 0
            ? b === 0
              ? []
              : [-c / b]
            : discriminant < 0
              ? []
              : [
                  (-b + Math.sqrt(discriminant)) / (2 * a),
                  (-b - Math.sqrt(discriminant)) / (2 * a),
                ];
        for (const t of roots)
          if (t > 0 && t < 1) {
            const u = 1 - t;
            points.push({
              x:
                u ** 3 * p[0].x +
                3 * u * u * t * p[1].x +
                3 * u * t * t * p[2].x +
                t ** 3 * p[3].x,
              y:
                u ** 3 * p[0].y +
                3 * u * u * t * p[1].y +
                3 * u * t * t * p[2].y +
                t ** 3 * p[3].y,
            });
          }
      }
    } else {
      // Native chemical ink and authored arrows use only lines and Beziers.
      // Do not silently approximate a new SVG primitive in layout bounds.
      throw new Error(`Unsupported figure path command ${s[0]}`);
    }
  });
  return pointsBox(points);
}

/** Keep length in local units, as SVG getTotalLength/getPointAtLength do. */
export function pathMetrics(d: string) {
  parsedPath(d);
  const metrics = new svgPathProperties(d);
  return {
    length: metrics.getTotalLength(),
    pointAt: (length: number) => metrics.getPointAtLength(length),
  };
}

export function samplePath(d: string, step: number, matrix = identityMatrix()) {
  const { length, pointAt } = pathMetrics(d);
  if (!length) return [];
  const count = Math.max(2, Math.ceil(length / step));
  return Array.from({ length: count + 1 }, (_, i) =>
    transformPoint(pointAt((length * i) / count), matrix),
  );
}

export function pathContours(d: string, matrix = identityMatrix()) {
  const subpaths: string[] = [];
  parsedPath(d)
    .abs()
    .iterate((s) => {
      if (s[0] === "M") subpaths.push(s.join(" "));
      else subpaths[subpaths.length - 1] += " " + s.join(" ");
    });
  return subpaths.map((path) => {
    const vertices: Point[] = [];
    let curved = false;
    parsedPath(path).iterate((s, _index, x, y) => {
      if (s[0] === "M" || s[0] === "L") vertices.push({ x: s[1], y: s[2] });
      else if (s[0] === "H") vertices.push({ x: s[1], y });
      else if (s[0] === "V") vertices.push({ x, y: s[1] });
      else if (s[0] === "Z" || s[0] === "z") vertices.push(vertices[0]);
      else curved = true;
    });
    const points = curved
      ? samplePath(path, 1.5, matrix)
      : vertices.map((p) => transformPoint(p, matrix));
    return { points, box: pointsBox(points) };
  });
}

/** Even-odd interiors preserve holes in a union of expanded skeleton shapes. */
export function contoursCoverPoint(
  contours: ReturnType<typeof pathContours>,
  point: Point,
  width: number,
) {
  return (
    contours.filter((c) => insidePolygon(point, c.points)).length % 2 === 1 ||
    contours.some((c) => polylinesTouch(c.points, [point, point], width / 2))
  );
}

/** Test visible bond contours and stroke width against a complete label box. */
export function inkIntersectsBox(
  contours: ReturnType<typeof pathContours>,
  box: FigureBox,
  strokeWidth: number,
  filled: boolean | "evenodd",
) {
  const polygon = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
  if (
    filled === "evenodd" &&
    polygon.some((p) => contoursCoverPoint(contours, p, strokeWidth))
  )
    return true;
  return contours.some(({ points, box: bounds }) => {
    const pad = strokeWidth / 2;
    if (
      !bounds ||
      bounds.x - pad > box.x + box.width ||
      bounds.x + bounds.width + pad < box.x ||
      bounds.y - pad > box.y + box.height ||
      bounds.y + bounds.height + pad < box.y
    )
      return false;
    if (
      filled === true &&
      points.length >= 3 &&
      polygonsOverlap(points, polygon)
    )
      return true;
    return (
      strokeWidth > 0 &&
      points
        .slice(1)
        .some((p, i) =>
          polygonHitsSegment(polygon, points[i], p, strokeWidth / 2),
        )
    );
  });
}
