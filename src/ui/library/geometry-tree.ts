import type {
  FigureGeometry,
  FigureNode,
  FigurePaint,
} from "../../../shared/chemical-library/geometry.ts";
import {
  identityMatrix,
  multiplyMatrix,
  transformBox,
  unionBoxes,
} from "./geometry-math.ts";
import { pathBox, transformPath } from "./path-geometry.ts";

export const plainPaint = (): FigurePaint => ({
  fill: "#000000",
  stroke: "none",
  strokeWidth: 1,
  opacity: 1,
  fillOpacity: 1,
  strokeOpacity: 1,
  fillRule: "nonzero",
  lineCap: "butt",
  lineJoin: "miter",
  miterLimit: 4,
});

export function figurePath(d: string): Extract<FigureNode, { kind: "path" }> {
  return {
    kind: "path",
    d,
    bounds: pathBox(d),
    transform: identityMatrix(),
    paint: plainPaint(),
    attributes: {},
  };
}

export function figureGroup(
  children: FigureNode[],
): Extract<FigureNode, { kind: "group" }> {
  return {
    kind: "group",
    children,
    transform: identityMatrix(),
    paint: plainPaint(),
    attributes: {},
    bounds: unionBoxes(children.map((child) => transformedNodeBox(child))),
  };
}

/** Tight group bounds, including the actual transformed curve extrema. */
export function transformedNodeBox(
  node: FigureNode,
  parent = identityMatrix(),
): FigureNode["bounds"] {
  const matrix = multiplyMatrix(parent, node.transform);
  if (node.kind === "group")
    return unionBoxes(
      node.children.map((child) => transformedNodeBox(child, matrix)),
    );
  if (node.kind === "path") return pathBox(transformPath(node.d, matrix));
  if (node.kind === "ellipse") {
    const [a, b, c, d, e, f] = matrix;
    const x = a * node.center.x + c * node.center.y + e,
      y = b * node.center.x + d * node.center.y + f;
    const rx = Math.hypot(a * node.rx, c * node.ry),
      ry = Math.hypot(b * node.rx, d * node.ry);
    return { x: x - rx, y: y - ry, width: 2 * rx, height: 2 * ry };
  }
  return transformBox(node.bounds, matrix);
}

export function refreshGeometry(node: FigureNode): void {
  if (node.kind !== "group") return;
  for (const child of node.children) refreshGeometry(child);
  node.bounds = unionBoxes(
    node.children.map((child) => transformedNodeBox(child)),
  );
}

const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character]!,
  );

function attributes(values: Record<string, string | number>) {
  return Object.entries(values)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
    .join("");
}

/** Text has already been shaped. SVG readers need neither fonts nor RDKit. */
export function geometrySvg(geometry: FigureGeometry) {
  const serialize = (node: FigureNode): string => {
    const p = node.paint;
    const attrs = {
      ...node.attributes,
      transform: `matrix(${node.transform.join(" ")})`,
      fill: p.fill,
      stroke: p.stroke,
      "stroke-width": p.strokeWidth,
      opacity: p.opacity,
      "fill-opacity": p.fillOpacity,
      "stroke-opacity": p.strokeOpacity,
      "fill-rule": p.fillRule,
      "stroke-linecap": p.lineCap,
      "stroke-linejoin": p.lineJoin,
      "stroke-miterlimit": p.miterLimit,
      ...(p.dashArray ? { "stroke-dasharray": p.dashArray } : {}),
    };
    if (node.kind === "group")
      return `<g${attributes(attrs)}>${node.children.map(serialize).join("")}</g>`;
    if (node.kind === "path")
      return `<path${attributes({ ...attrs, d: node.d })}/>`;
    if (node.kind === "rect")
      return `<rect${attributes({ ...attrs, ...node.box })}/>`;
    if (node.kind === "ellipse")
      return `<ellipse${attributes({ ...attrs, cx: node.center.x, cy: node.center.y, rx: node.rx, ry: node.ry })}/>`;
    const glyphs = node.glyphs
      .filter((glyph) => glyph.path)
      .map(
        (glyph) =>
          `<path${attributes({ d: glyph.path, transform: `matrix(${glyph.transform.join(" ")})` })}/>`,
      )
      .join("");
    return `<g${attributes({ ...attrs, "aria-label": node.text, "data-text": node.text })}>${glyphs}</g>`;
  };
  return `<svg${attributes({ xmlns: "http://www.w3.org/2000/svg", width: geometry.width, height: geometry.height, viewBox: `0 0 ${geometry.width} ${geometry.height}` })}>${serialize(geometry.root)}</svg>`;
}
