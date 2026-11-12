import type {
  Diagnostic,
  Point,
} from "../../../shared/chemical-library/types.ts";
import type {
  FigureBox,
  FigureGeometry,
  FigureObservation,
} from "../../../shared/chemical-library/geometry.ts";
import { transformBox } from "./geometry-math.ts";
import { walkGeometry } from "./geometry-tree.ts";
import { pathBox, samplePath, transformPath } from "./path-geometry.ts";

const identities = [
  "label",
  "bond",
  "electronArrow",
  "arrowHead",
  "reactionArrow",
  "reactionHead",
  "routeEdge",
];

export function observationKey(
  tag: string,
  ids: Record<string, string>,
  counts: Map<string, number>,
) {
  const attribute = identities.find((name) => ids[name] !== undefined);
  if (!attribute) return;
  const base = `${tag}:${attribute}=${ids[attribute]}`;
  const ordinal = counts.get(base) ?? 0;
  counts.set(base, ordinal + 1);
  return `${base}#${ordinal}`;
}

export function geometryObservation(
  geometry: FigureGeometry,
  diagnostics: Diagnostic[] = [],
): FigureObservation {
  const elements: FigureObservation["elements"] = [];
  const counts = new Map<string, number>();
  walkGeometry(geometry.root, (node, matrix) => {
    const ids = Object.fromEntries(
      Object.entries(node.attributes)
        .filter(([key]) => key.startsWith("data-"))
        .map(([key, value]) => [
          key
            .slice(5)
            .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
          value,
        ]),
    );
    const key = observationKey(
      node.kind === "group" ? "g" : node.kind,
      ids,
      counts,
    );
    if (!key) return;
    const path =
      node.kind === "path" ? transformPath(node.d, matrix) : undefined;
    const bounds =
      path !== undefined ? pathBox(path) : transformBox(node.bounds, matrix);
    if (!bounds) return;
    elements.push({
      key,
      ids,
      bounds,
      paint: node.paint,
      ...(path !== undefined ? { path, points: samplePath(path, 1.5) } : {}),
    });
  });
  return {
    width: geometry.width,
    height: geometry.height,
    minimumScale: geometry.minimumScale,
    atoms: geometry.atomPoints,
    elements,
    diagnostics,
  };
}

export function boxEdgeDelta(a: FigureBox, b: FigureBox) {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.x + a.width - (b.x + b.width)),
    Math.abs(a.y + a.height - (b.y + b.height)),
  );
}

function pointToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t =
    dx || dy
      ? Math.max(
          0,
          Math.min(
            1,
            ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy),
          ),
        )
      : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Symmetric distance between the sampled traces, in design pixels. */
export function traceDelta(a: Point[], b: Point[]) {
  if (!a.length || !b.length) return a.length === b.length ? 0 : null;
  const directed = (points: Point[], line: Point[]) =>
    Math.max(
      ...points.map((p) =>
        line.length === 1
          ? Math.hypot(p.x - line[0].x, p.y - line[0].y)
          : Math.min(
              ...line.slice(1).map((q, i) => pointToSegment(p, line[i], q)),
            ),
      ),
    );
  return Math.max(directed(a, b), directed(b, a));
}
