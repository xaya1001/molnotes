import { isObject } from "../../../shared/json.ts";
import type {
  FigureGeometry,
  FigureNode,
  FigurePaint,
  FigureTextRun,
} from "../../../shared/chemical-library/geometry.ts";
import type { Diagnostic } from "../../../shared/chemical-library/types.ts";
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const point = (value: unknown) =>
  isObject(value) && finite(value.x) && finite(value.y);
const box = (value: unknown) =>
  point(value) &&
  isObject(value) &&
  finite(value.width) &&
  finite(value.height);
const strings = (value: unknown) =>
  isObject(value) &&
  Object.values(value).every((item) => typeof item === "string");
const matrix = (value: unknown) =>
  Array.isArray(value) && value.length === 6 && value.every(finite);
export function isFigurePaint(value: unknown): value is FigurePaint {
  return (
    isObject(value) &&
    typeof value.fill === "string" &&
    typeof value.stroke === "string" &&
    [
      value.strokeWidth,
      value.opacity,
      value.fillOpacity,
      value.strokeOpacity,
      value.miterLimit,
    ].every(finite) &&
    (value.fillRule === "nonzero" || value.fillRule === "evenodd") &&
    (value.lineCap === "butt" ||
      value.lineCap === "round" ||
      value.lineCap === "square") &&
    (value.lineJoin === "miter" ||
      value.lineJoin === "round" ||
      value.lineJoin === "bevel") &&
    (value.dashArray === undefined || typeof value.dashArray === "string")
  );
}
function run(value: unknown): value is FigureTextRun {
  return (
    isObject(value) &&
    typeof value.text === "string" &&
    finite(value.size) &&
    finite(value.shift) &&
    (value.weight === 400 || value.weight === 700) &&
    typeof value.italic === "boolean"
  );
}
function node(value: unknown): value is FigureNode {
  if (
    !isObject(value) ||
    !strings(value.attributes) ||
    !matrix(value.transform) ||
    !isFigurePaint(value.paint) ||
    (value.bounds !== null && !box(value.bounds))
  )
    return false;
  switch (value.kind) {
    case "group":
      return Array.isArray(value.children) && value.children.every(node);
    case "path":
      return typeof value.d === "string";
    case "ellipse":
      return point(value.center) && finite(value.rx) && finite(value.ry);
    case "rect":
      return box(value.box);
    case "text":
      return (
        typeof value.text === "string" &&
        point(value.position) &&
        finite(value.fontSize) &&
        (value.anchor === "start" ||
          value.anchor === "middle" ||
          value.anchor === "end") &&
        (value.baseline === "alphabetic" || value.baseline === "central") &&
        finite(value.advance) &&
        (value.inkBounds === null || box(value.inkBounds)) &&
        Array.isArray(value.runs) &&
        value.runs.every(run) &&
        Array.isArray(value.glyphs) &&
        value.glyphs.every(
          (glyph) =>
            isObject(glyph) &&
            typeof glyph.font === "string" &&
            finite(glyph.glyph) &&
            typeof glyph.path === "string" &&
            matrix(glyph.transform),
        )
      );
    default:
      return false;
  }
}
/** Disk caches are decoded before being used for a new diagnostic proof. */
export function isFigureGeometry(value: unknown): value is FigureGeometry {
  return (
    isObject(value) &&
    value.format === 1 &&
    finite(value.width) &&
    finite(value.height) &&
    finite(value.minimumScale) &&
    isObject(value.atomPoints) &&
    Object.values(value.atomPoints).every(point) &&
    node(value.root)
  );
}

export function isFigureDiagnostic(value: unknown): value is Diagnostic {
  return (
    isObject(value) &&
    typeof value.code === "string" &&
    (value.severity === "error" || value.severity === "warning") &&
    typeof value.object === "string" &&
    typeof value.message === "string" &&
    Array.isArray(value.elements) &&
    value.elements.every((item) => typeof item === "string") &&
    (value.actual === undefined || finite(value.actual)) &&
    (value.required === undefined || finite(value.required)) &&
    (value.at === undefined || point(value.at)) &&
    (value.field === undefined || typeof value.field === "string")
  );
}
