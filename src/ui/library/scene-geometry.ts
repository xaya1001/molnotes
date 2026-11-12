import type { Point } from "../../../shared/chemical-library/types.ts";
import type {
  FigureRect,
  FigureMatrix,
  FigureNode,
} from "../../../shared/chemical-library/geometry.ts";
import { shapeFigureText, type FigureFontResolver } from "./font-geometry.ts";
import {
  figureGroup,
  figurePath,
  plainPaint,
  transformedNodeBox,
} from "./geometry-tree.ts";
import {
  rectangle,
  identityMatrix,
  inverseMatrix,
  multiplyMatrix,
  transformBox,
} from "./geometry-math.ts";
import { figureTextRuns } from "./text-runs.ts";
import { pathBox, svgTransform } from "./path-geometry.ts";

export type FigureGroup = Extract<FigureNode, { kind: "group" }>;
export type FigureText = Extract<FigureNode, { kind: "text" }>;
export type FigurePath = Extract<FigureNode, { kind: "path" }>;
export type FigureEllipse = Extract<FigureNode, { kind: "ellipse" }>;
export interface FigureStyle {
  values: Record<string, string>;
}

export function parseFigureStyle(css: string): FigureStyle {
  return {
    values: Object.fromEntries(
      [...css.matchAll(/(--chemical-[a-z-]+)\s*:\s*([^;]+);/g)].map((match) => [
        match[1],
        match[2].trim(),
      ]),
    ),
  };
}
/** Scene construction owns parent relationships; cached output remains plain data. */
const svgText = (text: string) =>
  text.replace(/[\t\r\n ]+/g, " ").replace(/^ | $/g, "");

