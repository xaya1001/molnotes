import { parse, type Node } from "svg-parser";
import type {
  FigureNode,
  FigurePaint,
} from "../../../shared/chemical-library/geometry.ts";
import { identityMatrix } from "./geometry-math.ts";
import { figureGroup, figurePath, plainPaint } from "./geometry-tree.ts";
import { svgTransform } from "./path-geometry.ts";

const xmlEntities: Record<string, string> = {
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  amp: "&",
};

export function nativePaint(
  properties: Record<string, string | number>,
  inherited: FigurePaint,
) {
  const values = {
    ...properties,
    ...Object.fromEntries(
      String(properties.style ?? "")
        .split(";")
        .filter(Boolean)
        .map((declaration) => {
          const colon = declaration.indexOf(":");
          return [
            declaration.slice(0, colon).trim(),
            declaration.slice(colon + 1).trim(),
          ];
        }),
    ),
  };
  const fillRule = values["fill-rule"] ?? inherited.fillRule;
  const lineCap = values["stroke-linecap"] ?? inherited.lineCap;
  const lineJoin = values["stroke-linejoin"] ?? inherited.lineJoin;
  const color = (value: string | number) => {
    const text = String(value);
    const rgb = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(text);
    return rgb
      ? `#${rgb
          .slice(1)
          .map((part) => Number(part).toString(16).padStart(2, "0"))
          .join("")}`
      : text.toLowerCase();
  };
  if (fillRule !== "nonzero" && fillRule !== "evenodd")
    throw new Error(`Unknown native fill rule ${fillRule}`);
  if (lineCap !== "butt" && lineCap !== "round" && lineCap !== "square")
    throw new Error(`Unknown native line cap ${lineCap}`);
  if (lineJoin !== "miter" && lineJoin !== "round" && lineJoin !== "bevel")
    throw new Error(`Unknown native line join ${lineJoin}`);
  const paint: FigurePaint = {
    fill: color(values.fill ?? inherited.fill),
    stroke: color(values.stroke ?? inherited.stroke),
    strokeWidth: parseFloat(
      String(values["stroke-width"] ?? inherited.strokeWidth),
    ),
    opacity: Number(values.opacity ?? 1),
    fillOpacity: Number(values["fill-opacity"] ?? inherited.fillOpacity),
    strokeOpacity: Number(values["stroke-opacity"] ?? inherited.strokeOpacity),
    fillRule,
    lineCap,
    lineJoin,
    miterLimit: Number(values["stroke-miterlimit"] ?? inherited.miterLimit),
    ...(values["stroke-dasharray"] !== undefined
      ? { dashArray: String(values["stroke-dasharray"]) }
      : inherited.dashArray !== undefined
        ? { dashArray: inherited.dashArray }
        : {}),
  };
  return paint;
}

/** Parse the outlined SVG produced by the native chemical drawing engine. */
export function nativeDepictionGeometry(
  source: string,
): Extract<FigureNode, { kind: "group" }> {
  const convert = (
    input: Node | string,
    inherited: FigurePaint,
  ): FigureNode | null => {
    if (typeof input === "string" || input.type === "text") return null;
    const p = input.properties ?? {};
    const paint = nativePaint(p, inherited);
    const n = (key: string) => Number(p[key] ?? 0);
    let node: FigureNode;
    if (input.tagName === "svg" || input.tagName === "g") {
      node = figureGroup(
        input.children.flatMap((child) => {
          const result = convert(child, paint);
          return result ? [result] : [];
        }),
      );
    } else if (input.tagName === "path") node = figurePath(String(p.d ?? ""));
    else if (input.tagName === "circle" || input.tagName === "ellipse") {
      const rx = n(input.tagName === "circle" ? "r" : "rx"),
        ry = n(input.tagName === "circle" ? "r" : "ry");
      node = {
        kind: "ellipse",
        center: { x: n("cx"), y: n("cy") },
        rx,
        ry,
        bounds: {
          x: n("cx") - rx,
          y: n("cy") - ry,
          width: 2 * rx,
          height: 2 * ry,
        },
        attributes: {},
        paint,
        transform: identityMatrix(),
      };
    } else if (input.tagName === "rect") {
      const box = {
        x: n("x"),
        y: n("y"),
        width: n("width"),
        height: n("height"),
      };
      node = {
        kind: "rect",
        box,
        bounds: box,
        attributes: {},
        paint,
        transform: identityMatrix(),
      };
    } else
      throw new Error(
        `Expected outlined native geometry, got ${input.tagName}`,
      );
    node.paint = paint;
    node.transform = p.transform
      ? svgTransform(String(p.transform))
      : identityMatrix();
    node.attributes = Object.fromEntries(
      Object.entries(p)
        .filter(
          ([key]) =>
            ["class", "id", "role", "tabindex", "pointer-events"].includes(
              key,
            ) ||
            key.startsWith("data-") ||
            key.startsWith("aria-"),
        )
        .map(([key, value]) => [
          key,
          String(value).replace(
            /&(quot|apos|lt|gt|amp);/g,
            (_, name: string) => xmlEntities[name],
          ),
        ]),
    );
    return node;
  };
  const node = convert(parse(source).children[0], plainPaint());
  if (!node || node.kind !== "group")
    throw new Error("Missing native drawing geometry");
  return node;
}
