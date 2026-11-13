import type { FigureGeometry } from "../../../shared/chemical-library/geometry.ts";
import { figureGroup, refreshGeometry } from "./geometry-tree.ts";

/** The prototype route margin is 0.8 bond lengths on every side. */
export function fitFigureCanvas(
  geometry: FigureGeometry,
  bond: number,
): FigureGeometry {
  const { root: content, atomPoints } = geometry;
  const root = content.kind === "group" ? content : figureGroup([content]);
  refreshGeometry(root);
  const bounds = root.bounds;
  if (!bounds) return geometry;
  const margin = bond * 0.8;
  const dx = margin - bounds.x,
    dy = margin - bounds.y;
  const wrapper = figureGroup(root.children);
  wrapper.transform = [1, 0, 0, 1, dx, dy];
  root.children = [wrapper];
  for (const point of Object.values(atomPoints)) {
    point.x += dx;
    point.y += dy;
  }
  const width = bounds.width + 2 * margin,
    height = bounds.height + 2 * margin;
  root.attributes.viewBox = `0 0 ${width} ${height}`;
  root.attributes.width = String(width);
  root.attributes.height = String(height);
  refreshGeometry(root);
  return { ...geometry, root, width, height };
}
