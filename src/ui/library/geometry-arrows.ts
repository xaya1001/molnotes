import type { Point } from "../../../shared/chemical-library/types.ts";
import { routeElectronArrowGeometry } from "./arrow-layout.ts";
import { samplePath } from "./path-geometry.ts";
import { transformPoint } from "./geometry-math.ts";
import type { FigureGroup, FigureScene } from "./scene-geometry.ts";

export function routeGeometryArrow(
  from: Point,
  to: Point,
  B: number,
  parent: FigureGroup,
  ctx: FigureScene,
  clearance: Parameters<typeof routeElectronArrowGeometry>[4],
  bend?: "left" | "right",
  directions?: Parameters<typeof routeElectronArrowGeometry>[6],
) {
  const boxes = ctx
    .nodes(parent, (node) => ctx.data(node, "label") !== undefined)
    .map((node) => {
      const r = ctx.inkBox(node, parent);
      return {
        left: r.left - 1.2,
        right: r.right + 1.2,
        top: r.top - 1.2,
        bottom: r.bottom + 1.2,
      };
    });
  const heads = ctx
    .nodes(parent, (node) => ctx.data(node, "headPoints") !== undefined)
    .map((node) => {
      const points: Point[] = JSON.parse(ctx.data(node, "headPoints"));
      return points.map((p) =>
        transformPoint(p, ctx.relativeMatrix(node, parent)),
      );
    });
  const segments: [Point, Point, boolean][] = [];
  for (const node of ctx
    .nodes(parent)
    .filter((node) => node.kind === "path")
    .filter(
      (node) =>
        ctx.data(node, "bond") !== undefined ||
        ctx.data(node, "electronArrow") !== undefined,
    )) {
    const points = samplePath(node.d, 4, ctx.relativeMatrix(node, parent));
    for (let i = 1; i < points.length; i++)
      segments.push([
        points[i - 1],
        points[i],
        ctx.data(node, "electronArrow") !== undefined,
      ]);
  }
  return routeElectronArrowGeometry(
    from,
    to,
    B,
    { boxes, heads, segments },
    clearance,
    bend,
    directions,
  );
}