export function createFigureScene(
  style: FigureStyle,
  fonts: FigureFontResolver,
) {
  const parents = new WeakMap<FigureNode, FigureGroup>();
  const token = (name: string) => {
    const value = style.values[name];
    if (value === undefined)
      throw new Error(`Missing chemical style token ${name}`);
    return value;
  };
  const value = (input: string) =>
    input.replace(/^var\((--chemical-[a-z-]+)\)$/, (_match, name: string) =>
      token(name),
    );
  const size = (name: string) => {
    const number = parseFloat(token(name));
    if (!Number.isFinite(number))
      throw new Error(`Non-numeric chemical style token ${name}`);
    return number;
  };
  const register = (node: FigureNode, parent: FigureGroup) => {
    parents.set(node, parent);
    if (node.kind === "group")
      for (const child of node.children) register(child, node);
  };
  const remove = (node: FigureNode) => {
    const parent = parents.get(node);
    if (parent) parent.children.splice(parent.children.indexOf(node), 1);
    parents.delete(node);
  };
  const append = (parent: FigureGroup, ...nodes: FigureNode[]) => {
    for (const node of nodes) {
      remove(node);
      parent.children.push(node);
      register(node, parent);
    }
  };
  const nodes = (
    parent: FigureNode,
    predicate: (node: FigureNode) => boolean = () => true,
  ): FigureNode[] => {
    if (parent.kind !== "group") return [];
    return parent.children.flatMap((node) => [
      ...(predicate(node) ? [node] : []),
      ...nodes(node, predicate),
    ]);
  };
  const matrix = (node: FigureNode): FigureMatrix => {
    const parent = parents.get(node);
    return parent
      ? multiplyMatrix(matrix(parent), node.transform)
      : node.transform;
  };
  const relativeMatrix = (node: FigureNode, parent: FigureNode) =>
    multiplyMatrix(inverseMatrix(matrix(parent)), matrix(node));
  const box = (node: FigureNode): FigureRect => {
    const b =
      node.kind === "group"
        ? transformedNodeBox({ ...node, transform: identityMatrix() })
        : node.bounds;
    return b ? rectangle(b.x, b.y, b.width, b.height) : rectangle(0, 0, 0, 0);
  };
  const inkBox = (node: FigureNode, parent: FigureNode): FigureRect => {
    const b = transformBox(box(node), relativeMatrix(node, parent))!;
    return rectangle(b.x, b.y, b.width, b.height);
  };
  const reflow = (node: FigureText) => {
    const result = shapeFigureText(
      node.runs,
      fonts,
      node.position,
      node.anchor,
      node.baseline,
    );
    node.bounds = result.bounds;
    node.inkBounds = result.inkBounds;
    node.advance = result.advance;
    node.glyphs = result.glyphs;
  };
  const set = (node: FigureNode, name: string, input: string | number) => {
    const text = String(input);
    if (name === "transform") node.transform = svgTransform(text);
    else if (name === "d" && node.kind === "path") {
      node.d = text;
      node.bounds = pathBox(text);
    } else if ((name === "x" || name === "y") && node.kind === "text") {
      node.position[name] = Number(input);
      reflow(node);
    } else if (name === "stroke-dasharray") node.paint.dashArray = text;
    else node.attributes[name] = text;
  };
  const setStyle = (node: FigureNode, name: string, input: string) => {
    const resolved = value(input);
    if (name === "fill" || name === "stroke") node.paint[name] = resolved;
    else if (
      name === "strokeWidth" ||
      name === "opacity" ||
      name === "fillOpacity" ||
      name === "strokeOpacity"
    )
      node.paint[name] = parseFloat(resolved);
    else if (name === "fontWeight" && node.kind === "text") {
      node.runs = node.runs.map((run) => ({
        ...run,
        weight: Number(input) >= 600 ? 700 : 400,
      }));
      reflow(node);
    } else throw new Error(`Unsupported figure style ${name}`);
  };
  function element(
    tag: "g",
    attrs?: Record<string, string | number>,
  ): FigureGroup;
  function element(
    tag: "path",
    attrs?: Record<string, string | number>,
  ): FigurePath;
  function element(
    tag: "circle" | "ellipse",
    attrs?: Record<string, string | number>,
  ): FigureEllipse;
  function element(
    tag: "g" | "path" | "circle" | "ellipse",
    attrs: Record<string, string | number> = {},
  ): FigureNode {
    let node: FigureNode;
    if (tag === "g") node = figureGroup([]);
    else if (tag === "path") node = figurePath(String(attrs.d ?? ""));
    else {
      const center = { x: Number(attrs.cx ?? 0), y: Number(attrs.cy ?? 0) };
      const rx = Number(attrs.rx ?? attrs.r ?? 0),
        ry = Number(attrs.ry ?? attrs.r ?? 0);
      node = {
        kind: "ellipse",
        center,
        rx,
        ry,
        bounds: {
          x: center.x - rx,
          y: center.y - ry,
          width: 2 * rx,
          height: 2 * ry,
        },
        transform: identityMatrix(),
        attributes: {},
        paint: plainPaint(),
      };
    }
    for (const [key, value] of Object.entries(attrs)) {
      if (["d", "cx", "cy", "r", "rx", "ry"].includes(key)) continue;
      if (key === "fill" || key === "stroke")
        setStyle(node, key, String(value));
      else set(node, key, value);
    }
    return node;
  }
  const label = (
    at: Point,
    text: string,
    font = "var(--chemical-font)",
    anchor: "start" | "middle" | "end" = "middle",
  ) => {
    const fontSize = parseFloat(value(font));
    const runs = figureTextRuns(svgText(text), fontSize, fonts);
    const node = shapeFigureText(runs, fonts, at, anchor);
    node.text = text.replace(/\*+/g, "").replace(/\^\{([^}]+)\}/g, "$1");
    node.paint.fill = token("--chemical-ink");
    return node;
  };
  const dataKey = (name: string) =>
    "data-" + name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
  const get = (node: FigureNode, name: string) => {
    if (name === "d" && node.kind === "path") return node.d;
    if ((name === "cx" || name === "cy") && node.kind === "ellipse")
      return String(node.center[name === "cx" ? "x" : "y"]);
    return node.attributes[name];
  };
  const data = (node: FigureNode, name: string) =>
    node.attributes[dataKey(name)];
  const setData = (node: FigureNode, name: string, text: string) => {
    node.attributes[dataKey(name)] = text;
  };
  const groups = (parent: FigureNode, name: string, text: string) =>
    nodes(parent)
      .filter((node) => node.kind === "group")
      .filter((node) => data(node, name) === text);
  return {
    textWidth(text: string, font: string) {
      return shapeFigureText(
        figureTextRuns(svgText(text), parseFloat(value(font)), fonts),
        fonts,
        { x: 0, y: 0 },
      ).advance;
    },
    token: size,
    value: token,
    resolve: value,
    element,
    label,
    append,
    remove,
    nodes,
    groups,
    box,
    inkBox,
    matrix,
    relativeMatrix,
    set,
    setStyle,
    data,
    setData,
    register,
    get,
    fonts,
  };
}
export type FigureScene = ReturnType<typeof createFigureScene>;
